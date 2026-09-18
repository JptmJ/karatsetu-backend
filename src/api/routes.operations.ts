/** POS & Billing, Stock, Tagging — the counter-facing modules. */
import { z } from 'zod';
import { defineRoute, queryOf } from '../core/http/route-registry.js';
import { transaction } from '../core/db/client.js';
import { repo } from '../core/db/repository.js';
import { param } from '../core/http/middleware.js';
import { cancelSalesInvoice, createSalesInvoice, postSalesInvoice } from '../modules/sales/sales.service.js';
import { cancelPurchaseInvoice, createPurchaseInvoice, postPurchaseInvoice } from '../modules/purchase/purchase.service.js';
import { rebuildBalances } from '../modules/inventory/stock.service.js';
import { decimal, errorEnvelope, idParam, isoDate, listOf, money, ok, pagination, record, uuid, weight } from './schemas.js';

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

/* ----------------------------------------------------------- stock */

defineRoute({
  method: 'get', path: '/api/stock/balances', module: 'stock',
  summary: 'Current stock by item, purity and location',
  description: 'Lot-tracked items carry weight only; piece-tracked items carry a count as well.',
  permission: 'stock.view',
  query: z.object({
    branchId: uuid.optional(), locationId: uuid.optional(), itemId: uuid.optional(),
    nonZeroOnly: z.coerce.boolean().default(true),
  }),
  responses: [{ status: 200, description: 'Balances.', schema: z.object({ rows: z.array(record) }) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<{ branchId?: string; locationId?: string; itemId?: string; nonZeroOnly: boolean }>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    if (q.branchId) { params.push(q.branchId); clauses.push(`l.branch_id = $${params.length}`); }
    if (q.locationId) { params.push(q.locationId); clauses.push(`sb.location_id = $${params.length}`); }
    if (q.itemId) { params.push(q.itemId); clauses.push(`sb.item_id = $${params.length}`); }
    if (q.nonZeroOnly) clauses.push('(sb.quantity <> 0 or sb.net_weight <> 0)');
    return { rows: await tx.query(
      `select sb.item_id, i.code as item_code, i.name as item_name, i.tracking, sb.purity_id, p.code as purity_code,
              sb.location_id, l.name as location_name, l.kind as location_kind, l.branch_id, b.name as branch_name,
              sb.quantity, sb.gross_weight, sb.net_weight, sb.fine_weight, sb.value, sb.average_rate, sb.last_movement_at
         from stock_balance sb join item i on i.id = sb.item_id
         join stock_location l on l.id = sb.location_id join branch b on b.id = l.branch_id
         left join purity p on p.id = sb.purity_id
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
        order by b.name, l.name, i.name`, params) };
  }),
});

defineRoute({
  method: 'get', path: '/api/stock/pieces', module: 'stock',
  summary: 'Tagged pieces (HUID stock)',
  description: 'Search by tag number or HUID — this is what the command palette queries.',
  permission: 'stock.view',
  query: z.object({
    search: z.string().optional().describe('Matches tag number or HUID.'),
    status: z.enum(['in_stock', 'on_memo', 'sold', 'in_transit', 'with_karigar', 'in_repair', 'melted', 'written_off']).optional(),
    locationId: uuid.optional(), branchId: uuid.optional(), itemId: uuid.optional(),
  }).merge(pagination),
  responses: [{ status: 200, description: 'Pieces.', schema: listOf(record) }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Piece register with HUID search.' }],
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    if (q.search) { params.push(`%${q.search}%`); clauses.push(`(sp.tag_number ilike $${params.length} or sp.huid ilike $${params.length})`); }
    for (const [key, col] of [['status', 'sp.status'], ['locationId', 'sp.location_id'], ['itemId', 'sp.item_id']] as const) {
      if (q[key]) { params.push(q[key]); clauses.push(`${col} = $${params.length}`); }
    }
    if (q.branchId) { params.push(q.branchId); clauses.push(`l.branch_id = $${params.length}`); }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const rows = await tx.query(
      `select sp.*, i.name as item_name, i.code as item_code, pu.code as purity_code,
              l.name as location_name, b.name as branch_name,
              (current_date - sp.received_at::date) as days_in_stock
         from stock_piece sp join item i on i.id = sp.item_id
         join stock_location l on l.id = sp.location_id join branch b on b.id = l.branch_id
         left join purity pu on pu.id = sp.purity_id
        ${where} order by sp.received_at desc
        limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params);
    const counted = await tx.one<{ count: string }>(
      `select count(*)::text count from stock_piece sp join stock_location l on l.id = sp.location_id ${where}`, params);
    return { rows, total: Number(counted.count) };
  }),
});

defineRoute({
  method: 'get', path: '/api/stock/movements', module: 'stock',
  summary: 'The stock journal',
  description: 'Append-only. This is how you answer “where did those 4 grams go”.',
  permission: 'stock.view',
  query: z.object({
    itemId: uuid.optional(), locationId: uuid.optional(), pieceId: uuid.optional(),
    sourceType: z.string().optional(), sourceId: uuid.optional(),
    from: z.string().optional(), to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }),
  responses: [{ status: 200, description: 'Movements, newest first.', schema: z.object({ rows: z.array(record) }) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    for (const [key, col] of [['itemId', 'sm.item_id'], ['locationId', 'sm.location_id'], ['pieceId', 'sm.piece_id'],
      ['sourceType', 'sm.source_type'], ['sourceId', 'sm.source_id']] as const) {
      if (q[key]) { params.push(q[key]); clauses.push(`${col} = $${params.length}`); }
    }
    if (q.from) { params.push(q.from); clauses.push(`sm.moved_at >= $${params.length}`); }
    if (q.to) { params.push(q.to); clauses.push(`sm.moved_at <= $${params.length}`); }
    return { rows: await tx.query(
      `select sm.*, i.code as item_code, i.name as item_name, l.name as location_name
         from stock_movement sm join item i on i.id = sm.item_id join stock_location l on l.id = sm.location_id
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
        order by sm.moved_at desc, sm.created_at desc limit ${Number(q.limit ?? 100)}`, params) };
  }),
});

defineRoute({
  method: 'post', path: '/api/stock/balances/rebuild', module: 'stock',
  summary: 'Rebuild balances from the journal',
  description: 'Recomputes every balance from stock_movement. Nothing should need this, which is why it exists.',
  permission: 'stock.verification.approve',
  responses: [{ status: 200, description: 'Rebuilt.', schema: z.object({ ok: z.boolean(), rebuilt: z.number() }) }],
  changelog: seed,
  handler: async () => ({ ok: true, rebuilt: await transaction(rebuildBalances) }),
});

/* --------------------------------------------------------- tagging */

defineRoute({
  method: 'post', path: '/api/tagging/pieces', module: 'tagging',
  summary: 'Tag a new piece and assign its HUID',
  description:
    'Creates the physical piece record, allocates a tag number from the tag series, and records the BIS HUID. Net metal weight is gross minus stones.',
  permission: 'tagging.create',
  body: z.object({
    itemId: uuid, purityId: uuid, locationId: uuid,
    grossWeight: weight.describe('Total weight as measured.'),
    stoneWeight: weight.optional().describe('Deducted to get net metal weight.'),
    otherWeight: weight.optional(), stoneCount: z.number().int().optional(), stoneValue: money.optional(),
    huid: z.string().regex(/^[A-Z0-9]{6}$/, 'HUID is 6 alphanumeric characters').optional(),
    hallmarkCentre: z.string().optional(),
    costValue: money.optional(), makingCost: money.optional(), supplierId: uuid.optional(),
    tagNumber: z.string().optional().describe('Omit to allocate from the tag series.'),
    origin: z.enum(['opening', 'purchase', 'production_receipt', 'sales_return']).default('opening')
      .describe('Where the piece came from. `purchase` writes no stock movement, because the purchase invoice already raised it — anything else raises stock.'),
  }),
  responses: [
    { status: 201, description: 'Piece tagged.', schema: record },
    { status: 422, description: 'HUID format invalid, or net weight would be negative.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Tag a piece and assign HUID in one call.' }],
  handler: async (req, res) => {
    const { tagPiece } = await import('../modules/tagging/tagging.service.js');
    const b = req.body;
    const row = await transaction((tx) => tagPiece(tx, {
      itemId: b.itemId, purityId: b.purityId, locationId: b.locationId,
      grossWeight: b.grossWeight, stoneWeight: b.stoneWeight, otherWeight: b.otherWeight,
      stoneCount: b.stoneCount, stoneValue: b.stoneValue,
      huid: b.huid, hallmarkCentre: b.hallmarkCentre,
      costValue: b.costValue, makingCost: b.makingCost, supplierId: b.supplierId,
      tagNumber: b.tagNumber, origin: b.origin,
    }));
    res.status(201).json(row);
  },
});

defineRoute({
  method: 'get', path: '/api/tagging/queue', module: 'tagging',
  summary: 'The thermal printer queue',
  permission: 'tagging.view',
  query: z.object({ status: z.enum(['queued', 'printing', 'printed', 'failed', 'cancelled']).optional(), branchId: uuid.optional() }),
  responses: [{ status: 200, description: 'Print jobs with their item counts.', schema: z.object({ rows: z.array(record) }) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<{ status?: string; branchId?: string }>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    if (q.status) { params.push(q.status); clauses.push(`j.status = $${params.length}`); }
    if (q.branchId) { params.push(q.branchId); clauses.push(`j.branch_id = $${params.length}`); }
    return { rows: await tx.query(
      `select j.*, t.name as template_name, b.name as branch_name,
              (select count(*) from tag_print_job_item i where i.tag_print_job_id = j.id) as item_count
         from tag_print_job j join tag_template t on t.id = j.tag_template_id join branch b on b.id = j.branch_id
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''} order by j.queued_at desc limit 100`, params) };
  }),
});

defineRoute({
  method: 'post', path: '/api/tagging/queue', module: 'tagging',
  summary: 'Queue pieces for printing',
  permission: 'tagging.create',
  body: z.object({
    templateId: uuid, branchId: uuid,
    pieceIds: z.array(uuid).min(1), copies: z.number().int().min(1).default(1),
  }),
  responses: [{ status: 201, description: 'Queued.', schema: record }],
  changelog: seed,
  handler: async (req, res) => {
    const row = await transaction(async (tx) => {
      const job = await repo(tx, 'tag_print_job').insert({
        tag_template_id: req.body.templateId, branch_id: req.body.branchId,
        piece_count: req.body.pieceIds.length, queued_by: tx.context.userId,
      });
      await repo(tx, 'tag_print_job_item').insertMany(
        req.body.pieceIds.map((pieceId: string) => ({
          tag_print_job_id: (job as { id: string }).id, piece_id: pieceId, copies: req.body.copies,
        })));
      return job;
    });
    res.status(201).json(row);
  },
});
