/** Users, roles and permissions (Module 12.3). */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';
import { TENANT_ROLE_CODES } from '../platform/roles.js';

export const userTable = defineTable({
  name: 'app_user',
  module: 'identity',
  softDelete: true,
  comment: 'A person who can sign in. Scoped to one tenant. Created only by the super admin.',
  columns: {
    email: col.text(),
    phone: col.text(),
    full_name: col.text({ notNull: true }),
    password_hash: col.text({ notNull: true, comment: 'scrypt: salt:hash, both hex.' }),
    /**
     * The user's role, straight on the row.
     *
     * One role per person, fixed set, assigned only by the super admin — so a
     * join table would buy nothing and would make "one admin per branch"
     * impossible to express as a constraint.
     */
    /** DEPRECATED — read only by the role backfill. Dropped once backfill has run everywhere. */
    role_code: col.enum(TENANT_ROLE_CODES, { notNull: true, default: "'sales'" }),
    token_version: col.int({ notNull: true, default: '0', comment: 'Bumped on role change, deactivation or password reset — older access tokens stop working.' }),
    must_change_password: col.bool({ notNull: true, default: 'false' }),
    password_changed_at: col.timestamptz(),
    is_active: col.bool({ notNull: true, default: 'true' }),
    /**
     * Which branch this person belongs to. Null means all of them — for an
     * admin that is the single business-wide admin.
     */
    default_branch_id: col.fk('branch'),
    last_login_at: col.timestamptz(),
    failed_login_count: col.int({ notNull: true, default: '0' }),
    locked_until: col.timestamptz(),
  },
  indexes: [
    { name: 'ux_app_user_email', columns: ['email'], unique: true, where: 'email is not null and deleted_at is null' },
    { name: 'ux_app_user_phone', columns: ['phone'], unique: true, where: 'phone is not null and deleted_at is null' },
    { columns: ['default_branch_id'], where: 'default_branch_id is not null' },
  ],
  checks: [
    { name: 'email_lowercase', expression: 'email = lower(email)' },
    { name: 'email_or_phone', expression: 'email is not null or phone is not null' },
  ],
});

/*
 * `role` and `user_role` used to live here.
 *
 * They were built for tenant-definable, multi-role users. Neither is true any
 * more: the set is fixed in code and a person holds exactly one role, so the
 * role now sits on `app_user` and those two tables were dropped by
 * `npm run migrate:roles`.
 */

export const refreshTokenTable = defineTable({
  name: 'refresh_token',
  module: 'identity',
  columns: {
    user_id: col.fk('app_user', { notNull: true, onDelete: 'cascade' }),
    family_id: col.uuid({ notNull: true, default: 'gen_random_uuid()', comment: 'All rotations of one login share a family. Reuse of a rotated token revokes the family.' }),
    replaced_by_id: col.fk('refresh_token'),
    token_hash: col.text({ notNull: true, comment: 'sha256 of the token — the token itself is never stored.' }),
    expires_at: col.timestamptz({ notNull: true }),
    revoked_at: col.timestamptz(),
    persistent: col.bool({ notNull: true, default: 'true', comment: 'Remember me: 30-day cookie. False: browser-session cookie, 12 hours server-side.' }),
    user_agent: col.text(),
    ip_address: col.text(),
  },
  indexes: [
    { columns: ['token_hash'], unique: true, global: true },
    { columns: ['user_id'] },
    { columns: ['family_id'] },
  ],
});

/** Every meaningful action, kept for the life of the tenant. */
export const auditLogTable = defineTable({
  name: 'audit_log',
  module: 'identity',
  timestamps: false,
  columns: {
    at: col.timestamptz({ notNull: true, default: 'now()' }),
    user_id: col.fk('app_user'),
    branch_id: col.fk('branch'),
    action: col.text({ notNull: true, comment: 'e.g. "sales_invoice.post"' }),
    entity_table: col.text(),
    entity_id: col.uuid(),
    /** What changed: { before: {...}, after: {...} }. */
    changes: col.jsonb(),
    request_id: col.text(),
    ip_address: col.text(),
  },
  indexes: [
    { columns: ['at'] },
    { columns: ['entity_table', 'entity_id'] },
    { columns: ['user_id', 'at'] },
  ],
});

export const roleTable = defineTable({
  name: 'role',
  module: 'identity',
  softDelete: true,
  comment: 'Tenant-defined role. System roles are seeded from templates and cannot be deleted.',
  columns: {
    code: col.text({ notNull: true }),
    name: col.text({ notNull: true }),
    description: col.text(),
    is_system: col.bool({ notNull: true, default: 'false' }),
    is_active: col.bool({ notNull: true, default: 'true' }),
  },
  indexes: [{ name: 'ux_role_code', columns: ['code'], unique: true, where: 'deleted_at is null' }],
});

export const rolePermissionTable = defineTable({
  name: 'role_permission',
  module: 'identity',
  comment: 'Permission strings granted to a role, e.g. "pos.create" or "orders.*".',
  columns: {
    role_id: col.fk('role', { notNull: true, onDelete: 'cascade' }),
    permission: col.text({ notNull: true }),
  },
  uniques: [{ columns: ['role_id', 'permission'] }],
});

export const userRoleTable = defineTable({
  name: 'user_role',
  module: 'identity',
  comment: 'A role held by a user, at one branch or (branch_id null) at every branch.',
  columns: {
    user_id: col.fk('app_user', { notNull: true, onDelete: 'cascade' }),
    role_id: col.fk('role', { notNull: true }),
    branch_id: col.fk('branch'),
  },
  indexes: [
    { name: 'ux_user_role', columns: ['user_id', 'role_id', 'branch_id'], unique: true, nullsNotDistinct: true },
    { columns: ['role_id'] },
  ],
});
