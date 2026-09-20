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
import { audit, platformLogin, platformLogout, platformRefresh } from '../modules/platform/platform-auth.service.js';
import {
  changeUserRole, createBranch, createTenant,
  createTenantUser, setUserActive, tenantDetail, updateTenant,
} from '../modules/platform/provisioning.service.js';
import { SUPER_ADMIN, TENANT_ROLES, TENANT_ROLE_CODES } from '../modules/platform/roles.js';
import { MODULE_CATALOG } from '../modules/tenancy/module-catalog.js';
import { errorEnvelope, gstin, idParam, listOf, pagination, pan, phone, record, uuid } from './schemas.js';

const TODAY = '2026-09-18';
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
  summary: 'The fixed role set',
  description:
    'Four roles, fixed in code. Only you assign them — nobody inside a jewellery business can create or change a user. `isBranchAdmin` marks the role that is limited to one holder per branch.',
  responses: [{ status: 200, description: 'Platform and tenant roles.', schema: z.object({
    platform: z.object({ code: z.string(), name: z.string(), description: z.string() }),
    tenant: z.array(z.object({
      code: z.string(), name: z.string(), description: z.string(),
      isBranchAdmin: z.boolean(), permissions: z.array(z.string()),
    })),
  }) }],
  changelog: [
    { date: TODAY, kind: 'changed', note: 'Roles reduced to four: admin, sales, accountant, storekeeper. `owner` and `manager` are gone — both are now `admin`.' },
    { date: TODAY, kind: 'removed', note: 'Rank ladder removed. Tenants no longer assign roles at all.' },
  ],
  handler: async () => ({ platform: SUPER_ADMIN, tenant: TENANT_ROLES }),
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
                where u.tenant_id = t.id and u.role_code = 'admin'
                  and u.is_active = true and u.deleted_at is null
                order by u.default_branch_id nulls first limit 1) as admin_email
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
  permission: 'platform.tenants.view', params: idParam,
  responses: [
    { status: 200, description: 'Everything the tenant detail screen needs.', schema: z.object({
      tenant: record, branches: z.array(record), users: z.array(record), modules: z.array(record) }) },
    { status: 404, description: 'No such tenant.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => tenantDetail(param(req, 'id')),
});

defineRoute({
  method: 'patch', path: '/api/platform/tenants/:id', module: M,
  summary: 'Update a tenant',
  description: 'Setting `status` to `suspended` blocks every user of that tenant from signing in.',
  permission: 'platform.tenants.update', params: idParam,
  body: z.object({
    displayName: z.string().min(1).optional(), legalName: z.string().min(1).optional(),
    status: z.enum(['trial', 'active', 'suspended', 'closed']).optional(),
    kind: z.enum(['manufacturer', 'retailer', 'both']).optional(),
    gstin: gstin.optional(), pan: pan.optional(),
  }),
  responses: [
    { status: 200, description: 'Updated.', schema: record },
    { status: 404, description: 'No such tenant.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => updateTenant(param(req, 'id'), req.body, platformUserId(req), req.ip),
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
  permission: 'platform.tenants.update', params: idParam,
  body: z.object({
    email: z.string().email(), fullName: z.string().min(1),
    password: z.string().min(8), role: roleCode,
    phone: phone.optional(),
    branchId: uuid.optional().describe('Their branch. Omit to cover all branches.'),
  }),
  responses: [
    { status: 201, description: 'User created.', schema: record },
    { status: 409, description: 'Email already used here, or that branch already has an admin.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req, res) => {
    const user = await createTenantUser(
      param(req, 'id'), req.body,
      { actorPlatformUserId: platformUserId(req), ip: req.ip },
    );
    res.status(201).json(user);
  },
});

defineRoute({
  method: 'patch', path: '/api/platform/tenants/:id/users/:userId', module: M,
  summary: 'Change a user’s role, branch or activation',
  description:
    'Moving someone to `admin`, or moving an existing admin to another branch, is refused if that branch already has one. The only admin in a business cannot be deactivated — the shop would be left with nobody able to run it.',
  permission: 'platform.tenants.update',
  params: z.object({ id: uuid, userId: uuid }),
  body: z.object({
    role: roleCode.optional(),
    branchId: uuid.nullish().describe('Null moves them to all branches.'),
    isActive: z.boolean().optional(),
  }),
  responses: [
    { status: 200, description: 'Updated.', schema: record },
    { status: 409, description: 'That branch already has an admin.', schema: errorEnvelope },
    { status: 422, description: 'Would leave the business with no admin.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => {
    const tenantId = param(req, 'id');
    const userId = param(req, 'userId');
    const actor = platformUserId(req);
    let result: unknown = null;
    if (req.body.role || req.body.branchId !== undefined) {
      result = await changeUserRole(
        tenantId, userId, req.body.role ?? undefined as never,
        { actorPlatformUserId: actor, ip: req.ip, branchId: req.body.branchId },
      );
    }
    if (req.body.isActive !== undefined) {
      result = await setUserActive(tenantId, userId, req.body.isActive, { actorPlatformUserId: actor, ip: req.ip });
    }
    return result ?? { ok: true };
  },
});

/* ------------------------------------------------- platform operators */

defineRoute({
  method: 'get', path: '/api/platform/me', module: M,
  summary: 'The signed-in super admin',
  description:
    'There is exactly one super admin and it is seeded from the command line — there is no endpoint to create another.',
  responses: [{ status: 200, description: 'The operator.', schema: record }],
  changelog: [
    { date: TODAY, kind: 'added', note: 'Replaces GET /api/platform/admins.' },
    { date: TODAY, kind: 'removed', note: 'POST /api/platform/admins is gone — operators are no longer creatable.' },
  ],
  handler: async (req) => asPlatform(async (tx) =>
    tx.one(`select id, email, full_name, role, phone, is_active, last_login_at, created_at
              from platform_user where id = $1`, [platformUserId(req)])),
});

defineRoute({
  method: 'get', path: '/api/platform/audit', module: M,
  summary: 'Platform audit log',
  description: 'Every super-admin action, newest first.',
  permission: 'platform.tenants.view',
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
  summary: 'Start a support impersonation session',
  description:
    'Time-boxed access into one tenant. Read-only unless `canWrite` is set, and every action during the window is written to the platform audit log \u2014 so \u201cwho looked at my data\u201d is always answerable with exactly what and when.',
  permission: 'platform.support.create',
  body: z.object({
    tenantId: uuid, reason: z.string().min(5).max(500),
    durationMinutes: z.number().int().min(5).max(480).default(120),
    canWrite: z.boolean().default(false).describe('Write access is a deliberate escalation.'),
  }),
  responses: [
    { status: 201, description: 'Session opened.', schema: z.object({ session: record, endsAt: z.string() }) },
    { status: 403, description: 'Not a platform operator.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Support impersonation with a hard time limit.' }],
  handler: async (req, res) => {
    const out = await asPlatform(async (tx) => {
      const endsAt = new Date(Date.now() + req.body.durationMinutes * 60_000);
      const session = await tx.one(
        `insert into support_session (id, tenant_id, operator_user_id, reason, ends_at, can_write, ip_address)
         values (gen_random_uuid(), $1, null, $2, $3, $4, $5) returning *`,
        [req.body.tenantId, req.body.reason, endsAt, req.body.canWrite, req.ip ?? null]);
      await audit(tx, platformUserId(req), 'support.session_start', {
        tenantId: req.body.tenantId, targetType: 'support_session',
        changes: { reason: req.body.reason, canWrite: req.body.canWrite }, ip: req.ip });
      return { session, endsAt: endsAt.toISOString() };
    });
    res.status(201).json(out);
  },
});

defineRoute({
  method: 'get', path: '/api/platform/feature-flags', module: M,
  summary: 'Feature flags in effect',
  description: 'Rows with a null tenant are global defaults; a tenant row overrides the default for that tenant.',
  permission: 'platform.flags.view',
  responses: [{ status: 200, description: 'Flags.', schema: z.object({ flags: z.array(record) }) }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Feature flag listing.' }],
  handler: async () => asPlatform(async (tx) => ({
    flags: await tx.query(`select f.*, t.code as tenant_code from feature_flag f
                             left join tenant t on t.id = f.tenant_id
                            order by f.flag_key, f.tenant_id nulls first`),
  })),
});
