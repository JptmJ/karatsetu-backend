/**
 * Master data is the same five endpoints over and over. This builds them from a
 * description of the table so each master costs a dozen lines rather than two
 * hundred — and, because they go through the registry, they document themselves
 * exactly like the hand-written endpoints do.
 */
import { z, type ZodType } from 'zod';
import { defineRoute, type RouteChange } from '../core/http/route-registry.js';
import { transaction, type Tx } from '../core/db/client.js';
import { recordAudit } from '../core/audit.js';
import { ValidationError } from '../core/errors/app-error.js';
import { repo } from '../core/db/repository.js';
import { getTable } from '../core/db/schema/registry.js';
import { quoteIdent } from '../core/db/schema/sql.js';
import { param } from '../core/http/middleware.js';
import { errorEnvelope, idParam, listOf, pagination, record } from './schemas.js';

export interface CrudOptions {
  /** URL segment, e.g. "parties" for /api/master/parties. */
  resource: string;
  basePath: string;
  table: string;
  module: string;
  /** Singular, used in summaries: "customer", "branch". */
  label: string;
  permission: string;
  createSchema: ZodType;
  updateSchema: ZodType;
  searchColumns?: string[];
  filters?: Record<string, ZodType>;
  defaultOrder?: string;
  changelog?: RouteChange[];
  /** Extra columns to select on list, e.g. joined names. */
  listSelect?: string;
  /**
   * Large tables: cursor pagination instead of offset + count. Ordered by
   * `column` (then id) ascending, or newest-first by id if no column is given.
   * The response is { rows, nextCursor } — no total.
   */
  keyset?: { column?: string };
  hooks?: CrudHooks;
}

type Row = Record<string, unknown>;

export interface CrudHooks {
  /** Validate / normalise before insert. Return what to insert. */
  beforeCreate?: (tx: Tx, values: Row) => Promise<Row> | Row;
  /** Validate / normalise before update. `current` is the row as it is now. */
  beforeUpdate?: (tx: Tx, values: Row, current: Row) => Promise<Row> | Row;
  /** Throw to refuse the delete, or tidy related rows first. */
  beforeDelete?: (tx: Tx, current: Row) => Promise<void> | void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const encodeCursor = (value: unknown, id: string) =>
  Buffer.from(JSON.stringify([value ?? null, id])).toString('base64url');

export function decodeCursor(raw: string): { value: unknown; id: string } {
  try {
    const [value, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [unknown, unknown];
    if (typeof id === 'string' && UUID.test(id)) return { value, id };
  } catch { /* fall through */ }
  throw new ValidationError('That page link is no longer valid — reload the list.');
}

export function defineCrud(o: CrudOptions): void {
  const path = `${o.basePath}/${o.resource}`;
  const def = getTable(o.table);
  const soft = def?.softDelete ?? false;
  // Casting a text column to ::text can stop Postgres using its trigram index.
  const searchExpr = (c: string) => (def?.columns[c]?.type === 'text' ? quoteIdent(c) : `${quoteIdent(c)}::text`);
  const changelog = o.changelog;

  const filterSchema = z.object({
    search: z.string().optional().describe(`Matches ${(o.searchColumns ?? []).join(', ') || 'nothing'}.`),
    ...(o.filters ?? {}),
    cursor: z.string().optional().describe('From the previous page\'s nextCursor (large lists only).'),
  }).merge(pagination);

  defineRoute({
    method: 'get', path, module: o.module,
    summary: `List ${o.label}s`,
    description: `Paginated. \`total\` is the count before paging, for the pager.`,
    permission: `${o.permission}.view`,
    query: filterSchema,
    responses: [
      { status: 200, description: `Matching ${o.label}s.`, schema: listOf(record) },
      { status: 403, description: 'Missing permission.', schema: errorEnvelope },
    ],
    changelog,
    handler: async (req) => transaction(async (tx) => {
      const q = req.query as Record<string, unknown>;
      const clauses: string[] = soft ? ['deleted_at is null'] : [];
      const params: unknown[] = [];

      if (q.search && o.searchColumns?.length) {
        params.push(`%${q.search}%`);
        const p = `$${params.length}`;
        clauses.push(`(${o.searchColumns.map((c) => `${searchExpr(c)} ilike ${p}`).join(' or ')})`);
      }
      for (const key of Object.keys(o.filters ?? {})) {
        if (q[key] === undefined) continue;
        params.push(q[key]);
        clauses.push(`${quoteIdent(key)} = $${params.length}`);
      }

      if (o.keyset) {
        const col = o.keyset.column;
        const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
        if (q.cursor) {
          const cursor = decodeCursor(String(q.cursor));
          if (col) {
            params.push(cursor.value, cursor.id);
            clauses.push(`(${quoteIdent(col)}, id) > ($${params.length - 1}, $${params.length}::uuid)`);
          } else {
            params.push(cursor.id);
            clauses.push(`id < $${params.length}::uuid`);
          }
        }
        params.push(limit + 1);
        const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
        const rows = await tx.query<Row>(
          `select ${o.listSelect ?? '*'} from ${quoteIdent(o.table)} ${where}
            order by ${col ? `${quoteIdent(col)} asc, id asc` : 'id desc'}
            limit $${params.length}`,
          params,
        );
        const hasMore = rows.length > limit;
        if (hasMore) rows.pop();
        const last = rows[rows.length - 1];
        return { rows, nextCursor: hasMore && last ? encodeCursor(col ? last[col] : null, String(last.id)) : null };
      }

      const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
      const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
      const offset = Math.max(Number(q.offset ?? 0), 0);
      const rows = await tx.query(
        `select ${o.listSelect ?? '*'} from ${quoteIdent(o.table)} ${where}
          order by ${o.defaultOrder ?? 'created_at desc'} limit ${limit} offset ${offset}`, params);
      const counted = await tx.one<{ count: string }>(
        `select count(*)::text count from ${quoteIdent(o.table)} ${where}`, params);
      return { rows, total: Number(counted.count), limit, offset };
    }),
  });

  defineRoute({
    method: 'get', path: `${path}/:id`, module: o.module,
    summary: `Get one ${o.label}`,
    permission: `${o.permission}.view`,
    params: idParam,
    responses: [
      { status: 200, description: `The ${o.label}.`, schema: record },
      { status: 404, description: 'Not found, or belongs to another tenant.', schema: errorEnvelope },
    ],
    changelog,
    handler: async (req) => transaction((tx) => repo(tx, o.table).getById(param(req, 'id'))),
  });

  defineRoute({
    method: 'post', path, module: o.module,
    summary: `Create a ${o.label}`,
    permission: `${o.permission}.create`,
    body: o.createSchema,
    responses: [
      { status: 201, description: `Created.`, schema: record },
      { status: 400, description: 'Validation failed — see `details`.', schema: errorEnvelope },
      { status: 409, description: 'A record with that code already exists.', schema: errorEnvelope },
    ],
    changelog,
    handler: async (req, res) => {
      const row = await transaction(async (tx) => {
        const values = o.hooks?.beforeCreate ? await o.hooks.beforeCreate(tx, req.body as Row) : (req.body as Row);
        const created = await repo<Row>(tx, o.table).insert(values);
        await recordAudit(tx, `${o.table}.create`, o.table, String(created.id), values);
        return created;
      });
      res.status(201).json(row);
    },
  });

  defineRoute({
    method: 'patch', path: `${path}/:id`, module: o.module,
    summary: `Update a ${o.label}`,
    description: 'Only the fields you send are changed.',
    permission: `${o.permission}.update`,
    params: idParam, body: o.updateSchema,
    responses: [
      { status: 200, description: 'Updated.', schema: record },
      { status: 404, description: 'Not found.', schema: errorEnvelope },
    ],
    changelog,
    handler: async (req) => transaction(async (tx) => {
      const id = param(req, 'id');
      const r = repo<Row>(tx, o.table);
      const current = await r.getById(id);
      const values = o.hooks?.beforeUpdate
        ? await o.hooks.beforeUpdate(tx, req.body as Row, current)
        : (req.body as Row);
      const updated = await r.update(id, values);
      const before = Object.fromEntries(Object.keys(values).map((k) => [k, current[k]]));
      await recordAudit(tx, `${o.table}.update`, o.table, id, { before, after: values });
      return updated;
    }),
  });

  defineRoute({
    method: 'delete', path: `${path}/:id`, module: o.module,
    summary: `Remove a ${o.label}`,
    description: soft
      ? 'Soft delete — the row stays for the audit trail and disappears from lists.'
      : 'Hard delete. Fails if anything references it.',
    permission: `${o.permission}.delete`,
    params: idParam,
    responses: [
      { status: 204, description: 'Removed.' },
      { status: 409, description: 'Referenced elsewhere — deactivate instead.', schema: errorEnvelope },
    ],
    changelog,
    handler: async (req, res) => {
      await transaction(async (tx) => {
        const id = param(req, 'id');
        const r = repo<Row>(tx, o.table);
        const current = await r.getById(id); // 404 instead of a silent no-op
        if (o.hooks?.beforeDelete) await o.hooks.beforeDelete(tx, current);
        await r.remove(id);
        await recordAudit(tx, `${o.table}.delete`, o.table, id);
      });
      res.status(204).end();
    },
  });
}
