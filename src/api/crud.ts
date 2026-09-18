/**
 * Master data is the same five endpoints over and over. This builds them from a
 * description of the table so each master costs a dozen lines rather than two
 * hundred — and, because they go through the registry, they document themselves
 * exactly like the hand-written endpoints do.
 */
import { z, type ZodType } from 'zod';
import { defineRoute, type RouteChange } from '../core/http/route-registry.js';
import { transaction } from '../core/db/client.js';
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
}

export function defineCrud(o: CrudOptions): void {
  const path = `${o.basePath}/${o.resource}`;
  const soft = getTable(o.table)?.softDelete ?? false;
  const changelog = o.changelog;

  const filterSchema = z.object({
    search: z.string().optional().describe(`Matches ${(o.searchColumns ?? []).join(', ') || 'nothing'}.`),
    ...(o.filters ?? {}),
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
        clauses.push(`(${o.searchColumns.map((c) => `${quoteIdent(c)}::text ilike ${p}`).join(' or ')})`);
      }
      for (const key of Object.keys(o.filters ?? {})) {
        if (q[key] === undefined) continue;
        params.push(q[key]);
        clauses.push(`${quoteIdent(key)} = $${params.length}`);
      }

      const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
      const limit = Number(q.limit ?? 50);
      const offset = Number(q.offset ?? 0);

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
      const row = await transaction((tx) => repo(tx, o.table).insert(req.body));
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
    handler: async (req) => transaction((tx) => repo(tx, o.table).update(param(req, 'id'), req.body)),
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
      await transaction((tx) => repo(tx, o.table).remove(param(req, 'id')));
      res.status(204).end();
    },
  });
}
