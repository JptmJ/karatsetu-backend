/**
 * Reading a setting.
 *
 * Values are layered. Asking for `pricing.wastage.basis` inside a branch checks,
 * in order: that branch -> that tenant -> the built-in default. The first one
 * that has a value wins.
 *
 *     branch override   ┐
 *     tenant override   ├─ first hit wins
 *     code default      ┘
 *
 * Values are cached per tenant because config is read constantly (every price
 * calculation touches several keys) and changed rarely. Any write bumps a
 * version number, which drops the cache for that tenant.
 */
import { defineTable } from '../db/schema/registry.js';
import { col } from '../db/schema/columns.js';
import type { Tx } from '../db/client.js';
import { getConfigDefinition, allConfigDefinitions, type ConfigDefinition } from './definitions.js';
import { ValidationError } from '../errors/app-error.js';
import { logger } from '../util/logger.js';

export const configValueTable = defineTable({
  name: 'config_value',
  module: 'core',
  comment: 'Per-tenant and per-branch overrides of the settings declared in code.',
  columns: {
    branch_id: col.fk('branch', { comment: 'Null means the value applies to the whole tenant.' }),
    config_key: col.text({ notNull: true }),
    value: col.jsonb({ notNull: true, comment: 'Always an object: { "v": <the value> }.' }),
    updated_reason: col.text(),
  },
  uniques: [{ columns: ['branch_id', 'config_key'], nullsNotDistinct: true }],
  indexes: [{ columns: ['config_key'] }],
});

type Layer = Map<string, unknown>;

interface TenantCache {
  tenant: Layer;
  branches: Map<string, Layer>;
  loadedAt: number;
}

const cache = new Map<string, TenantCache>();
const CACHE_TTL_MS = 60_000;

async function load(tx: Tx): Promise<TenantCache> {
  const tenantId = tx.context.tenantId;
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;

  const rows = await tx.query<{ branch_id: string | null; config_key: string; value: { v: unknown } }>(
    `select branch_id, config_key, value from config_value`,
  );

  const fresh: TenantCache = { tenant: new Map(), branches: new Map(), loadedAt: Date.now() };
  for (const row of rows) {
    if (row.branch_id === null) {
      fresh.tenant.set(row.config_key, row.value.v);
    } else {
      const branch = fresh.branches.get(row.branch_id) ?? new Map();
      branch.set(row.config_key, row.value.v);
      fresh.branches.set(row.branch_id, branch);
    }
  }

  cache.set(tenantId, fresh);
  return fresh;
}

export function invalidateConfigCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** Typed read. `definition` is one of the entries in `CONFIG`. */
export async function getConfig<T>(tx: Tx, definition: ConfigDefinition<T>): Promise<T> {
  const layers = await load(tx);
  const branchId = tx.context.branchId;

  if (branchId && definition.scope === 'branch') {
    const branchValue = layers.branches.get(branchId)?.get(definition.key);
    if (branchValue !== undefined) return parseOrDefault(definition, branchValue);
  }

  const tenantValue = layers.tenant.get(definition.key);
  if (tenantValue !== undefined) return parseOrDefault(definition, tenantValue);

  return definition.default;
}

/** Reads several settings at once — one cache hit instead of several awaits. */
export async function getConfigMany<T extends Record<string, ConfigDefinition<any>>>(
  tx: Tx,
  definitions: T,
): Promise<{ [K in keyof T]: T[K] extends ConfigDefinition<infer V> ? V : never }> {
  await load(tx);
  const out: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    out[name] = await getConfig(tx, definition);
  }
  return out as never;
}

function parseOrDefault<T>(definition: ConfigDefinition<T>, raw: unknown): T {
  const parsed = definition.schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // A stored value that no longer validates (the definition changed under it)
  // must not take the whole request down.
  logger.warn(
    { key: definition.key, stored: raw, issues: parsed.error.issues },
    'Stored config value is invalid — falling back to the default',
  );
  return definition.default;
}

export async function setConfig(
  tx: Tx,
  key: string,
  value: unknown,
  options: { branchId?: string | null; reason?: string } = {},
): Promise<void> {
  const definition = getConfigDefinition(key);
  if (!definition) throw new ValidationError(`Unknown setting "${key}"`);

  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`Invalid value for "${key}"`, parsed.error.issues);
  }

  const branchId = options.branchId ?? null;
  if (branchId !== null && definition.scope !== 'branch') {
    throw new ValidationError(`"${key}" cannot be set per branch — it applies to the whole tenant`);
  }

  await tx.query(
    `insert into config_value (id, tenant_id, branch_id, config_key, value, updated_reason, created_by, updated_by)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $6)
     on conflict (tenant_id, branch_id, config_key)
     do update set value = excluded.value, updated_reason = excluded.updated_reason,
                   updated_at = now(), updated_by = excluded.updated_by`,
    [tx.context.tenantId, branchId, key, JSON.stringify({ v: parsed.data }), options.reason ?? null, tx.context.userId],
  );

  invalidateConfigCache(tx.context.tenantId);
}

/** Everything the settings screen needs: definition, effective value, where it came from. */
export async function describeConfig(tx: Tx): Promise<
  Array<{ key: string; group: string; label: string; description: string; scope: string; value: unknown; source: 'default' | 'tenant' | 'branch'; sensitive: boolean }>
> {
  const layers = await load(tx);
  const branchId = tx.context.branchId;

  return allConfigDefinitions().map((definition) => {
    let source: 'default' | 'tenant' | 'branch' = 'default';
    let value: unknown = definition.default;

    if (layers.tenant.has(definition.key)) {
      source = 'tenant';
      value = layers.tenant.get(definition.key);
    }
    if (branchId && definition.scope === 'branch' && layers.branches.get(branchId)?.has(definition.key)) {
      source = 'branch';
      value = layers.branches.get(branchId)!.get(definition.key);
    }

    return {
      key: definition.key,
      group: definition.group,
      label: definition.label,
      description: definition.description,
      scope: definition.scope,
      value,
      source,
      sensitive: definition.sensitive ?? false,
    };
  });
}
