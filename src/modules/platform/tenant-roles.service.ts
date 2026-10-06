/**
 * Staff roles, defined per business by the super admin.
 *
 * `owner` and `admin` are seeded templates and fixed: narrowing an owner would
 * lock a shop out of its own books, and an admin is defined by running a branch.
 * Everything else is a `staff` role, named for the business that has it —
 * because one shop's "Accountant" handles billing and another's handles billing
 * and tagging, and a fixed ladder cannot express that.
 */
import { asPlatform, withTenant } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import {
  BusinessRuleError, ConflictError, NotFoundError, ValidationError,
} from '../../core/errors/app-error.js';
import { newId } from '../../core/util/id.js';
import { assertKnownPermissions } from '../identity/permission-catalog.js';
import { invalidateUserAccess } from '../identity/access.service.js';
import { audit } from './platform-auth.service.js';

export interface RoleRow {
  id: string; code: string; name: string; role_type: string;
  description: string | null; is_system: boolean; is_active: boolean;
  permissions: string[]; user_count: number;
}

const slug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export async function listTenantRoles(tenantId: string): Promise<{ rows: RoleRow[] }> {
  return asPlatform(async (tx) => withTenant(tx, tenantId, async (ttx) => ({
    rows: await ttx.query<RoleRow>(
      `select r.id, r.code, r.name, r.role_type, r.description, r.is_system, r.is_active,
              coalesce((select array_agg(rp.permission order by rp.permission)
                          from role_permission rp where rp.role_id = r.id), '{}') as permissions,
              (select count(distinct ur.user_id)::int
                 from user_role ur join app_user u on u.id = ur.user_id and u.deleted_at is null
                where ur.role_id = r.id) as user_count
         from role r
        where r.deleted_at is null
        order by case r.role_type when 'owner' then 0 when 'admin' then 1 else 2 end, r.name`),
  })));
}

/** Replaces a role's permission rows with exactly this list. */
async function setPermissions(ttx: Parameters<typeof repo>[0], roleId: string, permissions: string[]) {
  await ttx.query(`delete from role_permission where role_id = $1`, [roleId]);
  for (const permission of [...new Set(permissions)]) {
    await ttx.query(
      `insert into role_permission (id, tenant_id, role_id, permission, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $5) on conflict do nothing`,
      [newId(), ttx.context.tenantId, roleId, permission, ttx.context.userId],
    );
  }
}

export interface CreateRoleInput {
  name: string;
  description?: string | null;
  permissions: string[];
}

export async function createStaffRole(
  tenantId: string, input: CreateRoleInput, operatorId: string, ip?: string,
): Promise<RoleRow> {
  if (!input.permissions.length) {
    throw new ValidationError('Give the role at least one permission, or it can do nothing at all.');
  }
  assertKnownPermissions(input.permissions);

  const code = slug(input.name);
  if (!code) throw new ValidationError('That name has no letters or numbers in it.');
  if (code === 'owner' || code === 'admin') {
    throw new ValidationError(`"${input.name}" is reserved. Owner and Branch Admin already exist.`);
  }

  const id = await asPlatform(async (tx) => {
    const roleId = await withTenant(tx, tenantId, async (ttx) => {
      const clash = await ttx.maybeOne<{ id: string }>(
        `select id from role where code = $1 and deleted_at is null`, [code]);
      if (clash) throw new ConflictError(`This business already has a role called "${input.name}".`);

      const role = await repo<{ id: string }>(ttx, 'role').insert({
        code, name: input.name.trim(), role_type: 'staff',
        description: input.description ?? null, is_system: false, is_active: true,
      });
      await setPermissions(ttx, role.id, input.permissions);
      return role.id;
    });

    await audit(tx, operatorId, 'role.create', {
      tenantId, targetType: 'role', targetId: roleId, ip,
      changes: { name: input.name, permissions: input.permissions },
    });
    return roleId;
  });

  const { rows } = await listTenantRoles(tenantId);
  return rows.find((r) => r.id === id)!;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  permissions?: string[];
  isActive?: boolean;
}

export async function updateStaffRole(
  tenantId: string, roleId: string, changes: UpdateRoleInput, operatorId: string, ip?: string,
): Promise<RoleRow> {
  if (changes.permissions) {
    if (!changes.permissions.length) {
      throw new ValidationError('Give the role at least one permission, or it can do nothing at all.');
    }
    assertKnownPermissions(changes.permissions);
  }

  await asPlatform(async (tx) => {
    await withTenant(tx, tenantId, async (ttx) => {
      const role = await ttx.maybeOne<{ id: string; role_type: string; name: string }>(
        `select id, role_type, name from role where id = $1 and deleted_at is null for update`, [roleId]);
      if (!role) throw new NotFoundError('Role', roleId);

      /*
       * Owner and Branch Admin are what they are. Owner holds everything by
       * definition, and an admin that cannot run a branch is not an admin —
       * make a staff role instead.
       */
      if (role.role_type !== 'staff') {
        throw new BusinessRuleError(
          `${role.name} is a fixed role and cannot be edited. Create a staff role instead.`,
          'role_is_fixed',
        );
      }

      const sets: string[] = [];
      const params: unknown[] = [roleId];
      if (changes.name !== undefined) { params.push(changes.name.trim()); sets.push(`name = $${params.length}`); }
      if (changes.description !== undefined) { params.push(changes.description); sets.push(`description = $${params.length}`); }
      if (changes.isActive !== undefined) { params.push(changes.isActive); sets.push(`is_active = $${params.length}`); }
      if (sets.length) {
        await ttx.query(`update role set ${sets.join(', ')}, updated_at = now() where id = $1`, params);
      }

      if (changes.permissions) await setPermissions(ttx, roleId, changes.permissions);

      /*
       * Everyone holding this role is carrying stale grants until their token
       * turns over, so push them all now rather than leaving it to expiry.
       */
      const holders = await ttx.query<{ user_id: string }>(
        `select distinct user_id from user_role where role_id = $1`, [roleId]);
      if (holders.length) {
        await ttx.query(
          `update app_user set token_version = token_version + 1 where id = any($1::uuid[])`,
          [holders.map((h) => h.user_id)]);
        for (const h of holders) invalidateUserAccess(tenantId, h.user_id);
      }
    });

    await audit(tx, operatorId, 'role.update', {
      tenantId, targetType: 'role', targetId: roleId, ip, changes,
    });
  });

  const { rows } = await listTenantRoles(tenantId);
  return rows.find((r) => r.id === roleId)!;
}

export async function deleteStaffRole(
  tenantId: string, roleId: string, operatorId: string, ip?: string,
): Promise<void> {
  await asPlatform(async (tx) => {
    await withTenant(tx, tenantId, async (ttx) => {
      const role = await ttx.maybeOne<{ id: string; role_type: string; name: string }>(
        `select id, role_type, name from role where id = $1 and deleted_at is null`, [roleId]);
      if (!role) throw new NotFoundError('Role', roleId);
      if (role.role_type !== 'staff') {
        throw new BusinessRuleError(`${role.name} is a fixed role and cannot be deleted.`, 'role_is_fixed');
      }

      const held = await ttx.one<{ n: number }>(
        `select count(distinct ur.user_id)::int n
           from user_role ur join app_user u on u.id = ur.user_id and u.deleted_at is null
          where ur.role_id = $1`, [roleId]);
      if (held.n > 0) {
        throw new BusinessRuleError(
          `${held.n} ${held.n === 1 ? 'person holds' : 'people hold'} this role. Move them to another role first.`,
          'role_in_use',
        );
      }

      await ttx.query(`delete from role_permission where role_id = $1`, [roleId]);
      await ttx.query(`update role set deleted_at = now() where id = $1`, [roleId]);
    });

    await audit(tx, operatorId, 'role.delete', { tenantId, targetType: 'role', targetId: roleId, ip });
  });
}
