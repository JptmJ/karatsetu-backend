/**
 * `npm run gen:postman` — builds a Postman collection from the route registry.
 *
 * Generated, not hand-written, so it lists exactly the endpoints the server is
 * running. Request bodies are built from the same Zod schemas that validate the
 * real requests, so the examples are always the right shape.
 *
 * Two sign-ins are wired up, because there are two kinds of token:
 *   Super Admin  → /api/platform/auth/login   (no tenant)
 *   Shop staff   → /api/auth/login            (needs tenantCode)
 * Each login saves its token into a collection variable, so every other request
 * in that folder just works once you have run the login once.
 */
import './bootstrap-shim.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { allRoutes, pathParams, toJsonSchema, type RouteSpec } from '../core/http/route-registry.js';
import { MODULE_CATALOG } from '../modules/tenancy/module-catalog.js';

const MODULE_NAMES = new Map(MODULE_CATALOG.map((m) => [m.key, m.name]));

/** A believable value for a field, so the example is worth sending as-is. */
function sample(name: string, schema: Record<string, any>): unknown {
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  const n = name.toLowerCase();
  if (schema.type === 'array') {
    const item = schema.items ? sample(name, schema.items) : {};
    return [item];
  }
  if (schema.type === 'object') return fromObject(schema);
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') {
    if (n.includes('limit')) return 50;
    if (n.includes('offset')) return 0;
    if (n.includes('day')) return 30;
    return 1;
  }

  // strings — match the pattern where there is one, otherwise guess from the name
  if (schema.format === 'uuid' || n.endsWith('id')) return '{{' + (n.endsWith('id') ? name : 'id') + '}}';
  if (schema.format === 'email' || n.includes('email')) return 'someone@example.com';
  if (schema.pattern === '^\\d{4}-\\d{2}-\\d{2}$' || n.includes('date')) return '{{today}}';
  if (schema.format === 'date-time') return '{{nowIso}}';
  if (n.includes('password')) return 'changeme123';
  if (n.includes('phone')) return '9820011223';
  if (n.includes('gstin')) return '27AABCU9603R1ZM';
  if (n === 'pan') return 'AABCU9603R';
  if (n.includes('weight')) return '10.000';
  if (n.includes('rate') || n.includes('amount') || n.includes('price')) return '6500.00';
  if (n.includes('percent')) return '8';
  if (n.includes('reason')) return 'Reason for the change';
  if (n.includes('code')) return 'CODE01';
  if (n.includes('name')) return 'Example name';
  return 'text';
}

function fromObject(schema: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = schema.properties ?? {};
  const required = new Set<string>(schema.required ?? []);

  for (const [key, raw] of Object.entries(props)) {
    const field = raw as Record<string, any>;
    // Keep required fields plus anything with a default; skip the long tail of
    // optional fields so the example stays readable.
    if (!required.has(key) && field.default === undefined && Object.keys(out).length > 11) continue;
    out[key] = sample(key, field);
  }
  return out;
}

function requestFor(route: RouteSpec) {
  const isPlatform = route.path.startsWith('/api/platform');
  const tokenVar = isPlatform ? '{{platformToken}}' : '{{token}}';

  // :id → {{id}} so Postman shows it as a variable
  let url = `{{baseUrl}}${route.path.replace(/:([A-Za-z0-9_]+)/g, '{{$1}}')}`;

  const query = toJsonSchema(route.query) as Record<string, any> | undefined;
  const queryParams = query?.properties
    ? Object.entries(query.properties).map(([key, raw]) => ({
        key,
        value: String(sample(key, raw as Record<string, any>) ?? ''),
        // Everything optional starts disabled, so the request runs clean.
        disabled: !(query.required ?? []).includes(key),
        description: (raw as { description?: string }).description ?? '',
      }))
    : [];

  const headers: Array<Record<string, string>> = [];
  if (route.auth !== false) headers.push({ key: 'Authorization', value: `Bearer ${tokenVar}` });
  if (route.body) headers.push({ key: 'Content-Type', value: 'application/json' });
  if (!isPlatform && route.auth !== false) {
    headers.push({ key: 'X-Branch-Id', value: '{{branchId}}', description: 'Optional — act at one branch.' });
  }

  const bodySchema = toJsonSchema(route.body) as Record<string, any> | undefined;

  const docLines = [
    route.description ?? route.summary,
    '',
    `**Permission:** ${route.permission ? `\`${route.permission}\`` : 'none'}`,
    `**Auth:** ${route.auth === false ? 'public' : isPlatform ? 'super admin token' : 'shop staff token'}`,
    '',
    '**Responses**',
    ...route.responses.map((r) => `- \`${r.status}\` — ${r.description}`),
  ];

  const item: Record<string, unknown> = {
    name: `${route.method.toUpperCase()} ${route.path.replace('/api/', '')}`,
    request: {
      method: route.method.toUpperCase(),
      header: headers,
      url: {
        raw: url + (queryParams.some((q) => !q.disabled) ? '?' : ''),
        host: ['{{baseUrl}}'],
        path: route.path.replace(/^\//, '').replace(/:([A-Za-z0-9_]+)/g, '{{$1}}').split('/'),
        query: queryParams,
      },
      description: docLines.join('\n'),
      ...(bodySchema
        ? {
            body: {
              mode: 'raw',
              raw: JSON.stringify(fromObject(bodySchema), null, 2),
              options: { raw: { language: 'json' } },
            },
          }
        : {}),
    },
    response: [],
  };

  // The two logins stash their tokens so nothing else needs configuring.
  if (route.path === '/api/auth/login') {
    item.event = [scriptSaving('token', 'accessToken', 'refreshToken')];
  } else if (route.path === '/api/platform/auth/login') {
    item.event = [scriptSaving('platformToken', 'accessToken', 'platformRefresh')];
  }

  return item;
}

const scriptSaving = (tokenVar: string, field: string, refreshVar: string) => ({
  listen: 'test',
  script: {
    type: 'text/javascript',
    exec: [
      'const body = pm.response.json();',
      'if (body && body.accessToken) {',
      `  pm.collectionVariables.set("${tokenVar}", body.${field});`,
      `  if (body.refreshToken) pm.collectionVariables.set("${refreshVar}", body.refreshToken);`,
      `  console.log("Saved ${tokenVar}");`,
      '}',
      'if (body && body.user && body.user.branchId) {',
      '  pm.collectionVariables.set("branchId", body.user.branchId);',
      '}',
      'if (body && body.tenantId) pm.collectionVariables.set("tenantId", body.tenantId);',
    ],
  },
});

function build() {
  const routes = allRoutes();

  // Super admin work first — you cannot do anything else until a tenant exists.
  const order = ['platform', 'settings', 'dashboard', 'master', 'orders', 'pos', 'stock',
                 'tagging', 'oldgold', 'schemes', 'girvi', 'accounts', 'reports'];

  const byModule = new Map<string, RouteSpec[]>();
  for (const r of routes) byModule.set(r.module, [...(byModule.get(r.module) ?? []), r]);

  const folders = [...byModule.entries()]
    .sort((a, b) => {
      const ai = order.indexOf(a[0]); const bi = order.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    })
    .map(([key, list]) => ({
      name: `${MODULE_NAMES.get(key) ?? key}`,
      description: MODULE_CATALOG.find((m) => m.key === key)?.description ?? '',
      item: list
        .sort((a, b) => {
          // logins first inside their folder
          const al = a.path.includes('/auth/login') ? 0 : 1;
          const bl = b.path.includes('/auth/login') ? 0 : 1;
          return al - bl || a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
        })
        .map(requestFor),
    }));

  return {
    info: {
      name: 'RatnaGrid API',
      _postman_id: 'ratnagrid-api-collection',
      description: [
        '# RatnaGrid API',
        '',
        `Generated from the running server on ${new Date().toISOString().slice(0, 10)}.`,
        `${routes.length} endpoints.`,
        '',
        '## Start here',
        '',
        '1. Set `baseUrl` — it defaults to the deployed backend.',
        '2. **Super admin work:** run `Platform Operator → POST platform/auth/login`.',
        '   The token is saved automatically into `platformToken`.',
        '3. **Shop staff work:** run `Settings → POST auth/login` with a `tenantCode`.',
        '   That token is saved into `token`, and the branch into `branchId`.',
        '',
        'Every other request picks the right token up by itself.',
        '',
        '## Why two logins',
        '',
        'A super admin has no tenant, so they sign in with just email and password.',
        'Shop staff belong to one business, so they also send `tenantCode` — that is',
        'what tells the server which shop `rajesh@gmail.com` works at.',
        '',
        '## Variables',
        '',
        '- `baseUrl` — the server',
        '- `platformToken` / `token` — filled in by the two logins',
        '- `tenantId`, `branchId`, `id` — fill these in as you go',
        '- `today`, `nowIso` — set automatically before each request',
      ].join('\n'),
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    event: [
      {
        listen: 'prerequest',
        script: {
          type: 'text/javascript',
          exec: [
            '// Keep the date helpers fresh for every request.',
            'const now = new Date();',
            'pm.collectionVariables.set("today", now.toISOString().slice(0, 10));',
            'pm.collectionVariables.set("nowIso", now.toISOString());',
          ],
        },
      },
    ],
    variable: [
      { key: 'baseUrl', value: 'https://karatsetu-backend.onrender.com', type: 'string' },
      { key: 'platformToken', value: '', type: 'string' },
      { key: 'token', value: '', type: 'string' },
      { key: 'platformRefresh', value: '', type: 'string' },
      { key: 'refreshToken', value: '', type: 'string' },
      { key: 'tenantId', value: '', type: 'string' },
      { key: 'branchId', value: '', type: 'string' },
      { key: 'userId', value: '', type: 'string' },
      { key: 'id', value: '', type: 'string' },
      { key: 'today', value: '', type: 'string' },
      { key: 'nowIso', value: '', type: 'string' },
    ],
    item: folders,
  };
}

const target = resolve(process.argv.find((a) => a.endsWith('.json')) ?? 'generated/RatnaGrid.postman_collection.json');
mkdirSync(dirname(target), { recursive: true });
const collection = build();
writeFileSync(target, JSON.stringify(collection, null, 2), 'utf8');

const count = collection.item.reduce((n, f) => n + f.item.length, 0);
console.log(`Postman collection written to ${target}`);
console.log(`  ${collection.item.length} folders, ${count} requests`);
