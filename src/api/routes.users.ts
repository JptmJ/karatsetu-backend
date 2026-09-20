/**
 * Staff, seen from inside a tenant — read-only.
 *
 * Creating, promoting and deactivating users is the super admin's job and only
 * the super admin's. A branch admin can look up who works here and what they
 * can do, and that is all. Two reasons it is worth being strict about:
 *
 *   - every account on the platform stays traceable to one person, so "who
 *     made this login" always has an answer;
 *   - a compromised shop account cannot mint more shop accounts.
 *
 * The write endpoints that used to live here (`POST /api/settings/users`,
 * `PATCH /api/settings/users/:id`) are gone. Use the super admin panel.
 */
import { z } from 'zod';
import { defineRoute } from '../core/http/route-registry.js';
import { transaction } from '../core/db/client.js';
import { TENANT_ROLES } from '../modules/platform/roles.js';
import { record, uuid } from './schemas.js';

const TODAY = '2026-09-20';

defineRoute({
  method: 'get', path: '/api/settings/roles', module: 'settings',
  summary: 'The four roles and what each can do',
  description:
    'Reference only. Roles are fixed in code and assigned by the super admin — there is no endpoint here to assign one.',
  permission: 'settings.users.view',
  responses: [{ status: 200, description: 'Roles.', schema: z.object({
    roles: z.array(record),
    assignable: z.array(z.string()).describe('Always empty — tenants do not assign roles.'),
  }) }],
  changelog: [
    { date: TODAY, kind: 'changed', note: 'Now reference-only. `assignable` is always empty.' },
  ],
  handler: async () => ({ roles: TENANT_ROLES, assignable: [] }),
});

defineRoute({
  method: 'get', path: '/api/settings/users', module: 'settings',
  summary: 'Who works in this business',
  description: 'Read-only. Ask the super admin to add or change anyone.',
  permission: 'settings.users.view',
  query: z.object({
    search: z.string().optional(),
    role: z.enum(TENANT_ROLES.map((r) => r.code) as [string, ...string[]]).optional(),
    isActive: z.coerce.boolean().optional(),
    branchId: uuid.optional(),
  }),
  responses: [{ status: 200, description: 'Staff.', schema: z.object({ rows: z.array(record) }) }],
  changelog: [
    { date: TODAY, kind: 'changed', note: 'Role now comes from app_user.role_code; user_role was dropped.' },
  ],
  handler: async (req) => transaction(async (tx) => {
    const q = req.query as Record<string, unknown>;
    const clauses = ['u.deleted_at is null'];
    const params: unknown[] = [];

    if (q.search) {
      params.push(`%${q.search}%`);
      clauses.push(`(u.full_name ilike $${params.length} or u.email ilike $${params.length})`);
    }
    if (q.role) { params.push(q.role); clauses.push(`u.role_code = $${params.length}`); }
    if (q.isActive !== undefined) { params.push(q.isActive); clauses.push(`u.is_active = $${params.length}`); }
    if (q.branchId) { params.push(q.branchId); clauses.push(`u.default_branch_id = $${params.length}`); }

    const rows = await tx.query(
      `select u.id, u.email, u.full_name, u.phone, u.is_active, u.last_login_at, u.created_at,
              u.default_branch_id, u.role_code, b.name as branch_name, b.code as branch_code
         from app_user u
         left join branch b on b.id = u.default_branch_id
        where ${clauses.join(' and ')}
        order by (u.role_code = 'admin') desc, b.code nulls first, u.full_name`,
      params,
    );

    const names = new Map<string, string>(TENANT_ROLES.map((r) => [r.code as string, r.name as string]));
    return { rows: rows.map((r) => ({ ...r, role_name: names.get(String(r.role_code)) ?? r.role_code })) };
  }),
});
