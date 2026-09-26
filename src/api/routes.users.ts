/**
 * Staff and roles, managed by the business itself. The Owner holds every
 * permission; anyone else needs settings.users.* / settings.roles.*.
 * All guard rules live in staff.service.ts.
 */
import { z } from 'zod';
import { defineRoute } from '../core/http/route-registry.js';
import { transaction } from '../core/db/client.js';
import { record, uuid } from './schemas.js';
import { permissionCatalog } from '../modules/identity/permission-catalog.js';
import * as staff from '../modules/identity/staff.service.js';

const TODAY = '2026-09-26';
const idParams = z.object({ id: uuid });
const assignment = z.object({ roleId: uuid, branchId: uuid.nullable().describe('Null = every branch.') });
const permissionList = z.array(z.string().min(1)).max(500);
// z.coerce.boolean() turns the string "false" into true — parse it explicitly.
const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');
const changed = (note: string) => [{ date: TODAY, kind: 'added' as const, note }];

defineRoute({
  method: 'get', path: '/api/settings/permissions', module: 'settings', permission: 'settings.roles.view',
  summary: 'Every permission a role can be given, grouped by module',
  responses: [{ status: 200, description: 'Catalog.', schema: z.object({ permissions: z.array(record) }) }],
  changelog: changed('Permission catalog for the role editor.'),
  handler: async () => ({ permissions: permissionCatalog() }),
});

defineRoute({
  method: 'get', path: '/api/settings/roles', module: 'settings', permission: 'settings.roles.view',
  summary: "This business's roles, their permissions and how many people hold each",
  responses: [{ status: 200, description: 'Roles.', schema: z.object({ rows: z.array(record) }) }],
  changelog: [{ date: TODAY, kind: 'changed', note: 'Roles are now per-business and editable.' }],
  handler: async () => transaction(async (tx) => ({ rows: await staff.listRoles(tx) })),
});

defineRoute({
  method: 'post', path: '/api/settings/roles', module: 'settings', permission: 'settings.roles.manage',
  summary: 'Create a role',
  body: z.object({ name: z.string().min(2).max(60), description: z.string().max(300).nullish(), permissions: permissionList }),
  responses: [{ status: 200, description: 'Created.', schema: z.object({ id: uuid }) }],
  changelog: changed('Custom roles.'),
  handler: async (req) => transaction((tx) => staff.createRole(tx, req.accessInfo!, req.body)),
});

defineRoute({
  method: 'put', path: '/api/settings/roles/:id', module: 'settings', permission: 'settings.roles.manage',
  summary: "Rename a role, change its permissions, or disable it",
  description: 'Changing permissions takes effect for everyone holding the role within a minute.',
  params: idParams,
  body: z.object({
    name: z.string().min(2).max(60).optional(), description: z.string().max(300).nullish(),
    permissions: permissionList.optional(), isActive: z.boolean().optional(),
  }),
  responses: [{ status: 204, description: 'Saved.' }],
  changelog: changed('Edit roles.'),
  handler: async (req) => { await transaction((tx) => staff.updateRole(tx, req.accessInfo!, req.params.id as string, req.body)); },
});

defineRoute({
  method: 'delete', path: '/api/settings/roles/:id', module: 'settings', permission: 'settings.roles.manage',
  summary: 'Delete a custom role that nobody holds',
  params: idParams,
  responses: [{ status: 204, description: 'Deleted.' }],
  changelog: changed('Delete custom roles.'),
  handler: async (req) => { await transaction((tx) => staff.deleteRole(tx, req.accessInfo!, req.params.id as string)); },
});

defineRoute({
  method: 'get', path: '/api/settings/users', module: 'settings', permission: 'settings.users.view',
  summary: 'Who works in this business, and their roles at each branch',
  query: z.object({ search: z.string().optional(), roleId: uuid.optional(), branchId: uuid.optional(), isActive: boolParam.optional() }),
  responses: [{ status: 200, description: 'Staff.', schema: z.object({ rows: z.array(record) }) }],
  changelog: [{ date: TODAY, kind: 'changed', note: 'Roles come from user_role; filter by roleId instead of role code.' }],
  handler: async (req) => transaction(async (tx) => ({ rows: await staff.listUsers(tx, req.query as never) })),
});

defineRoute({
  method: 'post', path: '/api/settings/users', module: 'settings', permission: 'settings.users.manage',
  summary: 'Add a staff member',
  description: 'Leave `password` empty to generate a temporary one — it is returned once and the user must change it at first sign-in.',
  body: z.object({
    fullName: z.string().min(2).max(120),
    email: z.string().email().nullish(), phone: z.string().min(10).max(16).nullish(),
    password: z.string().min(8).optional(), defaultBranchId: uuid.nullish(),
    assignments: z.array(assignment).min(1),
  }).refine((b) => b.email || b.phone, { message: 'Enter an email address or a mobile number.' }),
  responses: [{ status: 200, description: 'Created.', schema: z.object({ id: uuid, temporaryPassword: z.string().nullable() }) }],
  changelog: changed('Businesses add their own staff.'),
  handler: async (req) => transaction((tx) => staff.createUser(tx, req.accessInfo!, req.body)),
});

defineRoute({
  method: 'patch', path: '/api/settings/users/:id', module: 'settings', permission: 'settings.users.manage',
  summary: "Edit a staff member's name, contact or default branch",
  params: idParams,
  body: z.object({
    fullName: z.string().min(2).max(120).optional(), email: z.string().email().nullish(),
    phone: z.string().min(10).max(16).nullish(), defaultBranchId: uuid.nullish(),
  }),
  responses: [{ status: 204, description: 'Saved.' }],
  changelog: changed('Edit staff.'),
  handler: async (req) => { await transaction((tx) => staff.updateUser(tx, req.accessInfo!, req.params.id as string, req.body)); },
});

defineRoute({
  method: 'put', path: '/api/settings/users/:id/roles', module: 'settings', permission: 'settings.users.manage',
  summary: "Replace a staff member's roles",
  description: 'Send the complete list. Takes effect within a minute.',
  params: idParams,
  body: z.object({ assignments: z.array(assignment).min(1) }),
  responses: [{ status: 204, description: 'Saved.' }],
  changelog: changed('Assign roles per branch.'),
  handler: async (req) => { await transaction((tx) => staff.replaceAssignments(tx, req.accessInfo!, req.params.id as string, req.body.assignments)); },
});

defineRoute({
  method: 'post', path: '/api/settings/users/:id/status', module: 'settings', permission: 'settings.users.manage',
  summary: 'Activate or deactivate a staff member',
  description: 'Deactivating signs them out everywhere immediately.',
  params: idParams,
  body: z.object({ isActive: z.boolean() }),
  responses: [{ status: 204, description: 'Saved.' }],
  changelog: changed('Activate/deactivate staff.'),
  handler: async (req) => { await transaction((tx) => staff.setUserActive(tx, req.accessInfo!, req.params.id as string, req.body.isActive)); },
});

defineRoute({
  method: 'post', path: '/api/settings/users/:id/reset-password', module: 'settings', permission: 'settings.users.manage',
  summary: 'Give a staff member a new temporary password',
  description: 'Signs them out everywhere and unlocks the account. The temporary password is returned once.',
  params: idParams,
  responses: [{ status: 200, description: 'Reset.', schema: z.object({ temporaryPassword: z.string() }) }],
  changelog: changed('Password reset by an Owner or manager.'),
  handler: async (req) => transaction((tx) => staff.resetPassword(tx, req.accessInfo!, req.params.id as string)),
});
