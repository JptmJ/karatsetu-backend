/** Users, roles and permissions (Module 12.3). */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';

export const userTable = defineTable({
  name: 'app_user',
  module: 'identity',
  softDelete: true,
  comment: 'A person who can sign in. Scoped to one tenant.',
  columns: {
    email: col.text({ notNull: true }),
    phone: col.text(),
    full_name: col.text({ notNull: true }),
    password_hash: col.text({ notNull: true, comment: 'scrypt: salt:hash, both hex.' }),
    is_active: col.bool({ notNull: true, default: 'true' }),
    /** Null means the user can work at any branch. */
    default_branch_id: col.fk('branch'),
    last_login_at: col.timestamptz(),
    failed_login_count: col.int({ notNull: true, default: '0' }),
    locked_until: col.timestamptz(),
  },
  uniques: [{ columns: ['email'] }],
});

export const roleTable = defineTable({
  name: 'role',
  module: 'identity',
  comment: 'A named bundle of permissions, editable per tenant.',
  columns: {
    code: col.text({ notNull: true }),
    name: col.text({ notNull: true }),
    description: col.text(),
    /** System roles (owner, manager) cannot be deleted by the tenant. */
    is_system: col.bool({ notNull: true, default: 'false' }),
    /** ["trade.sales.create", "stock.*"] — "*" is a wildcard on any segment. */
    permissions: col.jsonb({ notNull: true, default: "'[]'::jsonb" }),
  },
  uniques: [{ columns: ['code'] }],
});

export const userRoleTable = defineTable({
  name: 'user_role',
  module: 'identity',
  timestamps: true,
  columns: {
    user_id: col.fk('app_user', { notNull: true, onDelete: 'cascade' }),
    role_id: col.fk('role', { notNull: true, onDelete: 'cascade' }),
    /** Null means the role applies at every branch. */
    branch_id: col.fk('branch'),
  },
  uniques: [{ columns: ['user_id', 'role_id', 'branch_id'], nullsNotDistinct: true }],
  indexes: [{ columns: ['user_id'] }],
});

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
