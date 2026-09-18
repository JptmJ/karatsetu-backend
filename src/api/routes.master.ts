/** Master Data & Rate Hub — the reference data every other module points at. */
import { z } from 'zod';
import { defineRoute } from '../core/http/route-registry.js';
import { defineCrud } from './crud.js';
import { transaction } from '../core/db/client.js';
import { repo } from '../core/db/repository.js';
import { decimal, errorEnvelope, gstin, money, pan, phone, record, uuid } from './schemas.js';

const TODAY = '2026-09-18';
const seed = [{ date: TODAY, kind: 'added' as const, note: 'Initial master endpoints.' }];
const B = '/api/master';

defineCrud({
  basePath: B, resource: 'branches', table: 'branch', module: 'master', label: 'branch',
  permission: 'master.branch', searchColumns: ['code', 'name', 'city'], defaultOrder: 'code',
  filters: { kind: z.enum(['showroom', 'factory', 'warehouse', 'office']).optional(), is_active: z.coerce.boolean().optional() },
  changelog: seed,
  createSchema: z.object({
    code: z.string().min(1).max(20), name: z.string().min(1),
    kind: z.enum(['showroom', 'factory', 'warehouse', 'office']).default('showroom'),
    gstin: gstin.optional(), state_code: z.string().max(2).optional().describe('GST state code — decides CGST+SGST vs IGST.'),
    address_line1: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
    pincode: z.string().optional(), phone: phone.optional(), email: z.string().email().optional(),
  }),
  updateSchema: z.object({
    name: z.string().min(1).optional(), gstin: gstin.nullish(), state_code: z.string().max(2).nullish(),
    address_line1: z.string().nullish(), city: z.string().nullish(), phone: phone.nullish(),
    is_active: z.boolean().optional(),
  }),
});

defineCrud({
  basePath: B, resource: 'parties', table: 'party', module: 'master', label: 'customer or supplier',
  permission: 'master.customer', searchColumns: ['code', 'name', 'phone', 'gstin'], defaultOrder: 'name',
  filters: {
    is_customer: z.coerce.boolean().optional(), is_supplier: z.coerce.boolean().optional(),
    is_active: z.coerce.boolean().optional(), city: z.string().optional(),
  },
  changelog: [...seed, { date: TODAY, kind: 'changed', note: 'One table serves customers and suppliers; filter with is_customer / is_supplier.' }],
  createSchema: z.object({
    code: z.string().min(1).max(30), name: z.string().min(1).describe('Customer name is required.'),
    is_customer: z.boolean().default(false), is_supplier: z.boolean().default(false),
    party_type: z.enum(['individual', 'business']).default('individual'),
    phone: phone.optional(), email: z.string().email().optional(),
    gstin: gstin.optional(), pan: pan.optional(), state_code: z.string().max(2).optional(),
    address_line1: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
    pincode: z.string().optional(), credit_limit: money.optional(), credit_days: z.number().int().min(0).optional(),
    date_of_birth: z.string().optional(), anniversary: z.string().optional(), notes: z.string().optional(),
  }).refine((v) => v.is_customer || v.is_supplier, { message: 'Mark the party as a customer, a supplier, or both.' }),
  updateSchema: z.object({
    name: z.string().min(1).optional(), is_customer: z.boolean().optional(), is_supplier: z.boolean().optional(),
    phone: phone.nullish(), email: z.string().email().nullish(), gstin: gstin.nullish(),
    pan: pan.nullish(), state_code: z.string().max(2).nullish(), city: z.string().nullish(),
    credit_limit: money.nullish(), credit_days: z.number().int().min(0).nullish(),
    kyc_status: z.enum(['none', 'pending', 'verified', 'rejected']).optional(), is_active: z.boolean().optional(),
  }),
});

defineCrud({
  basePath: B, resource: 'items', table: 'item', module: 'master', label: 'item',
  permission: 'master.item', searchColumns: ['code', 'name'], defaultOrder: 'name',
  filters: {
    nature: z.enum(['raw_metal', 'finished', 'stone', 'consumable', 'service']).optional(),
    tracking: z.enum(['lot', 'piece']).optional(), is_active: z.coerce.boolean().optional(), category_id: uuid.optional(),
  },
  changelog: [...seed, { date: TODAY, kind: 'added', note: '`tracking` decides whether stock is counted in pieces or grams.' }],
  createSchema: z.object({
    code: z.string().min(1).max(40), name: z.string().min(1),
    nature: z.enum(['raw_metal', 'finished', 'stone', 'consumable', 'service']).default('finished'),
    tracking: z.enum(['lot', 'piece']).default('piece')
      .describe('piece = individually tagged and counted. lot = bulk metal, measured in grams only.'),
    category_id: uuid.optional(), metal_id: uuid.optional(), default_purity_id: uuid.optional(),
    hsn_code: z.string().optional().describe('7113 for jewellery articles.'),
    default_making_rate: decimal.optional(), default_wastage_percent: decimal.optional(),
    uom: z.enum(['gram', 'piece', 'carat', 'millilitre']).default('gram'),
  }),
  updateSchema: z.object({
    name: z.string().min(1).optional(), category_id: uuid.nullish(), default_purity_id: uuid.nullish(),
    hsn_code: z.string().nullish(), default_making_rate: decimal.nullish(),
    default_wastage_percent: decimal.nullish(), is_active: z.boolean().optional(),
  }),
});

defineCrud({
  basePath: B, resource: 'categories', table: 'item_category', module: 'master', label: 'category',
  permission: 'master.item', searchColumns: ['code', 'name'], defaultOrder: 'sort_order, name',
  filters: { is_active: z.coerce.boolean().optional() }, changelog: seed,
  createSchema: z.object({
    code: z.string().min(1).max(30), name: z.string().min(1), parent_id: uuid.optional(),
    hsn_code: z.string().optional(), sort_order: z.number().int().default(0),
  }),
  updateSchema: z.object({ name: z.string().min(1).optional(), hsn_code: z.string().nullish(),
    sort_order: z.number().int().optional(), is_active: z.boolean().optional() }),
});

defineCrud({
  basePath: B, resource: 'purities', table: 'purity', module: 'master', label: 'purity',
  permission: 'master.purity', searchColumns: ['code', 'name'], defaultOrder: 'sort_order, code',
  filters: { metal_id: uuid.optional(), is_active: z.coerce.boolean().optional() }, changelog: seed,
  createSchema: z.object({
    metal_id: uuid, code: z.string().min(1).max(20).describe('e.g. 22K'), name: z.string().min(1),
    fineness_percent: decimal.describe('91.600 for 22K. Everything calculates from this.'),
    karat: decimal.optional(), is_hallmarkable: z.boolean().default(true), sort_order: z.number().int().default(0),
  }),
  updateSchema: z.object({ name: z.string().min(1).optional(), fineness_percent: decimal.optional(),
    is_hallmarkable: z.boolean().optional(), is_active: z.boolean().optional(), sort_order: z.number().int().optional() }),
});

defineCrud({
  basePath: B, resource: 'metals', table: 'metal', module: 'master', label: 'metal',
  permission: 'master.purity', searchColumns: ['code', 'name'], defaultOrder: 'sort_order', changelog: seed,
  createSchema: z.object({ code: z.string().min(1).max(20), name: z.string().min(1),
    hsn_code: z.string().optional(), sort_order: z.number().int().default(0) }),
  updateSchema: z.object({ name: z.string().min(1).optional(), is_active: z.boolean().optional() }),
});

defineCrud({
  basePath: B, resource: 'karigars', table: 'karigar', module: 'master', label: 'karigar',
  permission: 'master.karigar', searchColumns: ['code', 'name', 'workshop_name', 'speciality'], defaultOrder: 'name',
  filters: { engagement: z.enum(['in_house', 'external']).optional(), is_active: z.coerce.boolean().optional() },
  changelog: [...seed, { date: TODAY, kind: 'added', note: 'Karigar master with ghat (metal loss) allowance.' }],
  createSchema: z.object({
    code: z.string().min(1).max(30), name: z.string().min(1), workshop_name: z.string().optional(),
    engagement: z.enum(['in_house', 'external']).default('external'),
    speciality: z.string().optional().describe('e.g. "Bridal Sets", "Kundan Meena".'),
    phone: phone.optional(), address: z.string().optional(), pan: pan.optional(),
    standard_ghat_percent: decimal.optional().describe('Agreed metal loss allowance, in percent.'),
    labour_rate_per_gram: money.optional(),
  }),
  updateSchema: z.object({ name: z.string().min(1).optional(), speciality: z.string().nullish(),
    phone: phone.nullish(), standard_ghat_percent: decimal.optional(),
    labour_rate_per_gram: money.optional(), is_active: z.boolean().optional() }),
});

defineCrud({
  basePath: B, resource: 'locations', table: 'stock_location', module: 'master', label: 'stock location',
  permission: 'master.branch', searchColumns: ['code', 'name'], defaultOrder: 'code',
  filters: { branch_id: uuid.optional(), kind: z.enum(['counter', 'vault', 'window', 'floor', 'transit', 'karigar']).optional() },
  changelog: seed,
  createSchema: z.object({ branch_id: uuid, code: z.string().min(1).max(20), name: z.string().min(1),
    kind: z.enum(['counter', 'vault', 'window', 'floor', 'transit', 'karigar']).default('counter'),
    is_default: z.boolean().default(false) }),
  updateSchema: z.object({ name: z.string().min(1).optional(), is_default: z.boolean().optional(), is_active: z.boolean().optional() }),
});

/* ------------------------------------------------------------ rate hub */

defineRoute({
  method: 'get', path: '/api/master/rates/current', module: 'master',
  summary: 'Today’s broadcast rates',
  description:
    'The latest rate per metal and purity, honouring a branch-specific rate over the shared one. This is what POS prices from — a sale is refused with `rate_missing` when no rate exists.',
  permission: 'master.rates.view',
  query: z.object({ branchId: uuid.optional() }),
  responses: [{ status: 200, description: 'Current rates.', schema: z.object({ rates: z.array(z.object({
    id: uuid, metal_id: uuid, metal_code: z.string(), purity_id: uuid.nullable(), purity_code: z.string().nullable(),
    rate_per_gram: money, buying_rate_per_gram: money.nullable(), effective_from: z.string(),
  })) }) }],
  changelog: [...seed, { date: TODAY, kind: 'changed', note: 'Branch rates now override the shared rate.' }],
  handler: async (req) => transaction(async (tx) => ({
    rates: await tx.query(
      `select distinct on (r.metal_id, r.purity_id)
              r.id, r.metal_id, r.purity_id, r.rate_per_gram, r.buying_rate_per_gram, r.effective_from,
              m.code as metal_code, p.code as purity_code, p.name as purity_name, p.fineness_percent
         from metal_rate r join metal m on m.id = r.metal_id
         left join purity p on p.id = r.purity_id
        where r.effective_from <= now() and (r.branch_id = $1 or r.branch_id is null)
        order by r.metal_id, r.purity_id, r.effective_from desc, r.branch_id nulls last`,
      [(req.query as { branchId?: string }).branchId ?? req.ctx?.branchId ?? null]),
  })),
});

defineRoute({
  method: 'post', path: '/api/master/rates', module: 'master',
  summary: 'Broadcast a new rate',
  description:
    'A new rate is a new row — rates are never edited. Yesterday’s invoices keep pointing at yesterday’s rate, so an old bill can always be explained.',
  permission: 'master.rates.create',
  body: z.object({
    metal_id: uuid, purity_id: uuid.optional().describe('Omit for a pure-metal rate.'),
    rate_per_gram: money.describe('Selling rate.'),
    buying_rate_per_gram: money.optional().describe('What you pay for old gold. Normally lower.'),
    branch_id: uuid.optional().describe('Omit to broadcast to every branch.'),
    effective_from: z.string().datetime().optional().describe('Defaults to now.'),
  }),
  responses: [
    { status: 201, description: 'Rate broadcast.', schema: record },
    { status: 422, description: 'Rate must be greater than zero.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req, res) => {
    const row = await transaction((tx) => repo(tx, 'metal_rate').insert(req.body));
    res.status(201).json(row);
  },
});

defineRoute({
  method: 'get', path: '/api/master/rates/history', module: 'master',
  summary: 'Rate history for a purity',
  permission: 'master.rates.view',
  query: z.object({ purityId: uuid, days: z.coerce.number().int().min(1).max(365).default(30) }),
  responses: [{ status: 200, description: 'Rates, newest first.', schema: z.object({ rows: z.array(record) }) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = req.query as unknown as { purityId: string; days: number };
    return { rows: await tx.query(
      `select id, rate_per_gram, buying_rate_per_gram, effective_from, source
         from metal_rate where purity_id = $1 and effective_from > now() - ($2 || ' days')::interval
        order by effective_from desc`, [q.purityId, String(q.days)]) };
  }),
});
