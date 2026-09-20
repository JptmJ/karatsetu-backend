/**
 * What the super admin does. Which is everything structural:
 *
 *     Super Admin ──creates──► Tenant (a jewellery shop)
 *                  ──creates──► its branches
 *                  ──creates──► every user in every branch
 *
 * Nobody inside a tenant creates users, not even the branch admin. So there is
 * no rank ladder here — there is one person who hands out accounts, and the
 * only structural rule left is that a branch has exactly one admin.
 */
import type { Tx } from '../../core/db/client.js';
import { asPlatform, asTenant } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import { newId } from '../../core/util/id.js';
import { logger } from '../../core/util/logger.js';
import { hashPassword } from '../identity/auth.service.js';
import { provisionTenant } from '../tenancy/provisioning.service.js';
import { MODULE_CATALOG, type TenantKind } from '../tenancy/module-catalog.js';
import { ADMIN_ROLE, TENANT_ROLES, isAdminRole, tenantRole, type TenantRoleCode } from './roles.js';
import { audit } from './platform-auth.service.js';

export interface CreateTenantInput {
  code: string;
  legalName: string;
  displayName?: string;
  kind: TenantKind;
  gstin?: string;
  pan?: string;
  stateCode?: string;
  /**
   * The first branch admin. Left with `branchId` unset, they administer every
   * branch — which is the "one admin for all branches" shape.
   */
  admin: { email: string; fullName: string; password: string; phone?: string };
  /** The first branch. More can be added afterwards. */
  branch?: { code: string; name: string; city?: string; state?: string; stateCode?: string; kind?: 'showroom' | 'factory' | 'warehouse' | 'office' };
  /** Module keys to switch on. Omit to use each module's default licence. */
  modules?: Array<{ key: string; licence: 'included' | 'purchased' | 'trial'; trialDays?: number }>;
}

/**
 * Creates the tenant, its chart of accounts, purities, numbering, the five
 * roles, the head user and the first branch — in one transaction per stage.
 * A half-created tenant is worse than none, so everything the tenant needs to
 * function is in place before this returns.
 */
export async function createTenant(input: CreateTenantInput, actorId: string, ip?: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(input.code)) {
    throw new ValidationError('Tenant code must be lowercase letters, numbers and hyphens, 2–30 characters.');
  }
  if (input.admin.password.length < 8) {
    throw new ValidationError('The admin password must be at least 8 characters.');
  }

  const taken = await asPlatform(async (tx) =>
    tx.maybeOne<{ id: string }>(`select id from tenant where lower(code) = lower($1)`, [input.code]),
  );
  if (taken) throw new ConflictError(`A tenant with code "${input.code}" already exists.`);

  const { tenantId, branchId, ownerUserId } = await provisionTenant({
    code: input.code,
    legalName: input.legalName,
    displayName: input.displayName ?? input.legalName,
    kind: input.kind,
    gstin: input.gstin,
    stateCode: input.stateCode,
    owner: { email: input.admin.email, fullName: input.admin.fullName, password: input.admin.password },
    firstBranch: input.branch
      ? { code: input.branch.code, name: input.branch.name, kind: input.branch.kind }
      : undefined,
  });

  await asTenant(tenantId, async (tx) => {
    // provisionTenant creates the head user; make sure they carry the admin
    // role and the all-branches slot.
    await tx.query(
      `update app_user set role_code = $2, default_branch_id = null where id = $1`,
      [ownerUserId, ADMIN_ROLE]);
    if (input.pan) await tx.query(`update tenant set pan = $2 where id = $1`, [tenantId, input.pan]);
    if (input.admin.phone) {
      await tx.query(`update app_user set phone = $2 where id = $1`, [ownerUserId, input.admin.phone]);
    }
    if (input.branch) {
      await tx.query(
        `update branch set city = $2, state = $3, state_code = coalesce($4, state_code) where id = $1`,
        [branchId, input.branch.city ?? null, input.branch.state ?? null, input.branch.stateCode ?? null],
      );
    }
    if (input.modules?.length) {
      for (const m of input.modules) {
        const trialEnds = m.licence === 'trial'
          ? new Date(Date.now() + (m.trialDays ?? 30) * 86_400_000)
          : null;
        await tx.query(
          `update tenant_module set licence = $2, trial_ends_at = $3, enabled = true, updated_at = now()
            where module_key = $1`,
          [m.key, m.licence, trialEnds],
        );
      }
    }
  });

  await asPlatform(async (tx) => {
    await audit(tx, actorId, 'tenant.create', {
      tenantId, targetType: 'tenant', targetId: tenantId, ip,
      changes: { code: input.code, kind: input.kind, adminEmail: input.admin.email },
    });
  });

  logger.info({ tenantId, code: input.code, actorId }, 'Tenant created by super admin');
  return { tenantId, branchId, adminUserId: ownerUserId };
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

    // A branch also needs its own document numbering, or the first invoice fails.
    const { DEFAULT_SERIES } = await import('../numbering/numbering.service.js');
    for (const series of DEFAULT_SERIES) {
      await tx.query(
        `insert into numbering_series (id, tenant_id, doc_type, branch_id, name, prefix, padding, reset_period, next_number, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 1, true)
         on conflict do nothing`,
        [newId(), tenantId, series.doc_type, created.id, series.name, series.prefix,
         'padding' in series ? series.padding : 5,
         'reset_period' in series ? series.reset_period : 'financial_yearly'],
      );
    }
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
  email: string;
  fullName: string;
  password: string;
  role: TenantRoleCode;
  phone?: string;
  branchId?: string;
}

/**
 * Creates a staff member inside a tenant.
 *
 * `actorRoles` is the caller's own roles. Passing `['owner']` is what the super
 * admin does (it may hand out any role); a manager passes its real roles and is
 * therefore limited to the roles below it.
 */
export async function createTenantUser(
  tenantId: string,
  input: CreateUserInput,
  options: { actorPlatformUserId?: string; actorUserId?: string; ip?: string } = {},
) {
  if (input.password.length < 8) throw new ValidationError('Password must be at least 8 characters.');

  const role = tenantRole(input.role);
  if (!role) {
    throw new ValidationError(`Unknown role "${input.role}". Valid roles: ${TENANT_ROLES.map((r) => r.code).join(', ')}.`);
  }

  const user = await asTenant(tenantId, async (tx) => {
    const clash = await tx.maybeOne<{ id: string }>(
      `select id from app_user where lower(email) = lower($1) and deleted_at is null`, [input.email]);
    if (clash) throw new ConflictError(`A user with email "${input.email}" already exists in this business.`);

    // The unique index would catch this anyway, but a duplicate-key error is
    // not something to show a person. Checking first lets us name the admin
    // already holding the slot.
    if (isAdminRole(input.role)) await assertBranchHasNoAdmin(tx, input.branchId ?? null);

    return repo<{ id: string; email: string; full_name: string }>(tx, 'app_user').insert({
      email: input.email.toLowerCase(), full_name: input.fullName,
      password_hash: await hashPassword(input.password),
      role_code: input.role,
      phone: input.phone ?? null, default_branch_id: input.branchId ?? null, is_active: true,
    });
  }, options.actorUserId ?? null);

  if (options.actorPlatformUserId) {
    await asPlatform(async (tx) => {
      await audit(tx, options.actorPlatformUserId!, 'user.create', {
        tenantId, targetType: 'app_user', targetId: user.id, ip: options.ip,
        changes: { email: input.email, role: input.role },
      });
    });
  }

  return { ...user, role: input.role, roleName: role.name };
}

export async function setUserActive(
  tenantId: string, userId: string, isActive: boolean,
  options: { actorPlatformUserId?: string; ip?: string } = {},
) {
  const user = await asTenant(tenantId, async (tx) => {
    // Never let the last active Admin be switched off — the tenant would be
    // locked out of its own account with nobody able to let them back in.
    if (!isActive) {
      const others = await tx.one<{ count: string }>(
        `select count(*)::text count from app_user
          where role_code = $1 and is_active = true and deleted_at is null and id <> $2`,
        [ADMIN_ROLE, userId]);
      const target = await tx.maybeOne<{ role_code: string }>(
        `select role_code from app_user where id = $1`, [userId]);

      if (target && isAdminRole(target.role_code) && Number(others.count) === 0) {
        throw new BusinessRuleError(
          'This is the only admin in the business. Create another admin before deactivating this one, or the shop is left with nobody who can run it.',
          'last_admin',
        );
      }
    }
    // Someone else may have taken the branch's admin slot while this account
    // was off, so reactivating has to be checked the same way as creating.
    if (isActive) {
      const target = await tx.maybeOne<{ role_code: string; default_branch_id: string | null }>(
        `select role_code, default_branch_id from app_user where id = $1`, [userId]);
      if (target && isAdminRole(target.role_code)) {
        await assertBranchHasNoAdmin(tx, target.default_branch_id, userId);
      }
    }
    return tx.one(`update app_user set is_active = $2, updated_at = now() where id = $1 returning *`, [userId, isActive]);
  });

  if (options.actorPlatformUserId) {
    await asPlatform(async (tx) => {
      await audit(tx, options.actorPlatformUserId!, isActive ? 'user.activate' : 'user.deactivate', {
        tenantId, targetType: 'app_user', targetId: userId, ip: options.ip,
      });
    });
  }
  return user;
}

/**
 * A branch has exactly one admin, and one admin may instead cover every branch.
 * `branchId` null means the all-branches slot.
 */
async function assertBranchHasNoAdmin(tx: Tx, branchId: string | null, excludeUserId?: string): Promise<void> {
  const holder = await tx.maybeOne<{ full_name: string; email: string }>(
    `select full_name, email from app_user
      where role_code = $1 and is_active = true and deleted_at is null
        and default_branch_id is not distinct from $2
        and ($3::uuid is null or id <> $3)
      limit 1`,
    [ADMIN_ROLE, branchId, excludeUserId ?? null],
  );
  if (!holder) return;

  const where = branchId ? 'this branch' : 'all branches';
  throw new ConflictError(
    `${holder.full_name} (${holder.email}) is already the admin for ${where}. A branch has one admin — move or deactivate them first.`,
    { currentAdmin: holder, branchId },
  );
}

export async function changeUserRole(
  tenantId: string, userId: string, newRole: TenantRoleCode,
  options: { actorPlatformUserId?: string; ip?: string; branchId?: string | null } = {},
) {
  const role = tenantRole(newRole);
  if (!role) throw new ValidationError(`Unknown role "${newRole}".`);

  const result = await asTenant(tenantId, async (tx) => {
    const current = await tx.maybeOne<{ id: string; default_branch_id: string | null }>(
      `select id, default_branch_id from app_user where id = $1 and deleted_at is null`, [userId]);
    if (!current) throw new NotFoundError('User', userId);

    const branchId = options.branchId !== undefined ? options.branchId : current.default_branch_id;
    if (isAdminRole(newRole)) await assertBranchHasNoAdmin(tx, branchId, userId);

    return tx.one(
      `update app_user set role_code = $2, default_branch_id = $3, updated_at = now()
        where id = $1 returning *`,
      [userId, newRole, branchId]);
  });

  if (options.actorPlatformUserId) {
    await asPlatform(async (tx) => {
      await audit(tx, options.actorPlatformUserId!, 'user.role_change', {
        tenantId, targetType: 'app_user', targetId: userId, changes: { role: newRole }, ip: options.ip,
      });
    });
  }
  return result;
}

/*
 * `createPlatformUser` used to live here.
 *
 * There is exactly one super admin now, seeded by `npm run seed:superadmin`.
 * Creating operators through the API would make the one account that can reach
 * every tenant something a form could multiply, which is not a thing to leave
 * lying around.
 */

/** Everything the super admin's tenant detail screen needs. */
export async function tenantDetail(tenantId: string) {
  const header = await asPlatform(async (tx) => {
    const tenant = await tx.maybeOne<Record<string, unknown>>(`select * from tenant where id = $1`, [tenantId]);
    if (!tenant) throw new NotFoundError('Tenant', tenantId);
    return tenant;
  });

  const inner = await asTenant(tenantId, async (tx: Tx) => {
    const [branches, users, modules] = await Promise.all([
      // Each branch carries its admin, so the panel can show at a glance which
      // branches still have nobody running them.
      tx.query(`select b.*,
                       (select count(*) from stock_location l where l.branch_id = b.id) as location_count,
                       (select u.full_name from app_user u
                         where u.default_branch_id = b.id and u.role_code = 'admin'
                           and u.is_active = true and u.deleted_at is null limit 1) as admin_name,
                       (select u.email from app_user u
                         where u.default_branch_id = b.id and u.role_code = 'admin'
                           and u.is_active = true and u.deleted_at is null limit 1) as admin_email
                  from branch b where b.deleted_at is null order by b.code`),
      tx.query(`select u.id, u.email, u.full_name, u.phone, u.is_active, u.last_login_at, u.created_at,
                       u.default_branch_id, u.role_code, b.name as branch_name, b.code as branch_code
                  from app_user u
                  left join branch b on b.id = u.default_branch_id
                 where u.deleted_at is null
                 order by (u.role_code = 'admin') desc, b.code nulls first, u.full_name`),
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
    globalAdmin: users.find((u) => u.role_code === 'admin' && u.default_branch_id === null) ?? null,
    modules: (inner.modules as Array<Record<string, unknown>>).map((m) => ({
      ...m,
      name: catalog.get(m.module_key as string)?.name ?? m.module_key,
      group: catalog.get(m.module_key as string)?.group ?? 'core',
    })),
  };
}
