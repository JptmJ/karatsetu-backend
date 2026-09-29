/** POS & Billing and purchase — the counter-facing modules. */
import { z } from 'zod';
import { defineRoute, queryOf } from '../core/http/route-registry.js';
import { transaction } from '../core/db/client.js';
import { param } from '../core/http/middleware.js';
import { cancelSalesInvoice, createSalesInvoice, postSalesInvoice } from '../modules/sales/sales.service.js';
import { cancelPurchaseInvoice, createPurchaseInvoice, postPurchaseInvoice } from '../modules/purchase/purchase.service.js';
import { decimal, errorEnvelope, idParam, isoDate, listOf, money, pagination, record, uuid, weight } from './schemas.js';

const TODAY = '2026-09-18';
const seed = [{ date: TODAY, kind: 'added' as const, note: 'Initial endpoint.' }];

/* ------------------------------------------------------------- POS */

const saleLine = z.object({
  itemId: uuid, purityId: uuid.nullish(), pieceId: uuid.nullish().describe('Set when selling a specific tagged piece.'),
  locationId: uuid.nullish(), description: z.string().optional(),
  quantity: decimal.optional(), grossWeight: weight, stoneWeight: weight.optional(),
  ratePerGram: money.optional().describe('Omit to use today’s broadcast rate.'),
  makingBasis: z.enum(['per_gram', 'percent', 'flat']).optional(), makingRate: decimal.optional(),
  wastagePercent: decimal.optional(), stoneAmount: money.optional(), discountAmount: money.optional(),
  hallmarkCharge: money.optional(), gstRate: decimal.optional(), notes: z.string().optional(),
});

defineRoute({
  method: 'post', path: '/api/pos/invoices', module: 'pos',
  summary: 'Create a sales invoice (draft)',
  description:
    'Prices every line server-side from the rate master and the tenant’s making/wastage config, then applies GST — CGST+SGST within the state, IGST across it, zero-rated for export. Creates a draft; nothing moves until you post it.',
  permission: 'pos.create',
  body: z.object({
    customerId: uuid, branchId: uuid, docDate: isoDate,
    channel: z.enum(['counter', 'wholesale', 'export', 'online']).default('counter'),
    salespersonId: uuid.optional(), otherCharges: money.optional(), notes: z.string().optional(),
    lines: z.array(saleLine).min(1),
    payments: z.array(z.object({
      mode: z.enum(['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'credit', 'old_gold', 'scheme', 'advance']),
      amount: money, reference: z.string().optional(), accountId: uuid.optional(), notes: z.string().optional(),
    })).optional().describe('A sale is routinely settled by several tenders at once.'),
  }),
  responses: [
    { status: 201, description: 'Draft invoice with all totals computed.', schema: record },
    { status: 422, description: 'Rate missing, payments over total, or back-dating off.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'POS billing with multi-tender settlement.' }],
  handler: async (req, res) => {
    const row = await transaction((tx) => createSalesInvoice(tx, req.body));
    res.status(201).json(row);
  },
});

defineRoute({
  method: 'post', path: '/api/pos/invoices/:id/post', module: 'pos',
  summary: 'Post an invoice — stock out, books updated',
  description:
    'The moment everything happens, in one transaction: stock leaves at cost, revenue and GST are recognised, the customer is debited for any balance, and the piece is marked sold. After this the invoice is read-only.',
  permission: 'pos.post', params: idParam,
  responses: [
    { status: 200, description: 'Posted.', schema: z.object({ invoice: record, voucherId: uuid, voucherNumber: z.string(), costOfGoodsSold: money }) },
    { status: 422, description: 'Already posted, cancelled, empty, or not enough stock.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Posting moves stock and books atomically.' }],
  handler: async (req) => transaction((tx) => postSalesInvoice(tx, param(req, 'id'))),
});

defineRoute({
  method: 'post', path: '/api/pos/invoices/:id/cancel', module: 'pos',
  summary: 'Cancel an invoice',
  description:
    'A posted invoice is reversed, never edited — stock comes back and mirrored ledger entries are written, leaving both the original and the correction visible.',
  permission: 'pos.cancel', params: idParam,
  body: z.object({ reason: z.string().min(3).max(500) }),
  responses: [
    { status: 200, description: 'Cancelled and reversed.', schema: record },
    { status: 422, description: 'Already cancelled, or an IRN exists and must be cancelled on the GST portal first.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => transaction((tx) => cancelSalesInvoice(tx, param(req, 'id'), req.body.reason)),
});

defineRoute({
  method: 'get', path: '/api/pos/invoices', module: 'pos',
  summary: 'List sales invoices',
  permission: 'pos.view',
  query: z.object({
    status: z.enum(['draft', 'confirmed', 'posted', 'cancelled']).optional(),
    customerId: uuid.optional(), branchId: uuid.optional(),
    from: isoDate.optional(), to: isoDate.optional(),
  }).merge(pagination),
  responses: [{ status: 200, description: 'Invoices, newest first.', schema: listOf(record) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    for (const [key, col] of [['status', 'si.status'], ['customerId', 'si.customer_id'], ['branchId', 'si.branch_id']] as const) {
      if (q[key]) { params.push(q[key]); clauses.push(`${col} = $${params.length}`); }
    }
    if (q.from) { params.push(q.from); clauses.push(`si.doc_date >= $${params.length}`); }
    if (q.to) { params.push(q.to); clauses.push(`si.doc_date <= $${params.length}`); }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    return { rows: await tx.query(
      `select si.id, si.doc_number, si.doc_date, si.status, si.channel, si.total_amount,
              si.balance_amount, si.total_net_weight, si.irn_status, p.name as customer_name, b.name as branch_name
         from sales_invoice si join party p on p.id = si.customer_id join branch b on b.id = si.branch_id
        ${where} order by si.doc_date desc, si.doc_number desc
        limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params) };
  }),
});

defineRoute({
  method: 'get', path: '/api/pos/invoices/:id', module: 'pos',
  summary: 'One invoice with lines and payments',
  permission: 'pos.view', params: idParam,
  responses: [
    { status: 200, description: 'The tax invoice.', schema: record },
    { status: 404, description: 'Not found.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const id = param(req, 'id');
    const invoice = await tx.one(
      `select si.*, p.name as customer_name, p.gstin as customer_gstin, p.phone as customer_phone,
              b.name as branch_name, b.gstin as branch_gstin
         from sales_invoice si join party p on p.id = si.customer_id
         join branch b on b.id = si.branch_id where si.id = $1`, [id]);
    const [lines, payments] = await Promise.all([
      tx.query(`select l.*, i.name as item_name, i.code as item_code, pu.code as purity_code, sp.tag_number, sp.huid
                  from sales_invoice_line l join item i on i.id = l.item_id
                  left join purity pu on pu.id = l.purity_id left join stock_piece sp on sp.id = l.piece_id
                 where l.sales_invoice_id = $1 order by l.line_number`, [id]),
      tx.query(`select * from sales_payment where sales_invoice_id = $1 order by received_at`, [id]),
    ]);
    return { ...invoice, lines, payments };
  }),
});

/* -------------------------------------------------------- purchase */

defineRoute({
  method: 'post', path: '/api/pos/purchases', module: 'pos',
  summary: 'Create a purchase invoice (draft)',
  description: 'The buying side. Posting raises stock and credits the supplier.',
  permission: 'pos.purchase.create',
  body: z.object({
    supplierId: uuid, branchId: uuid, docDate: isoDate,
    supplierInvoiceNumber: z.string().optional().describe('Their number, needed for GST matching.'),
    supplierInvoiceDate: isoDate.optional(), dueDate: isoDate.optional(),
    raisesStock: z.boolean().default(true), otherCharges: money.optional(), notes: z.string().optional(),
    lines: z.array(z.object({
      itemId: uuid, purityId: uuid.nullish(), locationId: uuid.nullish(), description: z.string().optional(),
      quantity: decimal.optional(), grossWeight: weight, stoneWeight: weight.optional(), ratePerGram: money,
      makingBasis: z.enum(['per_gram', 'percent', 'flat']).optional(), makingRate: decimal.optional(),
      wastagePercent: decimal.optional(), stoneAmount: money.optional(), discountAmount: money.optional(),
      gstRate: decimal.optional(), notes: z.string().optional(),
    })).min(1),
  }),
  responses: [
    { status: 201, description: 'Draft purchase invoice.', schema: record },
    { status: 422, description: 'Not a supplier, or back-dating is off.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req, res) => {
    const row = await transaction((tx) => createPurchaseInvoice(tx, req.body));
    res.status(201).json(row);
  },
});

defineRoute({
  method: 'post', path: '/api/pos/purchases/:id/post', module: 'pos',
  summary: 'Post a purchase — stock in, supplier credited',
  permission: 'pos.purchase.post', params: idParam,
  responses: [
    { status: 200, description: 'Posted.', schema: z.object({ invoice: record, voucherId: uuid, voucherNumber: z.string() }) },
    { status: 422, description: 'Already posted or empty.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => transaction((tx) => postPurchaseInvoice(tx, param(req, 'id'))),
});

defineRoute({
  method: 'post', path: '/api/pos/purchases/:id/cancel', module: 'pos',
  summary: 'Cancel a purchase invoice',
  permission: 'pos.purchase.cancel', params: idParam,
  body: z.object({ reason: z.string().min(3).max(500) }),
  responses: [{ status: 200, description: 'Cancelled and reversed.', schema: record }],
  changelog: seed,
  handler: async (req) => transaction((tx) => cancelPurchaseInvoice(tx, param(req, 'id'), req.body.reason)),
});
