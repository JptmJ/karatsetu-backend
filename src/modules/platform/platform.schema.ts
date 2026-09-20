/**
 * Platform operators — the people who run the SaaS, not a jewellery business.
 *
 * Kept in their own table rather than as a flag on `app_user` because they are
 * genuinely different: they have no tenant, they sign in without a tenant code,
 * and every one of their actions crosses tenant boundaries. Mixing the two in
 * one table would mean every tenant query needed "...and not a platform user",
 * which is exactly the kind of condition that eventually gets forgotten.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';
import { SUPER_ADMIN } from './roles.js';

export const platformUserTable = defineTable({
  name: 'platform_user',
  module: 'platform',
  tenantScoped: false,
  softDelete: true,
  comment: 'The super admin. Exactly one row, seeded from the CLI — never created through the API.',
  columns: {
    email: col.text({ notNull: true, unique: true }),
    full_name: col.text({ notNull: true }),
    password_hash: col.text({ notNull: true }),
    /** Always 'super_admin'. Kept as a column so a second tier stays possible. */
    role: col.enum([SUPER_ADMIN.code], { notNull: true, default: "'super_admin'" }),
    phone: col.text(),
    is_active: col.bool({ notNull: true, default: 'true' }),
    last_login_at: col.timestamptz(),
    failed_login_count: col.int({ notNull: true, default: '0' }),
    locked_until: col.timestamptz(),
    /**
     * There is only ever one operator and it is seeded from the command line,
     * so this is always null today. Left in place so the table does not need
     * changing if a second tier is ever added.
     */
    created_by_platform_user_id: col.fk('platform_user'),
  },
  indexes: [{ columns: ['role'] }, { columns: ['is_active'] }],
});

export const platformRefreshTokenTable = defineTable({
  name: 'platform_refresh_token',
  module: 'platform',
  tenantScoped: false,
  columns: {
    platform_user_id: col.fk('platform_user', { notNull: true, onDelete: 'cascade' }),
    token_hash: col.text({ notNull: true }),
    expires_at: col.timestamptz({ notNull: true }),
    revoked_at: col.timestamptz(),
    user_agent: col.text(),
    ip_address: col.text(),
  },
  indexes: [{ columns: ['token_hash'], unique: true }, { columns: ['platform_user_id'] }],
});

/**
 * Everything a platform operator does, kept separately from the tenant audit
 * log. A tenant should be able to see that support touched their data without
 * being able to see every other tenant in the same table.
 */
export const platformAuditTable = defineTable({
  name: 'platform_audit_log',
  module: 'platform',
  tenantScoped: false,
  timestamps: false,
  columns: {
    at: col.timestamptz({ notNull: true, default: 'now()' }),
    platform_user_id: col.fk('platform_user'),
    action: col.text({ notNull: true, comment: 'e.g. "tenant.create", "tenant.suspend", "user.create"' }),
    target_tenant_id: col.fk('tenant'),
    target_type: col.text(),
    target_id: col.uuid(),
    changes: col.jsonb(),
    ip_address: col.text(),
    request_id: col.text(),
  },
  indexes: [
    { columns: ['at'] },
    { columns: ['platform_user_id', 'at'] },
    { columns: ['target_tenant_id', 'at'] },
  ],
});
