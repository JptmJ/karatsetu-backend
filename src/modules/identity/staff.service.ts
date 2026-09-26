/**
 * Tenant-side staff and role management. Every change obeys three rules:
 *  1. No escalation — you can only grant permissions you hold, at branches you manage.
 *  2. No lockout   — the business always keeps an active every-branch Owner.
 *  3. Changes bite — affected users' token_version is bumped; old access stops within 60s.
 */
import { randomBytes } from 'node:crypto';
import type { Tx } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import { hasPermission } from './permissions.js';
import { hashPassword, normalizePhone } from './auth.service.js';
import { invalidateUserAccess, type UserAccess } from './access.service.js';
import { assertKnownPermissions } from './permission-catalog.js';

const OWNER = 'owner';
export interface Assignment { roleId: string; branchId: string | null }
interface CurrentAssignment extends Assignment { permissions: string[] }

// ── guards ────────────────────────────────────────────────────────────────

/** For branchId = null ("every branch"), only the actor's every-branch grants count. */
const grantsAt = (actor: UserAccess, branchId: string | null) =>
  actor.grants.filter((g) => g.branchId === null || g.branchId === branchId);

const canManageUsersAt = (actor: UserAccess, branchId: string | null): boolean =>
  grantsAt(actor, branchId).some((g) => hasPermission(new Set(g.permissions), 'settings.users.manage'));

function assertNoEscalation(actor: UserAccess, permissions: string[], branchId: string | null): void {
  const held = new Set(grantsAt(actor, branchId).flatMap((g) => g.permissions));
  const missing = permissions.filter((p) => !hasPermission(held, p));
  if (missing.length) {
    throw new ForbiddenError(`You cannot grant permissions you do not hold yourself: ${missing.join(', ')}`);
  }
}

async function assertOwnerRemains(tx: Tx): Promise<void> {
  const { n } = await tx.one<{ n: number }>(
    `select count(*)::int as n
       from user_role ur
       join role r on r.id = ur.role_id and r.code = $1 and r.is_active and r.deleted_at is null
       join app_user u on u.id = ur.user_id and u.is_active and u.deleted_at is null
      where ur.branch_id is null`,
    [OWNER],
  );
  if (n === 0) {
    throw new ValidationError('This change would leave the business without an active Owner. Make someone else an Owner first.');
  }
}

async function currentAssignments(tx: Tx, userId: string): Promise<CurrentAssignment[]> {
  return tx.query<CurrentAssignment>(
    `select ur.role_id as "roleId", ur.branch_id as "branchId",
            coalesce(array_agg(rp.permission) filter (where rp.permission is not null), '{}') as permissions
       from user_role ur
       left join role_permission rp on rp.role_id = ur.role_id
      where ur.user_id = $1
      group by ur.role_id, ur.branch_id`,
    [userId],
  );
}

/** The actor must be able to manage — and could have granted — everything the user holds today. */
async function assertCanManageUser(tx: Tx, actor: UserAccess, userId: string): Promise<CurrentAssignment[]> {
  const user = await tx.maybeOne(`select id from app_user where id = $1 and deleted_at is null for update`, [userId]);
  if (!user) throw new NotFoundError('app_user', userId);

  const current = await currentAssignments(tx, userId);
  if (current.length === 0 && !canManageUsersAt(actor, null)) {
    throw new ForbiddenError('Only someone who manages every branch can change this user.');
  }
  for (const a of current) {
    if (!canManageUsersAt(actor, a.branchId)) {
      throw new ForbiddenError('This user has access you do not manage. Ask an Owner to change it.');
    }
    assertNoEscalation(actor, a.permissions, a.branchId);
  }
  return current;
}

async function endSessions(tx: Tx, userIds: string[], revokeRefresh: boolean): Promise<void> {
  if (userIds.length === 0) return;
  await tx.query(`update app_user set token_version = token_version + 1 where id = any($1::uuid[])`, [userIds]);
  if (revokeRefresh) {
    await tx.query(`update refresh_token set revoked_at = now() where user_id = any($1::uuid[]) and revoked_at is null`, [userIds]);
  }
  for (const id of userIds) invalidateUserAccess(tx.context.tenantId, id);
}

async function audit(tx: Tx, action: string, table: string, id: string, changes?: unknown): Promise<void> {
  await repo(tx, 'audit_log').insert({
    user_id: tx.context.userId, branch_id: tx.context.branchId, action,
    entity_table: table, entity_id: id,
    changes: changes === undefined ? null : JSON.stringify(changes),
    request_id: tx.context.requestId,
  });
}

const tempPassword = (): string => randomBytes(9).toString('base64url');

async function assertIdentifierFree(tx: Tx, email: string | null, phone: string | null, exceptId: string | null): Promise<void> {
  const clash = await tx.maybeOne<{ email: string | null; phone: string | null }>(
    `select email, phone from app_user
      where deleted_at is null and id is distinct from $3::uuid
        and ((email = $1::text and $1::text is not null) or (phone = $2::text and $2::text is not null))
      limit 1`,
    [email, phone, exceptId],
  );
  if (clash) {
    throw new ValidationError(clash.email && clash.email === email
      ? 'Someone in this business already uses that email.'
      : 'Someone in this business already uses that mobile number.');
  }
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

const slug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export async function createRole(
  tx: Tx, actor: UserAccess, input: { name: string; description?: string | null; permissions: string[] },
) {
  const permissions = [...new Set(input.permissions)];
  assertKnownPermissions(permissions);
  assertNoEscalation(actor, permissions, null);

  const code = slug(input.name);
  if (!code) throw new ValidationError('Give the role a name with at least one letter or number.');
  if (await tx.maybeOne(`select 1 from role where code = $1 and deleted_at is null`, [code])) {
    throw new ValidationError(`A role called "${input.name.trim()}" already exists.`);
  }

  const role = await repo<{ id: string }>(tx, 'role').insert({
    code, name: input.name.trim(), description: input.description ?? null, is_system: false,
  });
  await repo(tx, 'role_permission').insertMany(permissions.map((permission) => ({ role_id: role.id, permission })));
  await audit(tx, 'role.create', 'role', role.id, { name: input.name, permissions });
  return { id: role.id };
}

export async function updateRole(
  tx: Tx, actor: UserAccess, id: string,
  input: { name?: string; description?: string | null; permissions?: string[]; isActive?: boolean },
) {
  const role = await tx.maybeOne<{ code: string }>(
    `select code from role where id = $1 and deleted_at is null for update`, [id],
  );
  if (!role) throw new NotFoundError('role', id);
  if (role.code === OWNER && (input.permissions !== undefined || input.isActive === false)) {
    throw new ValidationError('The Owner role always has full access. It cannot be restricted or disabled.');
  }

  // You may only edit a role whose current powers you could have granted.
  const before = await tx.query<{ permission: string }>(`select permission from role_permission where role_id = $1`, [id]);
  assertNoEscalation(actor, before.map((b) => b.permission), null);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (Object.keys(patch).length) await repo(tx, 'role').update(id, patch);

  if (input.permissions !== undefined) {
    const permissions = [...new Set(input.permissions)];
    assertKnownPermissions(permissions);
    assertNoEscalation(actor, permissions, null);
    await tx.query(`delete from role_permission where role_id = $1`, [id]);
    await repo(tx, 'role_permission').insertMany(permissions.map((permission) => ({ role_id: id, permission })));
  }

  if (input.permissions !== undefined || input.isActive !== undefined) {
    const holders = await tx.query<{ user_id: string }>(`select distinct user_id from user_role where role_id = $1`, [id]);
    await endSessions(tx, holders.map((h) => h.user_id), false);
  }
  await audit(tx, 'role.update', 'role', id, { before: before.map((b) => b.permission), ...input });
}

export async function deleteRole(tx: Tx, actor: UserAccess, id: string) {
  const role = await tx.maybeOne<{ is_system: boolean }>(
    `select is_system from role where id = $1 and deleted_at is null for update`, [id],
  );
  if (!role) throw new NotFoundError('role', id);
  if (role.is_system) throw new ValidationError('Built-in roles cannot be deleted. You can rename or disable them instead.');
  if (!canManageUsersAt(actor, null)) throw new ForbiddenError('Only someone who manages every branch can delete roles.');

  const { n } = await tx.one<{ n: number }>(`select count(*)::int as n from user_role where role_id = $1`, [id]);
  if (n > 0) throw new ValidationError(`This role is given to ${n} user(s). Move them to another role first.`);

  await repo(tx, 'role').remove(id);
  await audit(tx, 'role.delete', 'role', id);
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

async function writeAssignments(
  tx: Tx, actor: UserAccess, userId: string, next: Assignment[], current: CurrentAssignment[],
): Promise<Assignment[]> {
  const unique = [...new Map(next.map((a) => [`${a.roleId}:${a.branchId}`, a])).values()];
  if (unique.length === 0) throw new ValidationError('Give the user at least one role.');

  const roles = await tx.query<{ id: string; permissions: string[] }>(
    `select r.id, coalesce(array_agg(rp.permission) filter (where rp.permission is not null), '{}') as permissions
       from role r left join role_permission rp on rp.role_id = r.id
      where r.id = any($1::uuid[]) and r.is_active and r.deleted_at is null
      group by r.id`,
    [[...new Set(unique.map((a) => a.roleId))]],
  );
  const rolePermissions = new Map(roles.map((r) => [r.id, r.permissions]));

  const branchIds = [...new Set(unique.map((a) => a.branchId).filter((b): b is string => b !== null))];
  if (branchIds.length) {
    const found = await tx.query(`select id from branch where id = any($1::uuid[]) and is_active and deleted_at is null`, [branchIds]);
    if (found.length !== branchIds.length) throw new ValidationError('One of the selected branches does not exist or is closed.');
  }

  for (const a of unique) {
    const permissions = rolePermissions.get(a.roleId);
    if (!permissions) throw new ValidationError('One of the selected roles does not exist or is disabled.');
    if (!canManageUsersAt(actor, a.branchId)) {
      throw new ForbiddenError(a.branchId
        ? 'You cannot manage staff at that branch.'
        : 'Only someone who manages every branch can give access to every branch.');
    }
    assertNoEscalation(actor, permissions, a.branchId);
  }
  for (const a of current) {
    if (!canManageUsersAt(actor, a.branchId)) throw new ForbiddenError('This user has access you do not manage. Ask an Owner to change it.');
  }

  await tx.query(`delete from user_role where user_id = $1`, [userId]);
  await repo(tx, 'user_role').insertMany(unique.map((a) => ({ user_id: userId, role_id: a.roleId, branch_id: a.branchId })));
  return unique;
}

export async function createUser(
  tx: Tx, actor: UserAccess,
  input: { fullName: string; email?: string | null; phone?: string | null; password?: string; defaultBranchId?: string | null; assignments: Assignment[] },
) {
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (!email && !phone) throw new ValidationError('Enter an email address or a mobile number.');
  await assertIdentifierFree(tx, email, phone, null);

  const password = input.password ?? tempPassword();
  const user = await repo<{ id: string }>(tx, 'app_user').insert({
    full_name: input.fullName.trim(), email, phone,
    password_hash: await hashPassword(password),
    default_branch_id: input.defaultBranchId ?? null,
    must_change_password: true, is_active: true,
  });
  const assignments = await writeAssignments(tx, actor, user.id, input.assignments, []);
  await audit(tx, 'user.create', 'app_user', user.id, { email, phone, assignments });

  // Shown once to the person creating the account; never stored in plain text.
  return { id: user.id, temporaryPassword: input.password ? null : password };
}

export async function updateUser(
  tx: Tx, actor: UserAccess, id: string,
  input: { fullName?: string; email?: string | null; phone?: string | null; defaultBranchId?: string | null },
) {
  await assertCanManageUser(tx, actor, id);
  const patch: Record<string, unknown> = {};
  if (input.fullName !== undefined) patch.full_name = input.fullName.trim();
  if (input.email !== undefined) patch.email = input.email?.trim().toLowerCase() || null;
  if (input.phone !== undefined) patch.phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (input.defaultBranchId !== undefined) patch.default_branch_id = input.defaultBranchId;
  if ('email' in patch || 'phone' in patch) {
    await assertIdentifierFree(tx, (patch.email as string | null) ?? null, (patch.phone as string | null) ?? null, id);
  }
  if (Object.keys(patch).length) await repo(tx, 'app_user').update(id, patch);
  await audit(tx, 'user.update', 'app_user', id, patch);
}

export async function replaceAssignments(tx: Tx, actor: UserAccess, id: string, next: Assignment[]) {
  const current = await assertCanManageUser(tx, actor, id);
  const assignments = await writeAssignments(tx, actor, id, next, current);
  await assertOwnerRemains(tx);
  await endSessions(tx, [id], false);
  await audit(tx, 'user.roles_change', 'app_user', id, { from: current.map(({ roleId, branchId }) => ({ roleId, branchId })), to: assignments });
}

export async function setUserActive(tx: Tx, actor: UserAccess, id: string, isActive: boolean) {
  if (!isActive && id === tx.context.userId) throw new ValidationError('You cannot deactivate your own account.');
  await assertCanManageUser(tx, actor, id);
  await repo(tx, 'app_user').update(id, { is_active: isActive });
  if (!isActive) {
    await assertOwnerRemains(tx);
    await endSessions(tx, [id], true);
  }
  await audit(tx, isActive ? 'user.activate' : 'user.deactivate', 'app_user', id);
}

export async function resetPassword(tx: Tx, actor: UserAccess, id: string) {
  await assertCanManageUser(tx, actor, id);
  const password = tempPassword();
  await repo(tx, 'app_user').update(id, {
    password_hash: await hashPassword(password), must_change_password: true,
    failed_login_count: 0, locked_until: null,
  });
  await endSessions(tx, [id], true);
  await audit(tx, 'user.password_reset', 'app_user', id);
  return { temporaryPassword: password };
}
