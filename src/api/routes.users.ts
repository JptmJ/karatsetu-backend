/**
 * Staff and roles, as seen from inside a business — read-only.
 *
 * A shop can look at who works there, what each role can do, and nothing else.
 * Creating staff, moving them between branches, changing a role, resetting a
 * password and defining roles are all the super admin's, through
 * `/api/platform/*`. The endpoints that used to do those things here are gone
 * rather than merely permission-gated: a rule the panel states in print should
 * not depend on a permission string staying absent from one role.
 *
 * The super admin equivalents are:
 *   POST   /api/platform/tenants/:id/users
 *   PATCH  /api/platform/tenants/:id/users/:userId
 *   POST   /api/platform/tenants/:id/users/:userId/reset-password
 *   GET    /api/platform/roles
 */
import { z } from 'zod';
import { defineRoute } from '../core/http/route-registry.js';
import { transaction } from '../core/db/client.js';
import { boolParam, errorEnvelope, record, uuid } from './schemas.js';
import { permissionCatalog } from '../modules/identity/permission-catalog.js';
import * as staff from '../modules/identity/staff.service.js';

const TODAY = '2026-09-26';
/** The day staff and role management moved to the super admin for good. */
const LOCKED_DAY = '2026-10-03';
const changed = (note: string) => [{ date: TODAY, kind: 'added' as const, note }];

/** Everything removed on the day roles were fixed, listed once. */
const REMOVED = [
  { date: LOCKED_DAY, kind: 'removed' as const, note: 'POST /api/settings/users — the super admin creates staff.' },
  { date: LOCKED_DAY, kind: 'removed' as const, note: 'PATCH /api/settings/users/:id — edit staff from the platform panel.' },
  { date: LOCKED_DAY, kind: 'removed' as const, note: 'PUT /api/settings/users/:id/roles — only the super admin assigns a role.' },
  { date: LOCKED_DAY, kind: 'removed' as const, note: 'POST /api/settings/users/:id/status — activation is the super admin’s.' },
  { date: LOCKED_DAY, kind: 'removed' as const, note: 'POST /api/settings/users/:id/reset-password — replaced by the platform reset.' },
  { date: LOCKED_DAY, kind: 'removed' as const, note: 'POST/PUT/DELETE /api/settings/roles — roles are fixed in code.' },
];

defineRoute({
  method: 'get', path: '/api/settings/permissions', module: 'settings', permission: 'settings.roles.view',
  summary: 'Every permission a role can hold, grouped by module',
  description:
    'Reference only. Roles are fixed in code, so nothing here can be assigned or combined into a new role from inside a business.',
  responses: [{ status: 200, description: 'Catalog.', schema: z.object({ permissions: z.array(record) }) }],
  changelog: [
    ...changed('Permission catalog for the role editor.'),
    { date: LOCKED_DAY, kind: 'changed', note: 'Reference only now that the role editor is gone.' },
  ],
  handler: async () => ({ permissions: permissionCatalog() }),
});

defineRoute({
  method: 'get', path: '/api/settings/roles', module: 'settings', permission: 'settings.roles.view',
  summary: "The roles in this business, their permissions and how many people hold each",
  description:
    'Fixed in code and seeded per business. A shop can see what each role can do; only the super admin decides who holds one.',
  responses: [{ status: 200, description: 'Roles.', schema: z.object({ rows: z.array(record) }) }],
  changelog: [
    { date: TODAY, kind: 'changed', note: 'Roles are now per-business and editable.' },
    ...REMOVED.filter((r) => r.note.includes('/api/settings/roles')),
    { date: LOCKED_DAY, kind: 'changed', note: 'Read-only: roles are fixed in code again, and a business cannot create or edit one.' },
  ],
  handler: async () => transaction(async (tx) => ({ rows: await staff.listRoles(tx) })),
});

defineRoute({
  method: 'get', path: '/api/settings/users', module: 'settings', permission: 'settings.users.view',
  summary: 'Who works in this business, and their roles at each branch',
  description:
    'Staff are created, named and given their access by the super admin. From inside the business the list is read-only, apart from switching someone off — see `POST /api/settings/users/:id/status`.',
  query: z.object({ search: z.string().optional(), roleId: uuid.optional(), branchId: uuid.optional(), isActive: boolParam.optional() }),
  responses: [{ status: 200, description: 'Staff.', schema: z.object({ rows: z.array(record) }) }],
  changelog: [
    { date: TODAY, kind: 'changed', note: 'Roles come from user_role; filter by roleId instead of role code.' },
    ...REMOVED.filter((r) => r.note.includes('/api/settings/users')),
  ],
  handler: async (req) => transaction(async (tx) => ({ rows: await staff.listUsers(tx, req.query as never) })),
});

defineRoute({
  method: 'post', path: '/api/settings/users/:id/status', module: 'settings',
  permission: 'settings.users.status',
  summary: 'Switch a staff account on or off',
  description:
    'The one change a business may make to its own people, because somebody leaving at short notice should not wait on us. Deactivating signs them out everywhere immediately.\n\nEverything else about a staff member — creating them, their name, their role, what it reaches — stays with the super admin. An owner cannot be deactivated here, and nobody can switch off their own account.',
  params: z.object({ id: uuid }),
  body: z.object({ isActive: z.boolean() }),
  responses: [
    { status: 204, description: 'Saved.' },
    { status: 404, description: 'No such person.', schema: errorEnvelope },
    { status: 422, description: 'Your own account, or the business owner.', schema: errorEnvelope },
  ],
  changelog: [
    ...REMOVED.filter((r) => r.note.includes('/status')),
    { date: LOCKED_DAY, kind: 'added', note: 'Returned, narrowed to activation alone, for a shop admin.' },
  ],
  handler: async (req) => {
    await transaction((tx) => staff.setUserActive(tx, req.ctx!.userId!, req.params.id as string, req.body.isActive));
  },
});
