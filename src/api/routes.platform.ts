/**
 * Super Admin API.
 *
 * Every route here is platform-scoped: it needs a platform token, not a tenant
 * one, and it deliberately crosses tenant boundaries. These are wired onto a
 * separate router in `app.ts` so a tenant token can never reach them.
 */
import { z } from 'zod';
import { defineRoute, queryOf } from '../core/http/route-registry.js';
import { transaction, asPlatform, asTenant } from '../core/db/client.js';
import { param, platformUserId } from '../core/http/middleware.js';
import { NotFoundError } from '../core/errors/app-error.js';
import { audit, platformLogin, platformLogout, platformRefresh } from '../modules/platform/platform-auth.service.js';
import {
  changeUserRole, createBranch, createTenant,
  createTenantUser, resetTenantUserPassword, setUserActive, tenantDetail,
  updateTenant, updateTenantUserDetails,
} from '../modules/platform/provisioning.service.js';
import {
  platformPermissionsFor, platformRole, ROLE_TYPES, SUPER_ADMIN,
  TENANT_ROLES, TENANT_ROLE_CODES,
} from '../modules/platform/roles.js';
import { permissionTree } from '../modules/identity/permission-catalog.js';
import {
  createStaffRole, deleteStaffRole, listTenantRoles, updateStaffRole,
} from '../modules/platform/tenant-roles.service.js';
import {
  endSupportSession, listSupportSessions, MAX_DURATION_MINUTES, startSupportSession,
} from '../modules/platform/support-session.service.js';
import { MODULE_CATALOG } from '../modules/tenancy/module-catalog.js';
import { errorEnvelope, gstin, idParam, listOf, pagination, pan, phone, record, uuid } from './schemas.js';

const TODAY = '2026-09-18';
/** The day the two role tiers and the real support-session flow landed. */
const ROLES_DAY = '2026-10-03';
/** The day roles became owner / branch admin / named staff roles. */
const TYPES_DAY = '2026-10-04';
const M = 'platform';
const seed = [{ date: TODAY, kind: 'added' as const, note: 'Super admin RBAC: tenants, branches, users.' }];

const roleCode = z.enum(TENANT_ROLE_CODES as [string, ...string[]]);

/* ------------------------------------------------------------- auth */

defineRoute({
  method: 'post', path: '/api/platform/auth/login', module: M, auth: false,
  summary: 'Super admin sign-in',
  description:
    'No tenant code — platform operators do not belong to a tenant. The token returned is a *platform* token and is rejected by every tenant route, and vice versa.',
  body: z.object({ email: z.string().email(), password: z.string().min(1) }),
  responses: [
    { status: 200, description: 'Signed in.', schema: z.object({
        accessToken: z.string(), refreshToken: z.string(),
        user: z.object({ id: uuid, email: z.string(), fullName: z.string(), role: z.string(), roleName: z.string() }),
        permissions: z.array(z.string()),
      }) },
    { status: 401, description: 'Wrong credentials, deactivated, or locked after 5 failed attempts.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => platformLogin(req.body.email, req.body.password, {
    userAgent: req.headers['user-agent'], ip: req.ip,
  }),
});

defineRoute({
  method: 'post', path: '/api/platform/auth/refresh', module: M, auth: false,
  summary: 'Refresh a platform session',
  body: z.object({ refreshToken: z.string().min(1) }),
  responses: [
    { status: 200, description: 'New access token.', schema: z.object({ accessToken: z.string() }) },
    { status: 401, description: 'Expired or revoked.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => platformRefresh(req.body.refreshToken),
});

defineRoute({
  method: 'post', path: '/api/platform/auth/logout', module: M, auth: false,
  summary: 'Revoke a platform refresh token',
  body: z.object({ refreshToken: z.string().min(1) }),
  responses: [{ status: 204, description: 'Revoked.' }],
  changelog: seed,
  handler: async (req, res) => { await platformLogout(req.body.refreshToken); res.status(204).end(); },
});

/* ------------------------------------------------------------ roles */

defineRoute({
  method: 'get', path: '/api/platform/roles', module: M,
  summary: 'The role templates',
  description:
    'One platform role, holding everything. Inside a business there are three kinds: `owner`, `admin` and `staff`. Only the first two are seeded — staff roles are named and given their permissions per business, because one shop’s accountant is not another’s. `isBranchAdmin` marks the role limited to one holder per branch.',
  responses: [{ status: 200, description: 'Platform and tenant roles.', schema: z.object({
    platform: z.object({
      code: z.string(), name: z.string(), description: z.string(), permissions: z.array(z.string()),
    }),
    roleTypes: z.array(z.string()),
    tenant: z.array(z.object({
      code: z.string(), name: z.string(), type: z.string(), description: z.string(),
      isBranchAdmin: z.boolean(), permissions: z.array(z.string()),
    })),
  }) }],
  changelog: [
    { date: TODAY, kind: 'changed', note: 'Roles reduced to four: admin, sales, accountant, storekeeper. `owner` and `manager` are gone — both are now `admin`.' },
    { date: ROLES_DAY, kind: 'changed', note: '`platform` is now the four platform roles with their permissions, not the single super admin.' },
    { date: TYPES_DAY, kind: 'changed', note: 'Back to one platform role holding `*`. Tenant roles are now owner, admin and any number of named staff roles.' },
    { date: TYPES_DAY, kind: 'removed', note: 'sales, cashier, accountant and storekeeper — replaced by staff roles defined per business.' },
  ],
  handler: async () => ({ platform: SUPER_ADMIN, roleTypes: ROLE_TYPES, tenant: TENANT_ROLES }),
});

defineRoute({
  method: 'get', path: '/api/platform/permission-tree', module: M,
  summary: 'Every permission a staff role can be given, as module → group → action',
  description:
    'What the role builder ticks. Built from the live routes, so it cannot offer a switch the API does not enforce — if a permission is here, granting it genuinely grants something.\n\n`module` is the top level (Billing, Stock). `groups` are the areas within it, and a group whose key equals the module is that module’s own actions rather than a sub-area. `wildcard` on each level is the string to grant for "all of this".',
  permission: 'platform.tenants.view',
  responses: [{ status: 200, description: 'The tree.', schema: z.object({
    modules: z.array(z.object({
      key: z.string(), name: z.string(), wildcard: z.string(),
      groups: z.array(z.object({
        key: z.string(), name: z.string(), wildcard: z.string().nullable(),
        permissions: z.array(z.object({ code: z.string(), action: z.string(), description: z.string() })),
      })),
    })),
  }) }],
  changelog: [{ date: TYPES_DAY, kind: 'added', note: 'Backs the staff role builder.' }],
  handler: async () => ({ modules: permissionTree() }),
});

defineRoute({
  method: 'get', path: '/api/platform/modules', module: M,
  summary: 'The module catalog, for provisioning',
  permission: 'platform.tenants.view',
  responses: [{ status: 200, description: 'All modules with their default licence.', schema: z.object({ modules: z.array(record) }) }],
  changelog: seed,
  handler: async () => ({
    modules: MODULE_CATALOG.map((m) => ({
      key: m.key, name: m.name, shortName: m.shortName, group: m.group,
      description: m.description, appliesTo: m.appliesTo, defaultLicence: m.defaultLicence,
    })),
  }),
});

/* ---------------------------------------------------------- tenants */

defineRoute({
  method: 'get', path: '/api/platform/tenants', module: M,
  summary: 'List every tenant',
  permission: 'platform.tenants.view',
  query: z.object({
    status: z.enum(['trial', 'active', 'suspended', 'closed']).optional(),
    kind: z.enum(['manufacturer', 'retailer', 'both']).optional(),
    search: z.string().optional().describe('Matches code or name.'),
  }).merge(pagination),
  responses: [{ status: 200, description: 'Tenants with user and branch counts.', schema: listOf(record) }],
  changelog: seed,
  handler: async (req) => asPlatform(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses = ['t.deleted_at is null']; const params: unknown[] = [];
    if (q.status) { params.push(q.status); clauses.push(`t.status = $${params.length}`); }
    if (q.kind) { params.push(q.kind); clauses.push(`t.kind = $${params.length}`); }
    if (q.search) { params.push(`%${q.search}%`); clauses.push(`(t.code ilike $${params.length} or t.display_name ilike $${params.length})`); }
    const where = `where ${clauses.join(' and ')}`;

    const rows = await tx.query(
      `select t.id, t.code, t.display_name, t.legal_name, t.kind, t.status, t.gstin,
              t.created_at, t.activated_at,
              (select count(*) from branch b where b.tenant_id = t.id and b.deleted_at is null) as branch_count,
              (select count(*) from app_user u where u.tenant_id = t.id and u.deleted_at is null) as user_count,
              (select count(*) from tenant_module m where m.tenant_id = t.id and m.enabled) as module_count,
              (select u.email from app_user u
                 join user_role ur on ur.user_id = u.id
                 join role r on r.id = ur.role_id and r.deleted_at is null
                where u.tenant_id = t.id and r.code in ('owner', 'admin')
                  and u.is_active = true and u.deleted_at is null
                order by case r.code when 'owner' then 0 else 1 end,
                         u.default_branch_id nulls first limit 1) as admin_email
         from tenant t ${where} order by t.created_at desc
        limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params);
    const counted = await tx.one<{ count: string }>(`select count(*)::text count from tenant t ${where}`, params);
    return { rows, total: Number(counted.count), limit: Number(q.limit ?? 50), offset: Number(q.offset ?? 0) };
  }),
});

defineRoute({
  method: 'post', path: '/api/platform/tenants', module: M,
  summary: 'Create a tenant with its Admin and first branch',
  description:
    'One call sets up everything a business needs to start: the tenant, its chart of accounts, purities, numbering series, the five roles, the head user (Admin) and the first branch with its stock locations. A half-created tenant is worse than none, so this does the lot.',
  permission: 'platform.tenants.create',
  body: z.object({
    code: z.string().regex(/^[a-z0-9][a-z0-9-]{1,29}$/, 'Lowercase letters, numbers and hyphens, 2–30 chars')
      .describe('Used at sign-in and in URLs. Cannot be changed later.'),
    legalName: z.string().min(1), displayName: z.string().optional(),
    kind: z.enum(['manufacturer', 'retailer', 'both']).default('retailer')
      .describe('Decides which modules the tenant can see at all.'),
    gstin: gstin.optional(), pan: pan.optional(),
    stateCode: z.string().max(2).optional().describe('GST state code — decides CGST+SGST vs IGST.'),
    maxBranches: z.number().int().min(1).max(500).nullish()
      .describe('How many branches they may have. Omit for no limit.'),
    admin: z.object({
      email: z.string().email(), fullName: z.string().min(1),
      password: z.string().min(8).describe('At least 8 characters.'),
      phone: phone.optional(),
    }).describe('The head user. Gets the Admin role and can then create all other staff.'),
    branch: z.object({
      code: z.string().min(1).max(20), name: z.string().min(1),
      kind: z.enum(['showroom', 'factory', 'warehouse', 'office']).optional(),
      city: z.string().optional(), state: z.string().optional(), stateCode: z.string().max(2).optional(),
    }).optional().describe('Omit to get a default "MAIN" branch.'),
    modules: z.array(z.object({
      key: z.string(), licence: z.enum(['included', 'purchased', 'trial']),
      trialDays: z.number().int().min(1).max(365).optional(),
    })).optional().describe('Omit to use each module’s default licence.'),
  }),
  responses: [
    { status: 201, description: 'Tenant ready to use.', schema: z.object({ tenantId: uuid, branchId: uuid, adminUserId: uuid }) },
    { status: 400, description: 'Invalid code or a password under 8 characters.', schema: errorEnvelope },
    { status: 409, description: 'That tenant code is taken.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req, res) => {
    const out = await createTenant(req.body, platformUserId(req), req.ip);
    res.status(201).json(out);
  },
});

defineRoute({
  method: 'get', path: '/api/platform/tenants/:id', module: M,
  summary: 'One tenant with its branches, users and module licences',
  description:
    'The staff list is included only for a role holding `platform.users.view`. A Billing Admin can see the business and its licences without seeing who works there.',
  permission: 'platform.tenants.view', params: idParam,
  responses: [
    { status: 200, description: 'Everything the tenant detail screen needs.', schema: z.object({
      tenant: record, branches: z.array(record), users: z.array(record), modules: z.array(record) }) },
    { status: 404, description: 'No such tenant.', schema: errorEnvelope },
  ],
  changelog: [
    ...seed,
    { date: TYPES_DAY, kind: 'changed', note: 'Staff are no longer withheld: there is one operator and it holds everything.' },
  ],
  handler: async (req) => tenantDetail(param(req, 'id')),
});

defineRoute({
  method: 'patch', path: '/api/platform/tenants/:id', module: M,
  summary: 'Update a tenant',
  description:
    'Setting `status` to `suspended` blocks every user of that tenant from signing in. Their data is untouched.',
  permission: 'platform.tenants.update', params: idParam,
  body: z.object({
    displayName: z.string().min(1).optional(), legalName: z.string().min(1).optional(),
    status: z.enum(['trial', 'active', 'suspended', 'closed']).optional(),
    kind: z.enum(['manufacturer', 'retailer', 'both']).optional(),
    gstin: gstin.optional(), pan: pan.optional(),
    maxBranches: z.number().int().min(1).max(500).nullish()
      .describe('How many branches this business may have. Null means no limit.'),
  }),
  responses: [
    { status: 200, description: 'Updated.', schema: record },
    { status: 404, description: 'No such tenant.', schema: errorEnvelope },
  ],
  changelog: [
    ...seed,
    { date: TYPES_DAY, kind: 'removed', note: 'The separate suspend permission is gone with the other platform roles.' },
  ],
  handler: async (req) => updateTenant(param(req, 'id'), req.body, platformUserId(req), req.ip),
});

/* --------------------------------------------------------- branches */

/* ------------------------------------------------------ staff roles */

defineRoute({
  method: 'get', path: '/api/platform/tenants/:id/roles', module: M,
  summary: 'The roles this business has',
  description:
    'Owner and Branch Admin are seeded and fixed. Everything else is a staff role you named and gave permissions to. `user_count` is how many people hold each.',
  permission: 'platform.tenants.view', params: idParam,
  responses: [{ status: 200, description: 'Roles with their permissions.', schema: z.object({ rows: z.array(record) }) }],
  changelog: [{ date: TYPES_DAY, kind: 'added', note: 'Staff roles are defined per business.' }],
  handler: async (req) => listTenantRoles(param(req, 'id')),
});

defineRoute({
  method: 'post', path: '/api/platform/tenants/:id/roles', module: M,
  summary: 'Create a staff role for this business',
  description:
    'The code is derived from the name. Permissions must come from `GET /api/platform/permission-tree` — anything else is refused, so a role cannot be given a right that nothing enforces.\n\nOnly staff roles can be created: Owner and Branch Admin already exist and are fixed.',
  permission: 'platform.tenants.update', params: idParam,
  body: z.object({
    name: z.string().min(2).max(60),
    description: z.string().max(300).nullish(),
    permissions: z.array(z.string().min(1)).min(1).max(500),
  }),
  responses: [
    { status: 201, description: 'Created.', schema: record },
    { status: 400, description: 'An unknown permission, or a reserved name.', schema: errorEnvelope },
    { status: 409, description: 'This business already has a role with that name.', schema: errorEnvelope },
  ],
  changelog: [{ date: TYPES_DAY, kind: 'added', note: 'Staff roles are defined per business.' }],
  handler: async (req, res) => {
    const role = await createStaffRole(param(req, 'id'), req.body, platformUserId(req)!, req.ip);
    res.status(201).json(role);
  },
});

defineRoute({
  method: 'patch', path: '/api/platform/tenants/:id/roles/:roleId', module: M,
  summary: 'Rename a staff role, or change what it can reach',
  description:
    'Send the complete permission list, not a delta. Everyone holding the role is signed back in against the new list immediately rather than at token expiry.',
  permission: 'platform.tenants.update',
  params: z.object({ id: uuid, roleId: uuid }),
  body: z.object({
    name: z.string().min(2).max(60).optional(),
    description: z.string().max(300).nullish(),
    permissions: z.array(z.string().min(1)).min(1).max(500).optional(),
    isActive: z.boolean().optional(),
  }),
  responses: [
    { status: 200, description: 'Updated.', schema: record },
    { status: 404, description: 'No such role.', schema: errorEnvelope },
    { status: 422, description: 'Owner and Branch Admin are fixed.', schema: errorEnvelope },
  ],
  changelog: [{ date: TYPES_DAY, kind: 'added', note: 'Staff roles are defined per business.' }],
  handler: async (req) => updateStaffRole(
    param(req, 'id'), param(req, 'roleId'), req.body, platformUserId(req)!, req.ip),
});

defineRoute({
  method: 'delete', path: '/api/platform/tenants/:id/roles/:roleId', module: M,
  summary: 'Delete a staff role nobody holds',
  permission: 'platform.tenants.update',
  params: z.object({ id: uuid, roleId: uuid }),
  responses: [
    { status: 204, description: 'Deleted.' },
    { status: 422, description: 'Still held by somebody, or a fixed role.', schema: errorEnvelope },
  ],
  changelog: [{ date: TYPES_DAY, kind: 'added', note: 'Staff roles are defined per business.' }],
  handler: async (req, res) => {
    await deleteStaffRole(param(req, 'id'), param(req, 'roleId'), platformUserId(req)!, req.ip);
    res.status(204).end();
  },
});

/* --------------------------------------------------------- branches */

defineRoute({
  method: 'post', path: '/api/platform/tenants/:id/branches', module: M,
  summary: 'Add a branch to a tenant',
  description:
    'Creates the branch together with its stock locations and its own document numbering series — without those the first invoice at that branch would fail.',
  permission: 'platform.tenants.update', params: idParam,
  body: z.object({
    code: z.string().min(1).max(20), name: z.string().min(1),
    kind: z.enum(['showroom', 'factory', 'warehouse', 'office']).default('showroom'),
    gstin: gstin.optional(), stateCode: z.string().max(2).optional(),
    city: z.string().optional(), state: z.string().optional(),
    address_line1: z.string().optional(), pincode: z.string().optional(),
    phone: phone.optional(), email: z.string().email().optional(),
  }),
  responses: [
    { status: 201, description: 'Branch created, with locations and numbering.', schema: record },
    { status: 409, description: 'That branch code already exists in this tenant.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req, res) => {
    const branch = await createBranch(param(req, 'id'), req.body, platformUserId(req), req.ip);
    res.status(201).json(branch);
  },
});

/* ------------------------------------------------------------ users */

defineRoute({
  method: 'post', path: '/api/platform/tenants/:id/users', module: M,
  summary: 'Create a user inside a tenant',
  description:
    'Only you can do this — nobody inside the business can create users. Give `branchId` to place the person at one branch; leave it out and they cover all branches. A branch has exactly one admin, so creating a second one for the same branch is refused with `409` naming whoever already holds the slot.',
  permission: 'platform.users.create', params: idParam,
  body: z.object({
    email: z.string().email().nullish(),
    phone: phone.nullish(),
    fullName: z.string().min(1),
    password: z.string().min(8),
    roleCode: z.string().min(1).default('sales'),
    role: z.string().min(1).optional(),
    branchId: uuid.optional().describe('Their branch. Omit to cover all branches.'),
  }).refine((b) => b.email || b.phone, { message: 'Enter an email address or a mobile number.' }),
  responses: [
    { status: 201, description: 'User created.', schema: record },
    { status: 409, description: 'Email already used here, or that branch already has an admin.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req, res) => {
    const roleCode = req.body.roleCode ?? req.body.role ?? 'sales';
    const user = await createTenantUser(
      param(req, 'id'),
      {
        email: req.body.email,
        phone: req.body.phone,
        fullName: req.body.fullName,
        password: req.body.password,
        roleCode,
        branchId: req.body.branchId,
      },
      { actorPlatformUserId: platformUserId(req), ip: req.ip },
    );
    res.status(201).json(user);
  },
});

defineRoute({
  method: 'patch', path: '/api/platform/tenants/:id/users/:userId', module: M,
  summary: 'Change a user’s role, branch, contact details or activation',
  description:
    'Moving someone to `admin`, or moving an existing admin to another branch, is refused if that branch already has one. The only admin in a business cannot be deactivated — the shop would be left with nobody able to run it.\n\nName and contact editing lives here because it has no tenant-side equivalent: a shop cannot edit its own staff, so without this a misspelled name could never be corrected.',
  permission: 'platform.users.update',
  params: z.object({ id: uuid, userId: uuid }),
  body: z.object({
    roleCode: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    branchId: uuid.nullish().describe('Null moves them to all branches. Omit to leave their branch alone.'),
    isActive: z.boolean().optional(),
    fullName: z.string().min(1).max(120).optional(),
    email: z.string().email().nullish(),
    phone: phone.nullish(),
  }),
  responses: [
    { status: 200, description: 'Updated.', schema: record },
    { status: 409, description: 'That branch already has an admin.', schema: errorEnvelope },
    { status: 422, description: 'Would leave the business with no admin.', schema: errorEnvelope },
  ],
  changelog: [
    ...seed,
    { date: ROLES_DAY, kind: 'fixed', note: '`branchId` was declared and silently ignored — a branch move did nothing. It now moves the user and their role grant together.' },
    { date: ROLES_DAY, kind: 'added', note: 'Name, email and phone, which no longer have a tenant-side route.' },
  ],
  handler: async (req) => {
    const tenantId = param(req, 'id');
    const userId = param(req, 'userId');
    const actor = platformUserId(req)!;
    const b = req.body;
    let result: unknown = null;

    const targetRole = b.roleCode ?? b.role;
    if (targetRole) {
      // The role change owns the branch move when both arrive together, so the
      // branch-admin check sees the new role and the new branch at once.
      result = await changeUserRole(tenantId, userId, targetRole, actor, b.branchId);
    }

    const details = {
      ...(b.fullName !== undefined ? { fullName: b.fullName } : {}),
      ...(b.email !== undefined ? { email: b.email } : {}),
      ...(b.phone !== undefined ? { phone: b.phone } : {}),
      ...(b.branchId !== undefined && !targetRole ? { branchId: b.branchId } : {}),
    };
    if (Object.keys(details).length) {
      result = await updateTenantUserDetails(tenantId, userId, details, actor, req.ip);
    }

    if (b.isActive !== undefined) {
      result = await setUserActive(tenantId, userId, b.isActive, { actorPlatformUserId: actor, ip: req.ip });
    }
    return result ?? { ok: true };
  },
});

defineRoute({
  method: 'post', path: '/api/platform/tenants/:id/users/:userId/reset-password', module: M,
  summary: 'Give a tenant user a new temporary password',
  description:
    'The recovery path for a locked-out shop, and the only one: staff are yours to manage, so the tenant-side reset no longer exists. The password is returned once and never stored in readable form. They are signed out everywhere and must set a new password at next sign-in.',
  permission: 'platform.users.reset_password',
  params: z.object({ id: uuid, userId: uuid }),
  responses: [
    { status: 200, description: 'Reset.', schema: z.object({ temporaryPassword: z.string() }) },
    { status: 404, description: 'No such user.', schema: errorEnvelope },
  ],
  changelog: [{ date: ROLES_DAY, kind: 'added', note: 'Replaces the removed tenant-side staff password reset.' }],
  handler: async (req) => resetTenantUserPassword(
    param(req, 'id'), param(req, 'userId'), platformUserId(req)!, req.ip),
});

/* ------------------------------------------------- platform operators */

defineRoute({
  method: 'get', path: '/api/platform/me', module: M,
  summary: 'The signed-in operator, with their role and permissions',
  description:
    'What this operator may actually do, so a panel can hide what they cannot reach rather than letting them find a 403. Only `super_admin` has an account today and it is seeded from the command line — there is no endpoint that creates an operator.',
  responses: [{ status: 200, description: 'The operator.', schema: z.object({
    id: uuid, email: z.string(), full_name: z.string(), role: z.string(),
    roleName: z.string(), roleDescription: z.string(), permissions: z.array(z.string()),
    phone: z.string().nullable(), is_active: z.boolean(),
    last_login_at: z.string().nullable(), created_at: z.string(),
  }) }],
  changelog: [
    { date: TODAY, kind: 'added', note: 'Replaces GET /api/platform/admins.' },
    { date: TODAY, kind: 'removed', note: 'POST /api/platform/admins is gone — operators are no longer creatable.' },
    { date: ROLES_DAY, kind: 'added', note: 'Role name, description and the permissions actually held.' },
  ],
  handler: async (req) => {
    const row = await asPlatform(async (tx) =>
      tx.one<{ role: string }>(`select id, email, full_name, role, phone, is_active, last_login_at, created_at
                                  from platform_user where id = $1`, [platformUserId(req)]));
    const role = platformRole(row.role);
    return {
      ...row,
      roleName: role?.name ?? row.role,
      roleDescription: role?.description ?? '',
      permissions: platformPermissionsFor(row.role),
    };
  },
});

defineRoute({
  method: 'get', path: '/api/platform/audit', module: M,
  summary: 'Platform audit log',
  description: 'Every super-admin action, newest first.',
  permission: 'platform.audit.view',
  query: z.object({ tenantId: uuid.optional(), action: z.string().optional() }).merge(pagination),
  responses: [{ status: 200, description: 'Audit entries.', schema: z.object({ rows: z.array(record) }) }],
  changelog: seed,
  handler: async (req) => asPlatform(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    if (q.tenantId) { params.push(q.tenantId); clauses.push(`a.target_tenant_id = $${params.length}`); }
    if (q.action) { params.push(q.action); clauses.push(`a.action = $${params.length}`); }
    return { rows: await tx.query(
      `select a.*, u.full_name as operator_name, u.email as operator_email, t.code as tenant_code
         from platform_audit_log a
         left join platform_user u on u.id = a.platform_user_id
         left join tenant t on t.id = a.target_tenant_id
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
        order by a.at desc limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params) };
  }),
});

defineRoute({
  method: 'get', path: '/api/platform/stats', module: M,
  summary: 'Platform-wide counts for the super admin dashboard',
  permission: 'platform.tenants.view',
  responses: [{ status: 200, description: 'Headline numbers.', schema: z.object({
    tenants: z.object({ total: z.number(), active: z.number(), trial: z.number(), suspended: z.number() }),
    users: z.number(), branches: z.number(), operators: z.number(),
  }) }],
  changelog: seed,
  handler: async () => asPlatform(async (tx) => {
    const r = await tx.one<Record<string, string>>(
      `select
         (select count(*) from tenant where deleted_at is null)::text total,
         (select count(*) from tenant where status='active' and deleted_at is null)::text active,
         (select count(*) from tenant where status='trial' and deleted_at is null)::text trial,
         (select count(*) from tenant where status='suspended' and deleted_at is null)::text suspended,
         (select count(*) from app_user where deleted_at is null)::text users,
         (select count(*) from branch where deleted_at is null)::text branches,
         (select count(*) from platform_user where deleted_at is null)::text operators`);
    const n = (key: string): number => Number(r[key] ?? 0);
    return {
      tenants: { total: n('total'), active: n('active'), trial: n('trial'), suspended: n('suspended') },
      users: n('users'), branches: n('branches'), operators: n('operators'),
    };
  }),
});

/* --------------------------------------------- licensing & support */

defineRoute({
  method: 'put', path: '/api/platform/tenants/:id/modules/:moduleKey', module: M,
  summary: 'Change a tenant\u2019s module entitlement',
  description:
    'Grant, revoke, or move a module between included / purchased / trial. A module whose trial or term has lapsed still appears in the tenant\u2019s dock, but locked \u2014 so they can see what they are missing rather than having it silently vanish.',
  permission: 'platform.entitlement.update',
  params: z.object({ id: uuid, moduleKey: z.string().min(1) }),
  body: z.object({
    enabled: z.boolean().optional(),
    licence: z.enum(['included', 'purchased', 'trial', 'expired']).optional(),
    trialEndsAt: z.string().datetime().nullish(),
    expiresAt: z.string().datetime().nullish(),
    disabledSubmodules: z.array(z.string()).optional().describe('Sub-module keys to hide, e.g. ["orders.repair"].'),
  }),
  responses: [
    { status: 200, description: 'Entitlement updated.', schema: record },
    { status: 403, description: 'Not a super admin.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Module entitlement controller.' }],
  handler: async (req) => asPlatform(async (tx) => {
    const b = req.body;
    const row = await tx.one(
      `insert into tenant_module (id, tenant_id, module_key, enabled, licence, trial_ends_at, expires_at, disabled_submodules)
       values (gen_random_uuid(), $1, $2, coalesce($3, true), coalesce($4,'included'), $5, $6, coalesce($7,'[]'::jsonb))
       on conflict (tenant_id, module_key) do update
         set enabled = coalesce($3, tenant_module.enabled),
             licence = coalesce($4, tenant_module.licence),
             trial_ends_at = $5, expires_at = $6,
             disabled_submodules = coalesce($7, tenant_module.disabled_submodules),
             updated_at = now()
       returning *`,
      [param(req, 'id'), param(req, 'moduleKey'), b.enabled ?? null, b.licence ?? null,
       b.trialEndsAt ?? null, b.expiresAt ?? null,
       b.disabledSubmodules ? JSON.stringify(b.disabledSubmodules) : null]);
    await audit(tx, platformUserId(req), 'module.entitlement', {
      tenantId: param(req, 'id'), targetType: 'tenant_module', changes: b, ip: req.ip });
    return row;
  }),
});

defineRoute({
  method: 'post', path: '/api/platform/support-sessions', module: M,
  summary: 'Start a support session into a tenant',
  description:
    'The only way a platform role reaches business data. Returns a `token` to send as `Authorization: Bearer` against ordinary tenant endpoints \u2014 it is shown once and stored only as a hash, so a lost token means opening a new session.\n\nRead-only unless `canWrite` is set. The session row is checked on every request, so ending it locks the operator out at once rather than when the token would have expired. Every action inside the window is tagged with the session in the tenant\u2019s own audit log.',
  permission: 'platform.support.create',
  body: z.object({
    tenantId: uuid, reason: z.string().min(5).max(500),
    durationMinutes: z.number().int().min(5).max(MAX_DURATION_MINUTES).default(120),
    canWrite: z.boolean().default(false).describe('Needs `platform.support.write`. A deliberate escalation.'),
  }),
  responses: [
    { status: 201, description: 'Session opened.', schema: z.object({
      session: record, token: z.string(), endsAt: z.string() }) },
    { status: 403, description: 'Write access asked for without `platform.support.write`.', schema: errorEnvelope },
    { status: 404, description: 'No such tenant.', schema: errorEnvelope },
  ],
  changelog: [
    { date: TODAY, kind: 'added', note: 'Support impersonation with a hard time limit.' },
    { date: ROLES_DAY, kind: 'fixed', note: 'The insert wrote a null operator into a not-null column that pointed at the wrong table, so this always failed. The operator is a `platform_user`.' },
    { date: ROLES_DAY, kind: 'added', note: 'A real session token, enforced per request against the row.' },
  ],
  handler: async (req, res) => {
    const out = await startSupportSession(
      req.body,
      { id: platformUserId(req)!, permissions: req.ctx!.permissions },
      req.ip,
    );
    res.status(201).json(out);
  },
});

defineRoute({
  method: 'get', path: '/api/platform/support-sessions', module: M,
  summary: 'Support sessions, open and past',
  description:
    'This is the record a tenant is shown when they ask who looked at their data. `action_count` is how many audited changes were made inside the window.',
  permission: 'platform.support.view',
  query: z.object({
    tenantId: uuid.optional(),
    openOnly: z.coerce.boolean().optional().describe('Only sessions still running.'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  responses: [{ status: 200, description: 'Sessions, newest first.', schema: z.object({ rows: z.array(record) }) }],
  changelog: [{ date: ROLES_DAY, kind: 'added', note: 'Support sessions were not listable.' }],
  handler: async (req) => listSupportSessions(queryOf<{
    tenantId?: string; openOnly?: boolean; limit: number }>(req)),
});

defineRoute({
  method: 'post', path: '/api/platform/support-sessions/:id/end', module: M,
  summary: 'Close a support session now',
  description: 'The operator\u2019s next request is refused. Closing also discards the token, so it cannot be reused.',
  permission: 'platform.support.end', params: idParam,
  responses: [
    { status: 200, description: 'Closed.', schema: record },
    { status: 400, description: 'Already closed.', schema: errorEnvelope },
    { status: 404, description: 'No such session.', schema: errorEnvelope },
  ],
  changelog: [{ date: ROLES_DAY, kind: 'added', note: 'A session could be opened but never closed early.' }],
  handler: async (req) => endSupportSession(param(req, 'id'), platformUserId(req)!, req.ip),
});
