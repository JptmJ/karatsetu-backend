/**
 * Old Gold: intake (exchange or buyback), payouts, old gold in stock,
 * melting and refining, and the register.
 */
import { z } from 'zod';
import { defineRoute, queryOf } from '../core/http/route-registry.js';
import { transaction, type Tx } from '../core/db/client.js';
import { param } from '../core/http/middleware.js';
import {
  cancelIntake, cancelMeltBatch, createIntake, createMeltBatch, intakeDetail, meltBatchDetail, oldGoldSettings, payoutIntake, quoteIntake, receiveMeltBatch,
} from '../modules/oldgold/oldgold.service.js';
import { OLD_GOLD_TEST_METHODS } from '../modules/oldgold/oldgold.schema.js';
import { decodeCursor, encodeCursor } from './crud.js';
import { decimal, errorEnvelope, idParam, isoDate, money, record, uuid, weight } from './schemas.js';

const DAY = '2026-09-30';
const added = (note: string) => [{ date: DAY, kind: 'added' as const, note }];
const O = '/api/oldgold';
const cursorPage = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const page = z.object({ rows: z.array(record), nextCursor: z.string().nullable() });
const reason = z.object({ reason: z.string().trim().min(3).max(500) });

async function newestFirst(tx: Tx, sql: (where: string, limit: string) => string, clauses: string[], params: unknown[],
  q: { cursor?: string; limit?: number }, alias: string) {
  const limit = Number(q.limit ?? 50);
  if (q.cursor) { params.push(decodeCursor(q.cursor).id); clauses.push(`${alias}.id < $${params.length}::uuid`); }
  params.push(limit + 1);
  const rows = await tx.query<Record<string, unknown> & { id: string }>(sql(clauses.length ? `where ${clauses.join(' and ')}` : '', `$${params.length}`), params);
  const more = rows.length > limit;
  if (more) rows.pop();
  return { rows, nextCursor: more ? encodeCursor(null, rows[rows.length - 1]!.id) : null };
}

export const oldGoldLine = z.object({
  description: z.string().trim().min(1).max(200), metalId: uuid.optional(), itemCategoryId: uuid.nullish(),
  grossWeight: weight, stoneWeight: weight.optional(), dirtWeight: weight.optional(),
  testMethod: z.enum(OLD_GOLD_TEST_METHODS),
  testedPurityPercent: decimal.optional().describe('As tested or estimated, e.g. 91.2. For the shop’s own piece its purity is used when left out.'),
  declaredPurityPercent: decimal.optional(), testInstrument: z.string().trim().max(80).optional(), huid: z.string().trim().max(10).optional(),
  ownPiece: z.string().trim().max(40).optional().describe('Tag number or HUID of a piece this shop sold: own-jewellery terms apply.'),
  lossPercent: decimal.optional().describe('Used only when Old Gold settings let staff change the melting loss.'),
  notes: z.string().max(300).optional(),
});
export const idProof = z.object({ type: z.enum(['aadhaar', 'pan', 'voter_id', 'driving_licence', 'passport', 'other']), number: z.string().trim().min(3).max(40) });

defineRoute({
  method: 'get', path: `${O}/settings`, module: 'oldgold', summary: 'Old Gold settings in force',
  description: 'Valuation basis, rate source, margin, melting loss, estimate, buyback, cash limit, own-jewellery terms, identity rules, hold days and register columns. Read-only here; changed in Settings.',
  permission: 'oldgold.view',
  responses: [{ status: 200, description: 'The settings.', schema: record }],
  changelog: added('Old Gold settings for the desk and counter.'),
  handler: async () => transaction((tx) => oldGoldSettings(tx)),
});

defineRoute({
  method: 'post', path: `${O}/quote`, module: 'oldgold', summary: 'Value old gold as it will be credited',
  description: 'The same valuation an intake saves, from Old Gold settings: fine or purity basis, rate, margin, melting loss, own-jewellery terms. Nothing is saved.',
  permission: 'oldgold.view', body: z.object({ lines: z.array(oldGoldLine).min(1).max(50) }),
  responses: [{ status: 200, description: 'Each article’s net, fine, rate and value, and the totals.', schema: record },
    { status: 422, description: 'A rate or purity is missing, or an own piece is not a sold piece.', schema: errorEnvelope }],
  changelog: added('Old gold valuation.'),
  handler: async (req) => transaction((tx) => quoteIntake(tx, req.body.lines)),
});

defineRoute({
  method: 'post', path: `${O}/intakes`, module: 'oldgold', summary: 'Take old gold in',
  description: [
    'Posts at once: old gold into stock at the location, its value credited to the customer.',
    '`exchange` keeps the credit to spend on a bill or as advance; `buyback` pays it out now (needs `payout`).',
    'Proof of identity and PAN are asked as Old Gold settings and the ₹2 lakh rule say; cash payouts follow the daily cash limit.',
  ].join(' '),
  permission: 'oldgold.create',
  body: z.object({
    customerId: uuid, locationId: uuid.optional(), settlement: z.enum(['exchange', 'buyback']),
    payout: z.object({ paymentMethodId: uuid, reference: z.string().trim().max(80).optional() }).optional(),
    idProof: idProof.optional(), pan: z.string().trim().max(10).optional(), notes: z.string().max(500).optional(),
    lines: z.array(oldGoldLine).min(1).max(50),
  }),
  responses: [{ status: 201, description: 'The intake with its articles.', schema: record },
    { status: 422, description: 'Identity, PAN, cash limit, rate or article checks.', schema: errorEnvelope }],
  changelog: added('Old gold intake.'),
  handler: async (req, res) => { res.status(201).json(await transaction((tx) => createIntake(tx, req.body))); },
});

defineRoute({
  method: 'get', path: `${O}/intakes`, module: 'oldgold', summary: 'Old gold intakes', permission: 'oldgold.view',
  query: z.object({ customerId: uuid.optional(), status: z.enum(['posted', 'cancelled']).optional(),
    search: z.string().optional().describe('Voucher number, customer name or mobile.') }).merge(cursorPage),
  responses: [{ status: 200, description: 'Newest first, with the credit still unpaid and whether any is melted.', schema: page }],
  changelog: added('Intake register.'),
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses = ['g.branch_id = $1']; const params: unknown[] = [tx.context.branchId];
    if (q.customerId) { params.push(q.customerId); clauses.push(`g.customer_id = $${params.length}`); }
    if (q.status) { params.push(q.status); clauses.push(`g.status = $${params.length}`); }
    if (q.search) { params.push(`%${q.search}%`); clauses.push(`(g.voucher_number ilike $${params.length} or p.name ilike $${params.length} or p.phone ilike $${params.length})`); }
    return newestFirst(tx, (where, limit) =>
      `select g.id, g.voucher_number, g.voucher_date, g.status, g.settlement_type, g.channel, g.total_gross_weight, g.total_net_weight,
              g.total_fine_weight, g.net_value, g.paid_out_amount, g.net_value - g.paid_out_amount as credit_amount, p.name as customer_name,
              p.phone as customer_phone, si.doc_number as invoice_number,
              (select count(*)::int from old_gold_item gi where gi.old_gold_intake_id = g.id) as line_count,
              exists (select 1 from old_gold_item gi where gi.old_gold_intake_id = g.id and gi.melt_batch_id is not null) as melted
         from old_gold_intake g join party p on p.id = g.customer_id left join sales_invoice si on si.id = g.applied_to_invoice_id
         ${where} order by g.id desc limit ${limit}`, clauses, params, q, 'g');
  }),
});

defineRoute({
  method: 'get', path: `${O}/intakes/:id`, module: 'oldgold', summary: 'One intake, as it prints', permission: 'oldgold.view', params: idParam,
  responses: [{ status: 200, description: 'The intake, its articles and payouts, the shop and the customer.', schema: record }],
  changelog: added('Intake detail.'),
  handler: async (req) => transaction((tx) => intakeDetail(tx, param(req, 'id'))),
});

defineRoute({
  method: 'post', path: `${O}/intakes/:id/payout`, module: 'oldgold', summary: 'Pay out old-gold credit',
  description: 'Pays the customer some or all of what is left of an intake’s credit (a buyback after all). Same identity, PAN and cash rules as a buyback.',
  permission: 'oldgold.payout', params: idParam,
  body: z.object({ paymentMethodId: uuid, amount: money.optional(), reference: z.string().trim().max(80).optional(), idProof: idProof.optional(), pan: z.string().trim().max(10).optional() }),
  responses: [{ status: 200, description: 'The intake.', schema: record }, { status: 422, description: 'More than is left, credit already spent, or a payment rule.', schema: errorEnvelope }],
  changelog: added('Old gold payout.'),
  handler: async (req) => transaction((tx) => payoutIntake(tx, param(req, 'id'), req.body)),
});

defineRoute({
  method: 'post', path: `${O}/intakes/:id/cancel`, module: 'oldgold', summary: 'Cancel an intake entered by mistake',
  description: 'Only while nothing is melted, nothing was paid out and the credit is unspent. One taken in on a bill is cancelled with the bill.',
  permission: 'oldgold.cancel', params: idParam, body: reason,
  responses: [{ status: 200, description: 'Cancelled.', schema: record }, { status: 422, description: 'Melted, paid out, on a bill or credit used.', schema: errorEnvelope }],
  changelog: added('Cancel an intake.'),
  handler: async (req) => transaction((tx) => cancelIntake(tx, param(req, 'id'), req.body.reason)),
});

defineRoute({
  method: 'get', path: `${O}/stock`, module: 'oldgold', summary: 'Old gold waiting to be melted, and at refiners', permission: 'oldgold.view',
  query: z.object({ metalId: uuid.optional() }),
  responses: [{ status: 200, description: 'Totals per metal, the articles still unmelted (oldest first), and batches at refiners.', schema: record }],
  changelog: added('Old gold stock.'),
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<{ metalId?: string }>(req);
    const [metals, articles, atRefiner] = await Promise.all([
      tx.query(`select gi.metal_id, m.name as metal_name, count(*)::int as articles, sum(gi.gross_weight)::text as gross_weight,
                       sum(gi.net_weight)::text as net_weight, sum(gi.fine_weight)::text as fine_weight, sum(gi.value)::text as value
                  from old_gold_item gi join old_gold_intake g on g.id = gi.old_gold_intake_id join metal m on m.id = gi.metal_id
                 where g.branch_id = $1 and g.status = 'posted' and gi.melt_batch_id is null group by gi.metal_id, m.name order by m.name`, [tx.context.branchId]),
      tx.query(`select gi.id, gi.description, gi.metal_id, gi.gross_weight, gi.net_weight, gi.tested_purity_percent, gi.fine_weight, gi.value,
                       g.voucher_number, g.voucher_date, p.name as customer_name, l.name as location_name
                  from old_gold_item gi join old_gold_intake g on g.id = gi.old_gold_intake_id join party p on p.id = g.customer_id
                  join stock_location l on l.id = g.location_id
                 where g.branch_id = $1 and g.status = 'posted' and gi.melt_batch_id is null and ($2::uuid is null or gi.metal_id = $2)
                 order by g.voucher_date, g.voucher_number, gi.line_number limit 1000`, [tx.context.branchId, q.metalId ?? null]),
      tx.query(`select mb.id, mb.batch_number, mb.batch_date, mb.input_fine_weight, mb.input_value, m.name as metal_name, p.name as refiner_name
                  from melt_batch mb join metal m on m.id = mb.metal_id join party p on p.id = mb.refiner_id
                 where mb.branch_id = $1 and mb.status = 'sent' order by mb.batch_date`, [tx.context.branchId]),
    ]);
    return { metals, articles, atRefiner };
  }),
});

const output = z.object({ outputItemId: uuid, outputPurityId: uuid, outputWeight: weight, assayPercent: decimal.optional(), locationId: uuid.optional() });

defineRoute({
  method: 'post', path: `${O}/melt-batches`, module: 'oldgold', summary: 'Melt old gold, or send it to a refiner',
  description: '`melt`: in-house, with what came out (bullion item, purity, weight, assay). `refine`: sent to `refinerId`, received later. One metal per batch; the hold period in settings applies.',
  permission: 'oldgold.melt',
  body: z.object({ kind: z.enum(['melt', 'refine']), itemIds: z.array(uuid).min(1).max(1000), refinerId: uuid.optional(), output: output.optional(), notes: z.string().max(500).optional() }),
  responses: [{ status: 201, description: 'The batch.', schema: record }, { status: 422, description: 'Already melted, on hold, mixed metals or output checks.', schema: errorEnvelope }],
  changelog: added('Melt and refine.'),
  handler: async (req, res) => { res.status(201).json(await transaction((tx) => createMeltBatch(tx, req.body))); },
});

defineRoute({
  method: 'get', path: `${O}/melt-batches`, module: 'oldgold', summary: 'Melt and refine batches', permission: 'oldgold.view',
  query: z.object({ status: z.enum(['melted', 'sent', 'received', 'cancelled']).optional() }).merge(cursorPage),
  responses: [{ status: 200, description: 'Newest first.', schema: page }],
  changelog: added('Batch register.'),
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses = ['mb.branch_id = $1']; const params: unknown[] = [tx.context.branchId];
    if (q.status) { params.push(q.status); clauses.push(`mb.status = $${params.length}`); }
    return newestFirst(tx, (where, limit) =>
      `select mb.id, mb.batch_number, mb.batch_date, mb.kind, mb.status, mb.metal_id, mb.input_gross_weight, mb.input_fine_weight, mb.input_value,
              mb.output_weight, mb.output_fine_weight, mb.loss_fine_weight, mb.refining_charge, m.name as metal_name, p.name as refiner_name,
              i.name as output_item_name, pu.code as output_purity_code
         from melt_batch mb join metal m on m.id = mb.metal_id left join party p on p.id = mb.refiner_id left join item i on i.id = mb.output_item_id
         left join purity pu on pu.id = mb.output_purity_id ${where} order by mb.id desc limit ${limit}`, clauses, params, q, 'mb');
  }),
});

defineRoute({
  method: 'get', path: `${O}/melt-batches/:id`, module: 'oldgold', summary: 'One batch with the old gold in it', permission: 'oldgold.view', params: idParam,
  responses: [{ status: 200, description: 'The batch.', schema: record }],
  changelog: added('Batch detail.'),
  handler: async (req) => transaction((tx) => meltBatchDetail(tx, param(req, 'id'))),
});

defineRoute({
  method: 'post', path: `${O}/melt-batches/:id/receive`, module: 'oldgold', summary: 'Receive refined metal',
  description: 'What came back from the refiner (bullion item, purity, weight, assay) and the refining charge, which is owed to the refiner.',
  permission: 'oldgold.melt', params: idParam,
  body: output.extend({ refiningCharge: money.optional(), certificateNumber: z.string().trim().max(60).optional() }),
  responses: [{ status: 200, description: 'The batch.', schema: record }, { status: 422, description: 'Not at a refiner, or output checks.', schema: errorEnvelope }],
  changelog: added('Receive from refiner.'),
  handler: async (req) => transaction((tx) => receiveMeltBatch(tx, param(req, 'id'), req.body)),
});

defineRoute({
  method: 'post', path: `${O}/melt-batches/:id/cancel`, module: 'oldgold', summary: 'Cancel a batch',
  description: 'While its bullion is still in stock. The old gold returns, unmelted.',
  permission: 'oldgold.melt', params: idParam, body: reason,
  responses: [{ status: 200, description: 'Cancelled.', schema: record }, { status: 422, description: 'Bullion already used.', schema: errorEnvelope }],
  changelog: added('Cancel a batch.'),
  handler: async (req) => transaction((tx) => cancelMeltBatch(tx, param(req, 'id'), req.body.reason)),
});

defineRoute({
  method: 'get', path: `${O}/register`, module: 'oldgold', summary: 'The old gold register',
  description: 'Every article taken in between two dates, with the customer, identity proof, weights, purity, value and how it was settled. The Register tab chooses and orders the columns.',
  permission: 'oldgold.view',
  query: z.object({ from: isoDate, to: isoDate, search: z.string().optional() }),
  responses: [{ status: 200, description: 'Rows in date order (up to 5,000).', schema: z.object({ rows: z.array(record) }) }],
  changelog: added('Old gold register.'),
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<{ from: string; to: string; search?: string }>(req);
    return { rows: await tx.query(
      `select g.voucher_date as date, g.voucher_number as voucher, g.status, p.name as customer, p.phone, concat_ws(', ', p.address_line1, p.city) as address,
              p.pan, g.id_proof_type, g.id_proof_number, gi.description, m.name as metal, gi.gross_weight as gross, gi.stone_weight + gi.dirt_weight as deduction,
              gi.net_weight as net, gi.tested_purity_percent as purity, gi.test_method as test, gi.huid, gi.loss_percent as loss, gi.fine_weight as fine,
              gi.rate_per_gram as rate, gi.value, g.settlement_type as settlement, si.doc_number as bill, mb.batch_number as melt, u.full_name as taken_by
         from old_gold_item gi join old_gold_intake g on g.id = gi.old_gold_intake_id join party p on p.id = g.customer_id join metal m on m.id = gi.metal_id
         left join sales_invoice si on si.id = g.applied_to_invoice_id left join melt_batch mb on mb.id = gi.melt_batch_id left join app_user u on u.id = g.tested_by
        where g.branch_id = $1 and g.voucher_date between $2 and $3
          and ($4::text is null or g.voucher_number ilike $4 or p.name ilike $4 or p.phone ilike $4 or gi.description ilike $4)
        order by g.voucher_date, g.voucher_number, gi.line_number limit 5000`,
      [tx.context.branchId, q.from, q.to, q.search ? `%${q.search}%` : null]) };
  }),
});
