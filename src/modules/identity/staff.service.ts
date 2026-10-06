/**
 * Tenant-side staff and role queries. Reads only.
 *
 * This file used to own staff and role management for the business itself, with
 * its own escalation and lockout guards. All of it is gone: staff are created,
 * edited, moved, deactivated and password-reset by the super admin through
 * `/api/platform/*`, and roles are fixed in code rather than rows a business can
 * add to.
 *
 * The mutations were deleted rather than left behind unused, because a
 * well-meaning route added later would quietly reopen the rule that nobody
 * inside a jewellery business manages people. What a shop can still do is look:
 * who works here, and what each role is allowed to touch.
 *
 * The super admin equivalents live in
 * `src/modules/platform/provisioning.service.ts`.
 */
import type { Tx } from '../../core/db/client.js';
import { BusinessRuleError, NotFoundError } from '../../core/errors/app-error.js';
import { invalidateUserAccess } from './access.service.js';
import { OWNER_ROLE } from '../platform/roles.js';

// ── the one write a business may make ─────────────────────────────────────

/**
 * Switch a staff account on or off.
 *
 * The single exception to "staff are the super admin's": somebody leaving at
 * short notice should not wait on us to cut their access. Everything else about
 * a person — creating them, their role, what it reaches — still is.
 *
 * Two things it refuses, because both leave a shop worse off than before:
 * deactivating the owner, and deactivating yourself.
 */
export async function setUserActive(
  tx: Tx, actorUserId: string, userId: string, isActive: boolean,
): Promise<void> {
  if (userId === actorUserId) {
    throw new BusinessRuleError('You cannot deactivate your own account.', 'self_deactivate');
  }

  const user = await tx.maybeOne<{ id: string; is_active: boolean }>(
    `select id, is_active from app_user where id = $1 and deleted_at is null`, [userId]);
  if (!user) throw new NotFoundError('User', userId);

  if (!isActive) {
    const owner = await tx.maybeOne<{ id: string }>(
      `select u.id from app_user u
         join user_role ur on ur.user_id = u.id
         join role r on r.id = ur.role_id
        where u.id = $1 and r.code = $2 and r.deleted_at is null`,
      [userId, OWNER_ROLE]);
    if (owner) {
      throw new BusinessRuleError(
        'The owner’s account cannot be switched off from here. Contact Swarnay.',
        'owner_protected',
      );
    }
  }

  await tx.query(
    `update app_user set is_active = $2, token_version = token_version + 1, updated_at = now()
      where id = $1`, [userId, isActive]);

  if (!isActive) {
    // Signed out everywhere at once, not whenever their token happens to lapse.
    await tx.query(
      `update refresh_token set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
  }
  invalidateUserAccess(tx.context.tenantId, userId);
}

// ── roles ─────────────────────────────────────────────────────────────────

export function listRoles(tx: Tx) {
  return tx.query(
    `select r.id, r.code, r.name, r.description, r.is_system as "isSystem", r.is_active as "isActive",
            coalesce((select array_agg(rp.permission order by rp.permission)
                        from role_permission rp where rp.role_id = r.id), '{}') as permissions,
            (select count(distinct ur.user_id)::int
               from user_role ur join app_user u on u.id = ur.user_id and u.deleted_at is null
              where ur.role_id = r.id) as "userCount"
       from role r
      where r.deleted_at is null
      order by r.is_system desc, r.name`,
  );
}

// ── users ─────────────────────────────────────────────────────────────────

export function listUsers(
  tx: Tx, filters: { search?: string; roleId?: string; branchId?: string; isActive?: boolean },
) {
  const params: unknown[] = [];
  const where = ['u.deleted_at is null'];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(u.full_name ilike $${params.length} or u.email ilike $${params.length} or u.phone ilike $${params.length})`);
  }
  if (filters.isActive !== undefined) { params.push(filters.isActive); where.push(`u.is_active = $${params.length}`); }
  if (filters.roleId) {
    params.push(filters.roleId);
    where.push(`exists (select 1 from user_role x where x.user_id = u.id and x.role_id = $${params.length})`);
  }
  if (filters.branchId) {
    params.push(filters.branchId);
    where.push(`exists (select 1 from user_role x where x.user_id = u.id and (x.branch_id = $${params.length} or x.branch_id is null))`);
  }

  return tx.query(
    `select u.id, u.full_name as "fullName", u.email, u.phone, u.is_active as "isActive",
            u.must_change_password as "mustChangePassword", u.last_login_at as "lastLoginAt",
            u.default_branch_id as "defaultBranchId", u.created_at as "createdAt",
            coalesce(json_agg(json_build_object(
                'roleId', r.id, 'roleName', r.name, 'roleCode', r.code,
                'branchId', ur.branch_id, 'branchName', b.name) order by r.name)
              filter (where ur.id is not null), '[]') as assignments
       from app_user u
       left join user_role ur on ur.user_id = u.id
       left join role r on r.id = ur.role_id
       left join branch b on b.id = ur.branch_id
      where ${where.join(' and ')}
      group by u.id
      order by u.full_name
      limit 500`,
    params,
  );
}
