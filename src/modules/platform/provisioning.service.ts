/**
 * What the super admin does. Which is everything structural:
 *
 *     Super Admin ──creates──► Tenant (a jewellery shop)
 *                  ──creates──► its branches
 *                  ──creates──► every user in every branch
 *
 * All tenant mutations run with the correct tenant context so repo() and RLS
 * stamp the proper tenant_id.
 */
import type { Tx } from '../../core/db/client.js';
import { asPlatform, asTenant, withTenant } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import { newId } from '../../core/util/id.js';
import { logger } from '../../core/util/logger.js';
import { hashPassword, normalizePhone } from '../identity/auth.service.js';
import { invalidateUserAccess } from '../identity/access.service.js';
import { seedSystemRoles } from '../identity/role-seed.js';
import { provisionTenant } from '../tenancy/provisioning.service.js';
import { MODULE_CATALOG, type TenantKind } from '../tenancy/module-catalog.js';
import { TENANT_ROLES, tenantRole, type TenantRoleCode } from './roles.js';
import { audit } from './platform-auth.service.js';

export interface CreateTenantInput {
  code: string;
  legalName: string;
  displayName?: string;
  kind: TenantKind;
  gstin?: string;
  pan?: string;
  stateCode?: string;
  /** The first branch admin/owner. */
  admin: { email?: string | null; fullName: string; password: string; phone?: string | null };
  /** The first branch. More can be added afterwards. */
  branch?: { code: string; name: string; city?: string; state?: string; stateCode?: string; kind?: 'showroom' | 'factory' | 'warehouse' | 'office' };
  /** Module keys to switch on. Omit to use each module's default licence. */
  modules?: Array<{ key: string; licence: 'included' | 'purchased' | 'trial'; trialDays?: number }>;
}

/**
 * Creates the tenant, its chart of accounts, purities, numbering, roles,
 * the owner user and the first branch in one platform transaction.
 */
export async function createTenant(input: CreateTenantInput, actorId: string, ip?: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(input.code)) {
    throw new ValidationError('Tenant code must be lowercase letters, numbers and hyphens, 2–30 characters.');
  }
  if (input.admin.password.length < 8) {
    throw new ValidationError('The admin password must be at least 8 characters.');
  }

  return asPlatform(async (tx) => {
    const taken = await tx.maybeOne<{ id: string }>(`select id from tenant where lower(code) = lower($1)`, [input.code]);
    if (taken) throw new ConflictError(`A tenant with code "${input.code}" already exists.`);

    const tenant = await repo<{ id: string }>(tx, 'tenant').insert({
      code: input.code,
      legal_name: input.legalName,
      display_name: input.displayName ?? input.legalName,
      kind: input.kind,
      status: 'active',
      gstin: input.gstin ?? null,
      pan: input.pan ?? null,
    });

    let branchId = '';
    let ownerUserId = '';

    // 2–3. Everything inside the tenant is written AS the tenant, on this same
    // transaction, so repo() and RLS stamp the right tenant_id.
    await withTenant(tx, tenant.id as string, async (ttx) => {
      const prov = await provisionTenant(ttx, tenant.id as string, {
        legalName: input.legalName,
        displayName: input.displayName,
        stateCode: input.stateCode,
        firstBranch: input.branch ? { code: input.branch.code, name: input.branch.name, kind: input.branch.kind } : undefined,
      });
      branchId = prov.branchId;
      await seedSystemRoles(ttx);
      if (input.admin) {
        const owner = await createUserInternal(ttx, {
          email: input.admin.email,
          fullName: input.admin.fullName,
          password: input.admin.password,
          phone: input.admin.phone,
          roleCode: 'owner',
          branchId: null,
        });
        ownerUserId = owner.id;
      }
      if (input.branch) {
        await ttx.query(
          `update branch set city = $2, state = $3, state_code = coalesce($4, state_code) where id = $1`,
          [branchId, input.branch.city ?? null, input.branch.state ?? null, input.branch.stateCode ?? null],
        );
      }
      if (input.modules?.length) {
        for (const m of input.modules) {
          const trialEnds = m.licence === 'trial'
            ? new Date(Date.now() + (m.trialDays ?? 30) * 86_400_000)
            : null;
          await ttx.query(
            `update tenant_module set licence = $2, trial_ends_at = $3, enabled = true, updated_at = now()
              where module_key = $1`,
            [m.key, m.licence, trialEnds],
          );
        }
      }
    });

    await audit(tx, actorId, 'tenant.create', {
      tenantId: tenant.id, targetType: 'tenant', targetId: tenant.id, ip,
      changes: { code: input.code, kind: input.kind, adminEmail: input.admin.email },
    });

    logger.info({ tenantId: tenant.id, code: input.code, actorId }, 'Tenant created by super admin');
    return { tenantId: tenant.id, branchId, adminUserId: ownerUserId };
  });
}

export async function updateTenant(
  tenantId: string,
  changes: Partial<{ displayName: string; legalName: string; status: string; gstin: string; pan: string; kind: TenantKind }>,
  actorId: string,
  ip?: string,
) {
  return asPlatform(async (tx) => {
    const existing = await tx.maybeOne<Record<string, unknown>>(`select * from tenant where id = $1`, [tenantId]);
    if (!existing) throw new NotFoundError('Tenant', tenantId);

    const map: Record<string, string> = {
      displayName: 'display_name', legalName: 'legal_name', status: 'status',
      gstin: 'gstin', pan: 'pan', kind: 'kind',
    };
    const sets: string[] = []; const params: unknown[] = [tenantId];
    for (const [key, column] of Object.entries(map)) {
      const value = (changes as Record<string, unknown>)[key];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) return existing;

    const updated = await tx.one(
      `update tenant set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`, params);
    await audit(tx, actorId, 'tenant.update', { tenantId, targetType: 'tenant', targetId: tenantId, changes, ip });
    return updated;
  });
}

export interface CreateBranchInput {
  code: string;
  name: string;
  kind?: 'showroom' | 'factory' | 'warehouse' | 'office';
  gstin?: string;
  stateCode?: string;
  city?: string;
  state?: string;
  address_line1?: string;
  pincode?: string;
  phone?: string;
  email?: string;
}

/** A branch is useless without somewhere for stock to sit, so locations come with it. */
export async function createBranch(tenantId: string, input: CreateBranchInput, actorId: string | null, ip?: string) {
  const branch = await asTenant(tenantId, async (tx) => {
    const clash = await tx.maybeOne<{ id: string }>(
      `select id from branch where lower(code) = lower($1) and deleted_at is null`, [input.code]);
    if (clash) throw new ConflictError(`A branch with code "${input.code}" already exists.`);

    const created = await repo<{ id: string }>(tx, 'branch').insert({
      code: input.code, name: input.name, kind: input.kind ?? 'showroom',
      gstin: input.gstin ?? null, state_code: input.stateCode ?? null,
      city: input.city ?? null, state: input.state ?? null,
      address_line1: input.address_line1 ?? null, pincode: input.pincode ?? null,
      phone: input.phone ?? null, email: input.email ?? null, is_active: true,
    });

    const locations = (input.kind ?? 'showroom') === 'factory'
      ? [{ code: 'VAULT', name: 'Vault', kind: 'vault', is_default: true },
         { code: 'FLOOR', name: 'Production Floor', kind: 'floor', is_default: false }]
      : [{ code: 'COUNTER', name: 'Counter', kind: 'counter', is_default: true },
         { code: 'VAULT', name: 'Vault', kind: 'vault', is_default: false },
         { code: 'WINDOW', name: 'Display Window', kind: 'window', is_default: false }];

    for (const location of locations) {
      await repo(tx, 'stock_location').insert({ branch_id: created.id, ...location, is_active: true });
    }
    // Numbering needs nothing here: the business's shared series serve every branch.
    return created;
  });

  if (actorId) {
    await asPlatform(async (tx) => {
      await audit(tx, actorId, 'branch.create', {
        tenantId, targetType: 'branch', targetId: branch.id, ip, changes: { code: input.code, name: input.name },
      });
    });
  }
  return branch;
}

export interface CreateUserInput {
  email?: string | null;
  phone?: string | null;
  fullName: string;
  password: string;
  roleCode: string;
  branchId?: string | null;
}

/** Runs on a tenant-scoped tx (see withTenant) — repo() stamps tenant_id. */
async function createUserInternal(tx: Tx, input: CreateUserInput) {
  const role = await tx.maybeOne<{ id: string }>(
    `select id from role where code = $1 and deleted_at is null`, [input.roleCode],
  );
  if (!role) throw new ValidationError(`Role "${input.roleCode}" does not exist for this business.`);

  const user = await repo<{ id: string }>(tx, 'app_user').insert({
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.trim() ? normalizePhone(input.phone) : null,
    full_name: input.fullName.trim(),
    password_hash: await hashPassword(input.password),
    default_branch_id: input.branchId ?? null,
    must_change_password: true,
    is_active: true,
  });
  await repo(tx, 'user_role').insert({ user_id: user.id, role_id: role.id, branch_id: input.branchId ?? null });
  return user;
}

/**
 * Creates a staff member inside a tenant via platform transaction.
 */
export async function createTenantUser(
  tenantId: string,
  input: CreateUserInput,
  options: { actorPlatformUserId?: string; ip?: string } = {},
) {
  if (input.password.length < 8) throw new ValidationError('Password must be at least 8 characters.');

  const user = await asPlatform(async (tx) => {
    return withTenant(tx, tenantId, (ttx) => createUserInternal(ttx, input));
  });

  if (options.actorPlatformUserId) {
    await asPlatform(async (tx) => {
      await audit(tx, options.actorPlatformUserId!, 'user.create', {
        tenantId, targetType: 'app_user', targetId: user.id, ip: options.ip,
        changes: { email: input.email, phone: input.phone, roleCode: input.roleCode },
      });
    });
  }

  return user;
}

export async function setUserActive(
  tenantId: string, userId: string, isActive: boolean,
  options: { actorPlatformUserId?: string; ip?: string } = {},
) {
  await asPlatform(async (tx) => {
    await tx.query(
      `update app_user set is_active = $1, token_version = token_version + 1, updated_at = now()
        where id = $2 and tenant_id = $3`,
      [isActive, userId, tenantId],
    );
    if (!isActive) {
      await tx.query(`update refresh_token set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
    }
    invalidateUserAccess(tenantId, userId);

    if (options.actorPlatformUserId) {
      await audit(tx, options.actorPlatformUserId, isActive ? 'user.activate' : 'user.deactivate', {
        tenantId, targetType: 'app_user', targetId: userId, ip: options.ip,
      });
    }
  });
}

export async function changeUserRole(tenantId: string, userId: string, newRoleCode: string, operatorId: string) {
  return asPlatform(async (tx) => {
    const from = await withTenant(tx, tenantId, async (ttx) => {
      const user = await ttx.maybeOne(`select id from app_user where id = $1 and deleted_at is null for update`, [userId]);
      if (!user) throw new NotFoundError('User', userId);
      const role = await ttx.maybeOne<{ id: string }>(`select id from role where code = $1 and deleted_at is null`, [newRoleCode]);
      if (!role) throw new ValidationError(`Role "${newRoleCode}" does not exist for this business.`);

      const before = await ttx.query<{ code: string; branch_id: string | null }>(
        `select r.code, ur.branch_id from user_role ur join role r on r.id = ur.role_id where ur.user_id = $1`, [userId],
      );
      await ttx.query(`delete from user_role where user_id = $1`, [userId]);
      await repo(ttx, 'user_role').insert({ user_id: userId, role_id: role.id, branch_id: null });
      await ttx.query(`update app_user set token_version = token_version + 1 where id = $1`, [userId]);
      invalidateUserAccess(tenantId, userId);
      return before;
    });
    await audit(tx, operatorId, 'user.role_change', {
      tenantId, targetType: 'app_user', targetId: userId, changes: { from, to: newRoleCode },
    });
  });
}

/** Everything the super admin's tenant detail screen needs. */
export async function tenantDetail(tenantId: string) {
  const header = await asPlatform(async (tx) => {
    const tenant = await tx.maybeOne<Record<string, unknown>>(`select * from tenant where id = $1`, [tenantId]);
    if (!tenant) throw new NotFoundError('Tenant', tenantId);
    return tenant;
  });

  const inner = await asTenant(tenantId, async (tx: Tx) => {
    const [branches, users, modules] = await Promise.all([
      tx.query(`select b.*,
                       (select count(*) from stock_location l where l.branch_id = b.id) as location_count,
                       (select u.full_name from app_user u
                         join user_role ur on ur.user_id = u.id
                         join role r on r.id = ur.role_id
                        where (ur.branch_id = b.id or ur.branch_id is null) and r.code in ('admin', 'owner')
                          and u.is_active = true and u.deleted_at is null limit 1) as admin_name,
                       (select u.email from app_user u
                         join user_role ur on ur.user_id = u.id
                         join role r on r.id = ur.role_id
                        where (ur.branch_id = b.id or ur.branch_id is null) and r.code in ('admin', 'owner')
                          and u.is_active = true and u.deleted_at is null limit 1) as admin_email
                  from branch b where b.deleted_at is null order by b.code`),
      tx.query(`select u.id, u.email, u.full_name, u.phone, u.is_active, u.last_login_at, u.created_at,
                       u.default_branch_id,
                       coalesce((select r.code from user_role ur join role r on r.id = ur.role_id where ur.user_id = u.id limit 1), 'sales') as role_code,
                       b.name as branch_name, b.code as branch_code
                  from app_user u
                  left join branch b on b.id = u.default_branch_id
                 where u.deleted_at is null
                 order by b.code nulls first, u.full_name`),
      tx.query(`select module_key, enabled, licence, trial_ends_at, expires_at from tenant_module order by module_key`),
    ]);
    return { branches, users, modules };
  });

  const catalog = new Map(MODULE_CATALOG.map((m) => [m.key, m]));
  const roleNames = new Map<string, string>(TENANT_ROLES.map((r) => [r.code as string, r.name as string]));
  const users: Array<Record<string, unknown>> = (inner.users as Array<Record<string, unknown>>).map((u) => ({
    ...u,
    role_name: roleNames.get(String(u.role_code)) ?? u.role_code,
  }));

  return {
    tenant: header,
    ...inner,
    users,
    /** The admin covering every branch, if there is one. */
    globalAdmin: users.find((u) => (u.role_code === 'admin' || u.role_code === 'owner') && u.default_branch_id === null) ?? null,
    modules: (inner.modules as Array<Record<string, unknown>>).map((m) => ({
      ...m,
      name: catalog.get(m.module_key as string)?.name ?? m.module_key,
      group: catalog.get(m.module_key as string)?.group ?? 'core',
    })),
  };
}
