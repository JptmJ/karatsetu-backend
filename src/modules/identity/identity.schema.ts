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
    email: col.text({ notNull: true }),
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
    role_code: col.enum(TENANT_ROLE_CODES, { notNull: true, default: "'sales'" }),
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
  uniques: [{ columns: ['email'] }],
  indexes: [
    { columns: ['role_code'] },
    { columns: ['default_branch_id'], where: 'default_branch_id is not null' },
    /**
     * A branch has exactly one admin.
     *
     * `nulls not distinct` makes the all-branches admin (default_branch_id
     * null) collide with itself too, so the same one index covers both halves
     * of the rule: one admin per branch, and one admin for all branches.
     * Partial, so deactivated and deleted rows do not hold a slot.
     */
    {
      name: 'ux_app_user_one_admin_per_branch',
      columns: ['tenant_id', 'default_branch_id'],
      unique: true,
      nullsNotDistinct: true,
      where: "role_code = 'admin' and is_active = true and deleted_at is null",
    },
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
    token_hash: col.text({ notNull: true, comment: 'sha256 of the token — the token itself is never stored.' }),
    expires_at: col.timestamptz({ notNull: true }),
    revoked_at: col.timestamptz(),
    user_agent: col.text(),
    ip_address: col.text(),
  },
  indexes: [{ columns: ['token_hash'], unique: true }, { columns: ['user_id'] }],
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
