/**
 * Masters are almost all the same shape: list with a search box, create, read,
 * update, deactivate. Rather than writing that five times, `crudRouter` builds
 * it from a description of the table.
 *
 * Anything with real logic gets its own route file instead.
 */
import { Router } from 'express';
import { z, type ZodType } from 'zod';
import { handler, param, requirePermission, validate } from '../../core/http/middleware.js';
import { transaction } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { quoteIdent } from '../../core/db/schema/sql.js';
import { getTable } from '../../core/db/schema/registry.js';

interface CrudOptions {
  table: string;
  permission: string;
  createSchema: ZodType;
  updateSchema: ZodType;
  /** Columns a `?search=` query matches against. */
  searchColumns: string[];
  defaultOrder?: string;
  /** Extra `?filter=value` query params mapped onto columns. */
  filters?: string[];
}

export function crudRouter(options: CrudOptions): Router {
  const router = Router();
  const { table, permission } = options;

  router.get(
    '/',
    requirePermission(`${permission}.view`),
    validate({
      query: z.object({
        search: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }).passthrough(),
    }),
    handler(async (req, res) => {
      const { search, limit, offset } = req.query as unknown as { search?: string; limit: number; offset: number };

      const result = await transaction(async (tx) => {
        // Only tables that declared soft delete have a deleted_at column.
        const clauses: string[] = getTable(table)?.softDelete ? ['deleted_at is null'] : [];
        const params: unknown[] = [];

        if (search && options.searchColumns.length) {
          params.push(`%${search}%`);
          const p = `$${params.length}`;
          clauses.push(`(${options.searchColumns.map((c) => `${quoteIdent(c)} ilike ${p}`).join(' or ')})`);
        }

        for (const filter of options.filters ?? []) {
          const value = (req.query as Record<string, unknown>)[filter];
          if (value === undefined) continue;
          params.push(value === 'true' ? true : value === 'false' ? false : value);
          clauses.push(`${quoteIdent(filter)} = $${params.length}`);
        }

        const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
        const rows = await tx.query(
          `select * from ${quoteIdent(table)} ${where}
            order by ${options.defaultOrder ?? 'created_at desc'}
            limit ${limit} offset ${offset}`,
          params,
        );
        const counted = await tx.one<{ count: string }>(
          `select count(*)::text as count from ${quoteIdent(table)} ${where}`,
          params,
        );

        return { rows, total: Number(counted.count), limit, offset };
      });

      res.json(result);
    }),
  );

  router.get(
    '/:id',
    requirePermission(`${permission}.view`),
    validate({ params: z.object({ id: z.string().uuid() }) }),
    handler(async (req, res) => {
      res.json(await transaction((tx) => repo(tx, table).getById(param(req, 'id'))));
    }),
  );

  router.post(
    '/',
    requirePermission(`${permission}.create`),
    validate({ body: options.createSchema }),
    handler(async (req, res) => {
      res.status(201).json(await transaction((tx) => repo(tx, table).insert(req.body)));
    }),
  );

  router.patch(
    '/:id',
    requirePermission(`${permission}.update`),
    validate({ params: z.object({ id: z.string().uuid() }), body: options.updateSchema }),
    handler(async (req, res) => {
      res.json(await transaction((tx) => repo(tx, table).update(param(req, 'id'), req.body)));
    }),
  );

  router.delete(
    '/:id',
    requirePermission(`${permission}.delete`),
    validate({ params: z.object({ id: z.string().uuid() }) }),
    handler(async (req, res) => {
      await transaction((tx) => repo(tx, table).remove(param(req, 'id')));
      res.status(204).end();
    }),
  );

  return router;
}

/* ------------------------------------------------------------------ */
/* The master routers                                                  */
/* ------------------------------------------------------------------ */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a number');

export const branchRouter = crudRouter({
  table: 'branch',
  permission: 'masters.branch',
  searchColumns: ['code', 'name', 'city'],
  defaultOrder: 'code',
  filters: ['kind', 'is_active'],
  createSchema: z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(1),
    kind: z.enum(['showroom', 'factory', 'warehouse', 'office']).default('showroom'),
    gstin: z.string().length(15).optional(),
    state_code: z.string().max(2).optional(),
    address_line1: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  }),
  updateSchema: z.object({
    name: z.string().min(1).optional(),
    gstin: z.string().length(15).nullish(),
    state_code: z.string().max(2).nullish(),
    address_line1: z.string().nullish(),
    city: z.string().nullish(),
    phone: z.string().nullish(),
    is_active: z.boolean().optional(),
  }),
});

export const partyRouter = crudRouter({
  table: 'party',
  permission: 'masters.customer',
  searchColumns: ['code', 'name', 'phone', 'gstin'],
  defaultOrder: 'name',
  filters: ['is_customer', 'is_supplier', 'is_active'],
  createSchema: z
    .object({
      code: z.string().min(1).max(30),
      name: z.string().min(1),
      is_customer: z.boolean().default(false),
      is_supplier: z.boolean().default(false),
      party_type: z.enum(['individual', 'business']).default('individual'),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      gstin: z.string().length(15).optional(),
      pan: z.string().length(10).optional(),
      state_code: z.string().max(2).optional(),
      address_line1: z.string().optional(),
      city: z.string().optional(),
      credit_limit: decimalString.optional(),
      credit_days: z.number().int().min(0).optional(),
    })
    .refine((v) => v.is_customer || v.is_supplier, {
      message: 'Mark this party as a customer, a supplier, or both.',
    }),
  updateSchema: z.object({
    name: z.string().min(1).optional(),
    is_customer: z.boolean().optional(),
    is_supplier: z.boolean().optional(),
    phone: z.string().nullish(),
    email: z.string().email().nullish(),
    gstin: z.string().length(15).nullish(),
    state_code: z.string().max(2).nullish(),
    credit_limit: decimalString.nullish(),
    credit_days: z.number().int().min(0).nullish(),
    is_active: z.boolean().optional(),
  }),
});

export const itemRouter = crudRouter({
  table: 'item',
  permission: 'masters.purity',
  searchColumns: ['code', 'name'],
  defaultOrder: 'name',
  filters: ['nature', 'tracking', 'is_active', 'category_id'],
  createSchema: z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1),
    nature: z.enum(['raw_metal', 'finished', 'stone', 'consumable', 'service']).default('finished'),
    tracking: z.enum(['lot', 'piece']).default('piece'),
    category_id: z.string().uuid().optional(),
    metal_id: z.string().uuid().optional(),
    default_purity_id: z.string().uuid().optional(),
    hsn_code: z.string().optional(),
    default_making_rate: decimalString.optional(),
    default_wastage_percent: decimalString.optional(),
    uom: z.enum(['gram', 'piece', 'carat', 'millilitre']).default('gram'),
  }),
  updateSchema: z.object({
    name: z.string().min(1).optional(),
    category_id: z.string().uuid().nullish(),
    default_purity_id: z.string().uuid().nullish(),
    hsn_code: z.string().nullish(),
    default_making_rate: decimalString.nullish(),
    default_wastage_percent: decimalString.nullish(),
    is_active: z.boolean().optional(),
  }),
});

export const purityRouter = crudRouter({
  table: 'purity',
  permission: 'masters.purity',
  searchColumns: ['code', 'name'],
  defaultOrder: 'sort_order, code',
  filters: ['metal_id', 'is_active'],
  createSchema: z.object({
    metal_id: z.string().uuid(),
    code: z.string().min(1).max(20),
    name: z.string().min(1),
    fineness_percent: decimalString,
    karat: decimalString.optional(),
    is_hallmarkable: z.boolean().default(true),
    sort_order: z.number().int().default(0),
  }),
  updateSchema: z.object({
    name: z.string().min(1).optional(),
    fineness_percent: decimalString.optional(),
    is_hallmarkable: z.boolean().optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  }),
});

/* --- rate master (Module 12.6): entering a rate, never editing one --- */
export const rateRouter = Router();

rateRouter.get(
  '/current',
  requirePermission('settings.rates.view'),
  handler(async (req, res) => {
    const rows = await transaction((tx) =>
      tx.query(
        `select distinct on (r.metal_id, r.purity_id)
                r.id, r.metal_id, r.purity_id, r.rate_per_gram, r.buying_rate_per_gram,
                r.effective_from, m.code as metal_code, p.code as purity_code, p.name as purity_name
           from metal_rate r
           join metal m on m.id = r.metal_id
           left join purity p on p.id = r.purity_id
          where r.effective_from <= now()
            and (r.branch_id = $1 or r.branch_id is null)
          order by r.metal_id, r.purity_id, r.effective_from desc, r.branch_id nulls last`,
        [req.ctx?.branchId ?? null],
      ),
    );
    res.json({ rates: rows });
  }),
);

rateRouter.post(
  '/',
  requirePermission('settings.rates.create'),
  validate({
    body: z.object({
      metal_id: z.string().uuid(),
      purity_id: z.string().uuid().optional(),
      rate_per_gram: decimalString,
      buying_rate_per_gram: decimalString.optional(),
      branch_id: z.string().uuid().optional(),
      effective_from: z.string().datetime().optional(),
    }),
  }),
  handler(async (req, res) => {
    // A new rate is a new row. Yesterday's invoices keep pointing at yesterday's
    // rate, so an old bill can always be explained.
    res.status(201).json(await transaction((tx) => repo(tx, 'metal_rate').insert(req.body)));
  }),
);
