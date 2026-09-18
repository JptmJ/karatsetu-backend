/** Auth, tenancy, settings and dashboard endpoints. */
import { z } from 'zod';
import { defineRoute } from '../core/http/route-registry.js';
import { transaction } from '../core/db/client.js';
import { repo } from '../core/db/repository.js';
import { login, refreshSession, revokeRefreshToken } from '../modules/identity/auth.service.js';
import { catalogFor, LICENCE_STATES, MODULE_CATALOG, type LicenceState, type TenantKind, type TenantModuleState } from '../modules/tenancy/module-catalog.js';
import { describeConfig, setConfig } from '../core/config/config-service.js';
import { errorEnvelope, idParam, ok, record, uuid } from './schemas.js';
import { param } from '../core/http/middleware.js';

const TODAY = '2026-09-18';

/* ------------------------------------------------------------------ auth */

defineRoute({
  method: 'post', path: '/api/auth/login', module: 'settings', auth: false,
  summary: 'Sign in and receive tokens',
  description:
    'Returns a short-lived access token plus a long-lived refresh token. Send the access token as `Authorization: Bearer <token>` on every other call. The same message is returned for a wrong email and a wrong password, so the response cannot be used to discover which accounts exist.',
  body: z.object({
    tenantCode: z.string().min(1).describe('The tenant slug, e.g. "aarohi".'),
    email: z.string().email(),
    password: z.string().min(1),
  }),
  responses: [
    { status: 200, description: 'Signed in.', schema: z.object({
        accessToken: z.string(), refreshToken: z.string(),
        user: z.object({ id: uuid, email: z.string(), fullName: z.string(), branchId: uuid.nullable() }),
        tenant: z.object({ id: uuid, code: z.string(), name: z.string(), kind: z.string() }),
        roles: z.array(z.string()), permissions: z.array(z.string()),
      }) },
    { status: 401, description: 'Wrong credentials, locked account, or inactive tenant.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Initial sign-in endpoint.' }],
  handler: async (req) => login(req.body.tenantCode, req.body.email, req.body.password, {
    userAgent: req.headers['user-agent'], ip: req.ip,
  }),
});

defineRoute({
  method: 'post', path: '/api/auth/refresh', module: 'settings', auth: false,
  summary: 'Exchange a refresh token for a new access token',
  body: z.object({ refreshToken: z.string().min(1) }),
  responses: [
    { status: 200, description: 'New access token.', schema: z.object({ accessToken: z.string() }) },
    { status: 401, description: 'Refresh token expired or revoked — sign in again.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Initial refresh endpoint.' }],
  handler: async (req) => refreshSession(req.body.refreshToken),
});

defineRoute({
  method: 'post', path: '/api/auth/logout', module: 'settings', auth: false,
  summary: 'Revoke a refresh token',
  body: z.object({ refreshToken: z.string().min(1) }),
  responses: [{ status: 204, description: 'Revoked.' }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Initial logout endpoint.' }],
  handler: async (req, res) => { await revokeRefreshToken(req.body.refreshToken); res.status(204).end(); },
});

/* -------------------------------------------------------------- tenancy */

defineRoute({
  method: 'get', path: '/api/tenancy/modules', module: 'platform',
  summary: 'Modules, licences and theme for the signed-in tenant',
  description:
    'Everything the module dock needs in one call. `locked: true` means the tenant holds the module but the licence has lapsed — show it, disabled, with a renew prompt. Modules the tenant should not see at all are simply absent.',
  responses: [
    { status: 200, description: 'The dock.', schema: z.object({
        tenant: z.object({ code: z.string(), name: z.string(), kind: z.string(), status: z.string() }),
        theme: z.object({ preset_key: z.string(), css_variables: record, logo_url: z.string().nullable() }),
        modules: z.array(z.object({
          key: z.string(), order: z.number(), group: z.string(), name: z.string(), shortName: z.string(),
          description: z.string(), statusLabel: z.string(),
          licence: z.enum(LICENCE_STATES), locked: z.boolean(),
          trialEndsAt: z.string().nullable(), expiresAt: z.string().nullable(),
          subModules: z.array(z.object({ key: z.string(), name: z.string(), status: z.string() })),
        })),
      }) },
  ],
  changelog: [
    { date: TODAY, kind: 'added', note: 'Returns modules with licence state and theme.' },
    { date: TODAY, kind: 'changed', note: 'Added `locked` and `trialEndsAt` so the UI can show trial countdowns.' },
  ],
  handler: async () => transaction(async (tx) => {
    const tenant = await tx.one<{ kind: TenantKind; display_name: string; code: string; status: string }>(
      `select kind, display_name, code, status from tenant where id = $1`, [tx.context.tenantId]);
    const rows = await tx.query<{ module_key: string; enabled: boolean; licence: LicenceState;
      trial_ends_at: string | null; expires_at: string | null; disabled_submodules: string[] }>(
      `select module_key, enabled, licence, trial_ends_at, expires_at, disabled_submodules from tenant_module`);
    const states = new Map<string, TenantModuleState>(rows.map((r) => [r.module_key, {
      enabled: r.enabled, licence: r.licence, trialEndsAt: r.trial_ends_at,
      expiresAt: r.expires_at, disabled: r.disabled_submodules ?? [],
    }]));
    const theme = await tx.maybeOne(`select preset_key, css_variables, logo_url from tenant_theme
      where branch_id is null and is_active = true limit 1`);
    return {
      tenant: { code: tenant.code, name: tenant.display_name, kind: tenant.kind, status: tenant.status },
      theme: theme ?? { preset_key: 'deep-forest', css_variables: {}, logo_url: null },
      modules: catalogFor(tenant.kind, states),
    };
  }),
});

defineRoute({
  method: 'get', path: '/api/tenancy/catalog', module: 'platform',
  summary: 'The full module catalog, independent of any tenant',
  description: 'Every module the platform offers. Used by the SaaS admin screen when provisioning.',
  permission: 'platform.tenants.view',
  responses: [{ status: 200, description: 'All modules.', schema: z.object({ modules: z.array(record) }) }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Catalog for the provisioning screen.' }],
  handler: async () => ({ modules: MODULE_CATALOG }),
});

/* ------------------------------------------------------------- settings */

defineRoute({
  method: 'get', path: '/api/settings/config', module: 'settings',
  summary: 'All settings with their effective values',
  description:
    'Each entry carries `value` (what applies now) and `source` (whether that came from a branch override, a tenant override, or the built-in default). Grouped by `group` so the settings screen can render tabs directly.',
  permission: 'settings.config.view',
  responses: [{ status: 200, description: 'Settings, grouped.', schema: z.object({ groups: record }) }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Config engine read endpoint.' }],
  handler: async () => transaction(async (tx) => {
    const rows = await describeConfig(tx);
    const groups: Record<string, typeof rows> = {};
    for (const row of rows) (groups[row.group] ??= []).push(row);
    return { groups };
  }),
});

defineRoute({
  method: 'put', path: '/api/settings/config/:key', module: 'settings',
  summary: 'Change one setting',
  description:
    'Validated against the setting’s declared type. Settings marked `sensitive` change how past numbers are interpreted — warn before saving those.',
  permission: 'settings.config.update',
  params: z.object({ key: z.string().min(1).describe('Dotted key, e.g. pricing.wastage.basis') }),
  body: z.object({
    value: z.unknown().describe('Must match the setting’s declared type.'),
    branchId: uuid.nullish().describe('Only for branch-scoped settings.'),
    reason: z.string().max(500).optional(),
  }),
  responses: [
    { status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), key: z.string() }) },
    { status: 400, description: 'Unknown key, or the value failed its type check.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Config engine write endpoint.' }],
  handler: async (req) => {
    const key = param(req, 'key');
    await transaction((tx) => setConfig(tx, key, req.body.value, {
      branchId: req.body.branchId ?? null, reason: req.body.reason,
    }));
    return { ok: true, key };
  },
});

defineRoute({
  method: 'get', path: '/api/settings/theme', module: 'settings',
  summary: 'The active theme',
  permission: 'settings.theme.view',
  responses: [{ status: 200, description: 'Theme preset and CSS variable overrides.', schema: record }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Theme Studio read endpoint.' }],
  handler: async () => transaction(async (tx) =>
    (await tx.maybeOne(`select * from tenant_theme where branch_id is null and is_active = true limit 1`))
    ?? { preset_key: 'deep-forest', css_variables: {} }),
});

defineRoute({
  method: 'put', path: '/api/settings/theme', module: 'settings',
  summary: 'Change the theme',
  description: 'Preset keys match the frontend theme ids exactly.',
  permission: 'settings.theme.update',
  body: z.object({
    preset_key: z.enum(['deep-forest', 'royal-ruby', 'sapphire-platinum', 'obsidian-luxury', 'rose-gold', 'custom']),
    css_variables: z.record(z.string(), z.string()).optional().describe('CSS custom properties layered over the preset.'),
    logo_url: z.string().url().nullish(),
    branch_id: uuid.nullish().describe('Null sets the tenant default.'),
  }),
  responses: [{ status: 200, description: 'Saved.', schema: record }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Theme Studio write endpoint.' }],
  handler: async (req) => transaction(async (tx) => {
    const existing = await tx.maybeOne<{ id: string }>(
      `select id from tenant_theme where branch_id is not distinct from $1`, [req.body.branch_id ?? null]);
    const values = {
      preset_key: req.body.preset_key,
      css_variables: JSON.stringify(req.body.css_variables ?? {}),
      logo_url: req.body.logo_url ?? null,
      branch_id: req.body.branch_id ?? null,
      is_active: true,
    };
    return existing ? repo(tx, 'tenant_theme').update(existing.id, values) : repo(tx, 'tenant_theme').insert(values);
  }),
});

/* ------------------------------------------------------------ dashboard */

defineRoute({
  method: 'get', path: '/api/dashboard/summary', module: 'dashboard',
  summary: 'The owner cockpit figures',
  description:
    'One call returns every headline metric the dashboard shows. Computed live; cache it on the client for a minute rather than polling.',
  permission: 'reports.owner.view',
  query: z.object({ branchId: uuid.optional() }),
  responses: [{ status: 200, description: 'Dashboard metrics.', schema: z.object({
      stockValue: z.object({ total: z.string(), goldWeight: z.string(), silverWeight: z.string() }),
      todaySales: z.object({ amount: z.string(), count: z.number() }),
      customers: z.object({ total: z.number() }),
      pendingOrders: z.object({ count: z.number(), value: z.string() }),
      oldGoldToday: z.object({ weight: z.string(), value: z.string() }),
      schemeDue: z.object({ count: z.number(), amount: z.string() }),
      receivables: z.object({ amount: z.string(), accounts: z.number() }),
      alerts: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
    }) }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Single-call dashboard summary.' }],
  handler: async (req) => transaction(async (tx) => {
    const branchId = (req.query as { branchId?: string }).branchId ?? null;
    const b = branchId ? ' and branch_id = $1' : '';
    const p = branchId ? [branchId] : [];
    const today = new Date().toISOString().slice(0, 10);

    const one = async <T>(sql: string, params: unknown[] = p): Promise<T> =>
      (await tx.query<Record<string, any>>(sql, params))[0] as T;

    const stock = await one<{ total: string; gold: string; silver: string }>(
      `select coalesce(sum(sb.value),0)::text total,
              coalesce(sum(case when m.code='GOLD' then sb.net_weight else 0 end),0)::text gold,
              coalesce(sum(case when m.code='SILVER' then sb.net_weight else 0 end),0)::text silver
         from stock_balance sb join item i on i.id=sb.item_id
         left join metal m on m.id=i.metal_id
         join stock_location l on l.id=sb.location_id
        where true ${branchId ? 'and l.branch_id = $1' : ''}`);

    const sales = await one<{ amount: string; count: string }>(
      `select coalesce(sum(total_amount),0)::text amount, count(*)::text count
         from sales_invoice where doc_date = '${today}' and status='posted' ${b}`);
    const customers = await one<{ n: string }>(`select count(*)::text n from party where is_customer=true and deleted_at is null`, []);
    const orders = await one<{ n: string; v: string }>(
      `select count(*)::text n, coalesce(sum(balance_amount),0)::text v
         from retail_order where status='active' ${b}`);
    const oldGold = await one<{ w: string; v: string }>(
      `select coalesce(sum(total_fine_weight),0)::text w, coalesce(sum(net_value),0)::text v
         from old_gold_intake where voucher_date='${today}' ${b}`);
    const scheme = await one<{ n: string; a: string }>(
      `select count(*)::text n, coalesce(sum(amount_due),0)::text a
         from scheme_installment where due_date <= '${today}' and status='due'`, []);
    const recv = await one<{ a: string; n: string }>(
      `select coalesce(sum(balance_amount),0)::text a, count(*)::text n
         from sales_invoice where status='posted' and balance_amount > 0 ${b}`);

    const slaCount = await one<{ n: string }>(
      `select count(*)::text n from retail_order
        where status='active' and expected_delivery_date < '${today}' ${b}`);

    return {
      stockValue: { total: stock.total, goldWeight: stock.gold, silverWeight: stock.silver },
      todaySales: { amount: sales.amount, count: Number(sales.count) },
      customers: { total: Number(customers.n) },
      pendingOrders: { count: Number(orders.n), value: orders.v },
      oldGoldToday: { weight: oldGold.w, value: oldGold.v },
      schemeDue: { count: Number(scheme.n), amount: scheme.a },
      receivables: { amount: recv.a, accounts: Number(recv.n) },
      alerts: [
        { key: 'sla-risk', label: 'Orders past expected delivery', count: Number(slaCount.n) },
        { key: 'scheme-due', label: 'Scheme collections due today', count: Number(scheme.n) },
      ],
    };
  }),
});

defineRoute({
  method: 'get', path: '/api/dashboard/layout', module: 'dashboard',
  summary: 'The saved widget layout for the signed-in user',
  description: 'Falls back to the role default when the user has not customised anything.',
  permission: 'reports.owner.view',
  responses: [{ status: 200, description: 'Widget layout.', schema: z.object({ widgets: z.array(record), source: z.string() }) }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Dashboard customisation.' }],
  handler: async () => transaction(async (tx) => {
    const mine = await tx.maybeOne<{ widgets: unknown[] }>(
      `select widgets from dashboard_layout where user_id = $1`, [tx.context.userId]);
    if (mine) return { widgets: mine.widgets, source: 'user' };
    const role = tx.context.roles[0] ?? 'owner';
    const fallback = await tx.maybeOne<{ widgets: unknown[] }>(
      `select widgets from dashboard_layout where role_code = $1`, [role]);
    return { widgets: fallback?.widgets ?? [], source: fallback ? 'role' : 'default' };
  }),
});

defineRoute({
  method: 'put', path: '/api/dashboard/layout', module: 'dashboard',
  summary: 'Save the widget layout',
  permission: 'reports.owner.view',
  body: z.object({
    widgets: z.array(z.object({
      key: z.string(), visible: z.boolean().default(true),
      section: z.enum(['overview', 'signals', 'insights', 'operations']).default('overview'),
      order: z.number().int().default(0),
    })).describe('In display order.'),
  }),
  responses: [{ status: 200, description: 'Saved.', schema: ok }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Dashboard customisation save.' }],
  handler: async (req) => transaction(async (tx) => {
    const existing = await tx.maybeOne<{ id: string }>(
      `select id from dashboard_layout where user_id = $1`, [tx.context.userId]);
    const values = { user_id: tx.context.userId, widgets: JSON.stringify(req.body.widgets) };
    if (existing) await repo(tx, 'dashboard_layout').update(existing.id, values);
    else await repo(tx, 'dashboard_layout').insert(values);
    return { ok: true };
  }),
});
