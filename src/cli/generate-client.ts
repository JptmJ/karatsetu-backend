/**
 * `npm run gen:client` — writes a typed API client for the frontend.
 *
 * Generated from the same route registry that serves the API and renders
 * /dev-docs, so all three move together. Re-run it whenever an endpoint
 * changes; the diff in the generated file is the change the frontend needs.
 */
import '../bootstrap.js';
import '../api/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { allRoutes, pathParams, toJsonSchema, type RouteSpec } from '../core/http/route-registry.js';
import { ERROR_CATALOG } from '../core/docs/error-catalog.js';

/** "/api/orders/:id/stage" + post → "postOrdersIdStage" */
function methodName(route: RouteSpec): string {
  const parts = route.path
    .replace(/^\/api\//, '')
    .split('/')
    .filter(Boolean)
    .map((p) => (p.startsWith(':') ? `By${cap(p.slice(1))}` : cap(p.replace(/[^a-zA-Z0-9]/g, ''))));
  return route.method + parts.join('');
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** JSON Schema → a TypeScript type literal. */
function tsType(schema: unknown, indent = 2): string {
  const n = schema as Record<string, any>;
  if (!n) return 'unknown';
  if (n.enum) return n.enum.map((v: unknown) => JSON.stringify(v)).join(' | ');
  if (n.anyOf) return n.anyOf.map((s: unknown) => tsType(s, indent)).join(' | ');
  const pad = ' '.repeat(indent);

  switch (n.type) {
    case 'string': return 'string';
    case 'number': case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array': return `Array<${tsType(n.items, indent)}>`;
    case 'object': {
      if (!n.properties) return 'Record<string, unknown>';
      const required = new Set<string>(n.required ?? []);
      const fields = Object.entries(n.properties).map(([key, value]) => {
        const doc = (value as Record<string, any>).description;
        const comment = doc ? `${pad}/** ${doc} */\n` : '';
        const safe = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
        return `${comment}${pad}${safe}${required.has(key) ? '' : '?'}: ${tsType(value, indent + 2)};`;
      });
      return `{\n${fields.join('\n')}\n${' '.repeat(indent - 2)}}`;
    }
    default: return 'unknown';
  }
}

function generate(): string {
  const routes = allRoutes();
  const lines: string[] = [];

  lines.push(`/**
 * RatnaGrid API client — GENERATED, DO NOT EDIT BY HAND.
 *
 * Regenerate with \`npm run gen:client\` in the backend, then copy this file
 * into the frontend. Every type here comes from the schema that validates the
 * real request, so a mismatch between this file and the server is impossible.
 *
 * Generated ${new Date().toISOString()} from ${routes.length} endpoints.
 */

export interface ApiError {
  code: ${ERROR_CATALOG.map((e) => JSON.stringify(e.code)).join(' | ')} | (string & {});
  message: string;
  details?: unknown;
  requestId?: string;
}

/** Thrown by every client method when the server returns a non-2xx response. */
export class RatnaGridApiError extends Error {
  constructor(readonly status: number, readonly error: ApiError) {
    super(error.message);
    this.name = 'RatnaGridApiError';
  }
  /** Field-level messages from a 400, ready to drop onto a form. */
  get fieldErrors(): Array<{ field: string; message: string }> {
    return Array.isArray(this.error.details) ? (this.error.details as Array<{ field: string; message: string }>) : [];
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** Called before each request. Return null when signed out. */
  getToken?: () => string | null | undefined;
  /** Sent as X-Branch-Id, so the server knows which branch you are acting at. */
  getBranchId?: () => string | null | undefined;
  /** Called on a 401 so the app can refresh the token or sign the user out. */
  onUnauthorized?: () => void;
  fetch?: typeof globalThis.fetch;
}

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;

  async function request<T>(
    method: string,
    path: string,
    init: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(path, options.baseUrl);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const token = options.getToken?.();
    if (token) headers.authorization = \`Bearer \${token}\`;
    const branchId = options.getBranchId?.();
    if (branchId) headers['x-branch-id'] = branchId;

    const response = await doFetch(url.toString(), {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (response.status === 204) return undefined as T;

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) options.onUnauthorized?.();
      throw new RatnaGridApiError(
        response.status,
        (payload as { error?: ApiError })?.error ?? { code: 'internal_error', message: response.statusText },
      );
    }
    return payload as T;
  }

  return {
    request,
`);

  for (const route of routes) {
    const name = methodName(route);
    const params = pathParams(route.path);
    const args: string[] = [];

    if (params.length) args.push(`params: { ${params.map((p) => `${p}: string`).join('; ')} }`);
    if (route.query) args.push(`query?: ${tsType(toJsonSchema(route.query), 6)}`);
    if (route.body) args.push(`body: ${tsType(toJsonSchema(route.body), 6)}`);

    const success = route.responses.find((r) => r.status < 300);
    const returnType = success?.schema ? tsType(toJsonSchema(success.schema, 'output'), 6) : 'void';

    const url = params.length
      ? '`' + route.path.replace(/:([A-Za-z0-9_]+)/g, (_, p) => `\${encodeURIComponent(params.${p})}`) + '`'
      : JSON.stringify(route.path);

    const call = [
      `'${route.method.toUpperCase()}'`,
      url,
      route.query || route.body
        ? `{ ${[route.query ? 'query' : '', route.body ? 'body' : ''].filter(Boolean).join(', ')} }`
        : '',
    ].filter(Boolean).join(', ');

    lines.push(`    /**
     * ${route.summary}
     *${route.description ? `\n     * ${route.description.replace(/\n/g, '\n     * ')}` : ''}
     * \`${route.method.toUpperCase()} ${route.path}\`${route.permission ? `\n     * Requires \`${route.permission}\`.` : ''}
     */
    ${name}(${args.join(', ')}): Promise<${returnType}> {
      return request<${returnType}>(${call});
    },
`);
  }

  lines.push(`  };
}

export type RatnaGridClient = ReturnType<typeof createClient>;
`);

  return lines.join('');
}

const target = resolve(process.argv[2] ?? 'generated/ratnagrid-client.ts');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, generate(), 'utf8');
console.log(`Client written to ${target} (${allRoutes().length} endpoints).`);
