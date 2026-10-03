/**
 * Purchase: orders, goods inward (stock in), supplier bills (GST), returns to
 * the supplier, and settling with suppliers in rupees or fine metal.
 */
import { z } from 'zod';
import { defineRoute, queryOf } from '../core/http/route-registry.js';
import { transaction, type Tx } from '../core/db/client.js';
import { param } from '../core/http/middleware.js';
import {
  cancelBill, cancelInward, cancelSettlement, closeOrder, createBill, createInward, createOrder, createReturn, createSettlement,
  inwardDetail, supplierBalance,
} from '../modules/purchase/purchase.service.js';
import { closeLot } from '../modules/tagging/tagging.service.js';
import { decodeCursor, encodeCursor } from './crud.js';
import { errorEnvelope, idParam, isoDate, money, record, uuid, weight } from './schemas.js';

const DAY = '2026-09-30';
const added = (note: string) => [{ date: DAY, kind: 'added' as const, note }];
const P = '/api/purchase';
const cursorPage = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const page = z.object({ rows: z.array(record), nextCursor: z.string().nullable() });
const reason = z.object({ reason: z.string().trim().min(3).max(500) });

/** Newest first by id (ids are time-ordered), one extra row to know if there is more. */
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

/** Common list filters: supplier, status, branch (always the signed-in branch), search on the document number. */
function filters(tx: Tx, q: Record<string, string | number | undefined>, alias: string) {
  const clauses = [`${alias}.branch_id = $1`];
  const params: unknown[] = [tx.context.branchId];
  if (q.supplierId) { params.push(q.supplierId); clauses.push(`${alias}.supplier_id = $${params.length}`); }
  if (q.status) { params.push(q.status); clauses.push(`${alias}.status = $${params.length}`); }
  if (q.search) { params.push(`%${q.search}%`); clauses.push(`${alias}.doc_number ilike $${params.length}`); }
  return { clauses, params };
}

/* ------------------------------------------------------------------ orders */

defineRoute({
  method: 'get', path: `${P}/orders`, module: 'purchase', summary: 'Purchase orders', permission: 'pos.purchase.view',
  query: z.object({ supplierId: uuid.optional(), status: z.enum(['confirmed', 'closed', 'cancelled']).optional(), search: z.string().optional() }).merge(cursorPage),
  responses: [{ status: 200, description: 'Newest first, with what has arrived so far.', schema: page }],
  changelog: added('Purchase orders.'),
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const { clauses, params } = filters(tx, q, 'po');
    return newestFirst(tx, (where, limit) =>
      `select po.id, po.doc_number, po.doc_date, po.expected_date, po.status, po.total_gross_weight, p.name as supplier_name,
              (select coalesce(sum(received_weight), 0) from purchase_order_line where purchase_order_id = po.id) as received_weight
         from purchase_order po join party p on p.id = po.supplier_id ${where} order by po.id desc limit ${limit}`, clauses, params, q, 'po');
  }),
});

defineRoute({
  method: 'get', path: `${P}/orders/:id`, module: 'purchase', summary: 'One purchase order with its lines', permission: 'pos.purchase.view', params: idParam,
  responses: [{ status: 200, description: 'The order.', schema: record }],
  changelog: added('Order detail.'),
  handler: async (req) => transaction(async (tx) => {
    const id = param(req, 'id');
    const [order, lines] = await Promise.all([
      tx.one(`select po.*, p.name as supplier_name from purchase_order po join party p on p.id = po.supplier_id where po.id = $1`, [id]),
      tx.query(`select l.*, i.name as item_name, i.tracking, pu.code as purity_code from purchase_order_line l join item i on i.id = l.item_id
                  join purity pu on pu.id = l.purity_id where l.purchase_order_id = $1 order by l.line_number`, [id]),
    ]);
    return { ...order, lines };
  }),
});

defineRoute({
  method: 'post', path: `${P}/orders`, module: 'purchase', summary: 'Place a purchase order', permission: 'pos.purchase.create',
  description: 'What was asked of the supplier. Affects nothing until goods arrive; inwards against it show what is still due.',
  body: z.object({
    supplierId: uuid, docDate: isoDate.optional(), expectedDate: isoDate.optional(), notes: z.string().max(500).optional(),
    lines: z.array(z.object({ itemId: uuid, purityId: uuid, quantity: z.number().int().min(1).optional(), grossWeight: weight,
      ratePerGram: money.optional(), notes: z.string().max(200).optional() })).min(1).max(200),
  }),
  responses: [{ status: 201, description: 'The order.', schema: record }],
  changelog: added('Place an order.'),
  handler: async (req, res) => { res.status(201).json(await transaction((tx) => createOrder(tx, req.body))); },
});

defineRoute({
  method: 'post', path: `${P}/orders/:id/close`, module: 'purchase', summary: 'Close or cancel an order',
  description: '`status: closed` when no more is coming; `cancelled` only while nothing has arrived.',
  permission: 'pos.purchase.create', params: idParam, body: reason.extend({ status: z.enum(['closed', 'cancelled']) }),
  responses: [{ status: 200, description: 'The order.', schema: record }, { status: 422, description: 'Not open, or goods already received.', schema: errorEnvelope }],
  changelog: added('Close an order.'),
  handler: async (req) => transaction((tx) => closeOrder(tx, param(req, 'id'), req.body.status, req.body.reason)),
});

/* ------------------------------------------------------------------ inward */

const inwardLine = z.object({
  itemId: uuid, purityId: uuid, pieces: z.number().int().min(1).optional(),
  grossWeight: weight, stoneWeight: weight.optional(), otherWeight: weight.optional(), declaredWeight: weight.optional(),
  metalBasis: z.enum(['rupee', 'fine']),
  ratePerGram: money.optional().describe('Rupee basis: the agreed rate. Fine basis: the stock value per gram (defaults to today’s buying rate).'),
  touchPercent: z.string().regex(/^\d+(\.\d+)?$/).optional().describe('Fine basis: % of net weight owed back as pure metal.'),
  makingBasis: z.enum(['per_gram', 'flat', 'percent']).optional(), makingRate: money.optional(), stoneAmount: money.optional(),
  purchaseOrderLineId: uuid.optional(),
});
const bill = z.object({ supplierInvoiceNumber: z.string().trim().max(60).optional().describe('Blank when the seller gave no numbered bill: our purchase number is used.'), supplierInvoiceDate: isoDate, dueDate: isoDate.optional(), gstAmount: money.optional() });

defineRoute({
  method: 'get', path: `${P}/inwards`, module: 'purchase', summary: 'Goods inwards and direct purchases', permission: 'pos.purchase.view',
  query: z.object({ supplierId: uuid.optional(), status: z.enum(['posted', 'cancelled']).optional(),
    search: z.string().optional().describe('Inward number or the supplier’s bill number.'),
    unbilled: z.enum(['true', 'false']).optional(),
    direct: z.enum(['true', 'false']).optional().describe('true = direct purchases only; false = goods inwards only.') }).merge(cursorPage),
  responses: [{ status: 200, description: 'Newest first.', schema: page }],
  changelog: [...added('Inward register.'), { date: '2026-09-30', kind: 'changed', note: 'direct filter; search also finds the supplier’s bill number.' }],
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const { clauses, params } = filters(tx, q, 'gr');
    if (q.search) clauses[clauses.length - 1] = `(gr.doc_number ilike $${params.length} or pi.supplier_invoice_number ilike $${params.length})`;
    if (q.unbilled === 'true') clauses.push(`gr.purchase_invoice_id is null and gr.status = 'posted'`);
    if (q.direct) clauses.push(q.direct === 'true' ? 'gr.is_direct' : 'not gr.is_direct');
    return newestFirst(tx, (where, limit) =>
      `select gr.id, gr.doc_number, gr.doc_date, gr.status, gr.reference_number, gr.total_gross_weight, gr.total_net_weight, gr.taxable_amount,
              gr.fine_owed, gr.purchase_invoice_id, gr.is_direct, pi.doc_number as bill_number, pi.supplier_invoice_number, pi.supplier_invoice_date,
              pi.cgst_amount + pi.sgst_amount + pi.igst_amount as gst_amount, pi.total_amount as bill_total, p.name as supplier_name, l.name as location_name,
              (select count(*)::int from goods_receipt_line where goods_receipt_id = gr.id) as line_count
         from goods_receipt gr join party p on p.id = gr.supplier_id join stock_location l on l.id = gr.location_id
         left join purchase_invoice pi on pi.id = gr.purchase_invoice_id ${where} order by gr.id desc limit ${limit}`, clauses, params, q, 'gr');
  }),
});

defineRoute({
  method: 'get', path: `${P}/inwards/:id`, module: 'purchase', summary: 'One inward with its lines and tagging progress', permission: 'pos.purchase.view',
  params: idParam, responses: [{ status: 200, description: 'The inward.', schema: record }],
  changelog: added('Inward detail.'),
  handler: async (req) => transaction((tx) => inwardDetail(tx, param(req, 'id'))),
});

defineRoute({
  method: 'post', path: `${P}/inwards`, module: 'purchase', summary: 'Receive goods (and the bill, if it came with them)',
  description: [
    'Posts at once: stock goes up at the location, the supplier is owed rupees and/or fine metal, and pieces wait in Tagging as a lot.',
    'Rupee basis: metal at the rate. Fine basis: fine metal owed = net × touch %; making and stones in rupees.',
    'Send `bill` when the supplier bill came with the goods; otherwise enter it later.',
    '`direct: true` is a direct purchase: the bill is required, and goods and bill are one record — cancelled together, never separately.',
  ].join(' '),
  permission: 'pos.purchase.create',
  body: z.object({
    supplierId: uuid, docDate: isoDate.optional(), locationId: uuid, purchaseOrderId: uuid.optional(),
    referenceNumber: z.string().trim().max(60).optional().describe('The supplier’s challan number.'), notes: z.string().max(500).optional(),
    lines: z.array(inwardLine).min(1).max(200), bill: bill.optional(), direct: z.boolean().optional(),
  }),
  responses: [
    { status: 201, description: 'The inward, and the bill if one was sent.', schema: record },
    { status: 422, description: 'A line is invalid (named by number), a rate is missing, or the bill number is already entered.', schema: errorEnvelope },
  ],
  changelog: added('Goods inward with optional bill.'),
  handler: async (req, res) => { res.status(201).json(await transaction((tx) => createInward(tx, req.body))); },
});

defineRoute({
  method: 'post', path: `${P}/inwards/:id/cancel`, module: 'purchase', summary: 'Cancel an inward or a direct purchase entered by mistake',
  description: 'Only while nothing from it is tagged, returned or already sold. An inward must not be billed; a direct purchase cancels its bill with it.',
  permission: 'pos.purchase.post', params: idParam, body: reason,
  responses: [{ status: 200, description: 'Cancelled.', schema: record }, { status: 422, description: 'Billed, tagged, returned or sold.', schema: errorEnvelope }],
  changelog: added('Cancel an inward.'),
  handler: async (req) => transaction((tx) => cancelInward(tx, param(req, 'id'), req.body.reason)),
});

defineRoute({
  method: 'post', path: `${P}/lots/:id/close`, module: 'tagging', summary: 'Close a purchase lot in Tagging',
  description: 'Whatever was not tagged (a weighing difference, a missing piece) leaves stock on one tagging-difference adjustment.',
  permission: 'stock.adjustment.post', params: idParam, body: z.object({ note: z.string().trim().min(3).max(500) }),
  responses: [{ status: 200, description: 'Closed.', schema: record }],
  changelog: added('Close a lot.'),
  handler: async (req) => transaction((tx) => closeLot(tx, param(req, 'id'), req.body.note)),
});

defineRoute({
  method: 'get', path: `${P}/lots`, module: 'tagging', summary: 'Purchase lots waiting in Tagging', permission: 'tagging.view',
  responses: [{ status: 200, description: 'Open lots at this branch, oldest first.', schema: z.object({ rows: z.array(record) }) }],
  changelog: added('Awaiting-tag lots.'),
  handler: async () => transaction(async (tx) => ({ rows: await tx.query(
    `select t.*, gr.doc_number, gr.doc_date, i.name as item_name, pu.code as purity_code, p.name as supplier_name, l.name as location_name
       from tagging_lot t join goods_receipt_line gl on gl.id = t.goods_receipt_line_id join goods_receipt gr on gr.id = gl.goods_receipt_id
       join item i on i.id = t.item_id join purity pu on pu.id = t.purity_id join party p on p.id = t.supplier_id join stock_location l on l.id = t.location_id
      where t.status = 'open' and t.branch_id = $1 order by gr.doc_date, gr.doc_number`, [tx.context.branchId]) })),
});

/* -------------------------------------------------------------------- bills */

defineRoute({
  method: 'get', path: `${P}/bills`, module: 'purchase', summary: 'Supplier bills', permission: 'pos.purchase.view',
  query: z.object({ supplierId: uuid.optional(), status: z.enum(['posted', 'cancelled']).optional(), search: z.string().optional() }).merge(cursorPage),
  responses: [{ status: 200, description: 'Newest first.', schema: page }],
  changelog: added('Bill register.'),
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const { clauses, params } = filters(tx, q, 'pi');
    if (q.search) clauses[clauses.length - 1] = `(pi.doc_number ilike $${params.length} or pi.supplier_invoice_number ilike $${params.length})`;
    return newestFirst(tx, (where, limit) =>
      `select pi.id, pi.doc_number, pi.doc_date, pi.status, pi.supplier_invoice_number, pi.supplier_invoice_date, pi.due_date,
              pi.taxable_amount, pi.cgst_amount + pi.sgst_amount + pi.igst_amount as gst_amount, pi.total_amount, p.name as supplier_name,
              (select json_agg(doc_number order by doc_number) from goods_receipt where purchase_invoice_id = pi.id) as inwards
         from purchase_invoice pi join party p on p.id = pi.supplier_id ${where} order by pi.id desc limit ${limit}`, clauses, params, q, 'pi');
  }),
});

defineRoute({
  method: 'post', path: `${P}/bills`, module: 'purchase', summary: 'Enter a supplier bill for received goods',
  description: 'Covers one or more unbilled inwards of the supplier. GST is worked out from each line’s HSN; send `gstAmount` to match the printed bill exactly.',
  permission: 'pos.purchase.post',
  body: bill.extend({ supplierId: uuid, inwardIds: z.array(uuid).min(1).max(100), docDate: isoDate.optional() }),
  responses: [{ status: 201, description: 'The bill.', schema: record }, { status: 422, description: 'Already billed, other supplier, or bill number already entered.', schema: errorEnvelope }],
  changelog: added('Supplier bill.'),
  handler: async (req, res) => { res.status(201).json(await transaction((tx) => createBill(tx, req.body))); },
});

defineRoute({
  method: 'post', path: `${P}/bills/:id/cancel`, module: 'purchase', summary: 'Cancel a supplier bill',
  description: 'The GST entry reverses and its inwards become unbilled again.',
  permission: 'pos.purchase.post', params: idParam, body: reason,
  responses: [{ status: 200, description: 'Cancelled.', schema: record }],
  changelog: added('Cancel a bill.'),
  handler: async (req) => transaction((tx) => cancelBill(tx, param(req, 'id'), req.body.reason)),
});

/* ------------------------------------------------------------------ returns */

defineRoute({
  method: 'get', path: `${P}/returns`, module: 'purchase', summary: 'Returns to suppliers', permission: 'pos.purchase.view',
  query: z.object({ supplierId: uuid.optional(), search: z.string().optional() }).merge(cursorPage),
  responses: [{ status: 200, description: 'Newest first.', schema: page }],
  changelog: added('Return register.'),
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const { clauses, params } = filters(tx, q, 'r');
    return newestFirst(tx, (where, limit) =>
      `select r.id, r.doc_number, r.doc_date, r.status, r.reason, r.total_amount, r.total_net_weight, r.fine_owed,
              p.name as supplier_name, gr.doc_number as inward_number
         from purchase_return r join party p on p.id = r.supplier_id left join goods_receipt gr on gr.id = r.goods_receipt_id
         ${where} order by r.id desc limit ${limit}`, clauses, params, q, 'r');
  }),
});

defineRoute({
  method: 'post', path: `${P}/returns`, module: 'purchase', summary: 'Send goods back to the supplier',
  description: 'Against one inward: tagged pieces (scanned), untagged pieces still in Tagging, or lot weight. The supplier’s rupees, fine metal and (if billed) GST come down in proportion.',
  permission: 'pos.purchase.create',
  body: z.object({
    goodsReceiptId: uuid, reason: z.enum(['quality', 'wrong_item', 'excess', 'damaged', 'other']).optional(), notes: z.string().max(500).optional(),
    docDate: isoDate.optional(),
    pieceIds: z.array(uuid).max(500).optional().describe('Tagged pieces as scanned; each is matched to its inward line.'),
    lines: z.array(z.object({ goodsReceiptLineId: uuid, pieces: z.number().int().min(1).optional(),
      grossWeight: weight.optional(), netWeight: weight.optional() })).max(200).optional(),
  }),
  responses: [{ status: 201, description: 'The return.', schema: record }, { status: 422, description: 'Piece not in stock, weight above what arrived.', schema: errorEnvelope }],
  changelog: added('Return to supplier.'),
  handler: async (req, res) => { res.status(201).json(await transaction((tx) => createReturn(tx, req.body))); },
});

/* --------------------------------------------------------------- suppliers */

defineRoute({
  method: 'get', path: `${P}/suppliers/:id/balance`, module: 'purchase', summary: 'What a supplier is owed',
  description: 'Rupees on Sundry Creditors, fine metal per metal (with its average carrying rate), and unbilled inwards.',
  permission: 'pos.purchase.view', params: idParam,
  responses: [{ status: 200, description: 'The balance.', schema: record }],
  changelog: added('Supplier balance.'),
  handler: async (req) => transaction(async (tx) => {
    const id = param(req, 'id');
    const [balance, unbilled] = await Promise.all([
      supplierBalance(tx, id),
      tx.query(`select id, doc_number, doc_date, taxable_amount from goods_receipt where supplier_id = $1 and status = 'posted' and purchase_invoice_id is null order by doc_date`, [id]),
    ]);
    return { ...balance, unbilled };
  }),
});

defineRoute({
  method: 'get', path: `${P}/payables`, module: 'purchase', summary: 'Every supplier we owe',
  description: 'Rupees and fine metal per supplier, largest first.',
  permission: 'pos.purchase.view',
  responses: [{ status: 200, description: 'Suppliers with a balance.', schema: z.object({ rows: z.array(record) }) }],
  changelog: added('Payables.'),
  handler: async () => transaction(async (tx) => ({ rows: await tx.query(
    `with rupees as (select e.party_id, sum(e.credit - e.debit) as rupees from ledger_entry e join account a on a.id = e.account_id
                      where a.code = '2000' and e.party_id is not null group by e.party_id),
          metal as (select x.party_id, json_agg(json_build_object('metal', m.name, 'fine', x.fine::text)) as metals
                      from (select e.party_id, e.metal_id, sum(e.weight_in - e.weight_out) as fine from metal_ledger_entry e join account a on a.id = e.account_id
                             where a.code = '2010' and e.party_id is not null group by e.party_id, e.metal_id having sum(e.weight_in - e.weight_out) <> 0) x
                      join metal m on m.id = x.metal_id group by x.party_id)
     select p.id, p.name, p.code, coalesce(r.rupees, 0)::text as rupees, coalesce(mt.metals, '[]') as metals
       from party p left join rupees r on r.party_id = p.id left join metal mt on mt.party_id = p.id
      where p.is_supplier and (coalesce(r.rupees, 0) <> 0 or mt.metals is not null)
      order by coalesce(r.rupees, 0) desc, p.name`) })),
});

defineRoute({
  method: 'get', path: `${P}/settlements`, module: 'purchase', summary: 'Supplier payments', permission: 'pos.purchase.view',
  query: z.object({ supplierId: uuid.optional() }).merge(cursorPage),
  responses: [{ status: 200, description: 'Newest first.', schema: page }],
  changelog: added('Payment register.'),
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const { clauses, params } = filters(tx, q, 's');
    return newestFirst(tx, (where, limit) =>
      `select s.*, p.name as supplier_name, pm.name as method_name, m.name as metal_name
         from supplier_settlement s join party p on p.id = s.supplier_id left join payment_method pm on pm.id = s.payment_method_id
         left join metal m on m.id = s.metal_id ${where} order by s.id desc limit ${limit}`, clauses, params, q, 's');
  }),
});

defineRoute({
  method: 'get', path: `${P}/settlements/:id`, module: 'purchase', summary: 'One supplier payment, as it prints', permission: 'pos.purchase.view', params: idParam,
  responses: [{ status: 200, description: 'The payment voucher with the shop and the supplier.', schema: record }],
  changelog: added('Payment voucher detail for printing.'),
  handler: async (req) => transaction((tx) => tx.one(
    `select s.*, p.name as supplier_name, p.phone as supplier_phone, p.gstin as supplier_gstin, p.address_line1 as supplier_address, p.city as supplier_city,
            pm.name as method_name, m.name as metal_name, i.name as item_name, pu.code as purity_code, l.name as location_name,
            b.name as branch_name, b.gstin as branch_gstin, b.address_line1 as branch_address, b.city as branch_city, b.phone as branch_phone
       from supplier_settlement s join party p on p.id = s.supplier_id join branch b on b.id = s.branch_id
       left join payment_method pm on pm.id = s.payment_method_id left join metal m on m.id = s.metal_id
       left join item i on i.id = s.item_id left join purity pu on pu.id = s.purity_id left join stock_location l on l.id = s.location_id
      where s.id = $1`, [param(req, 'id')])),
});

defineRoute({
  method: 'post', path: `${P}/settlements`, module: 'purchase', summary: 'Pay a supplier in rupees or metal',
  description: [
    '`payment`: rupees by a payment method from Masters.',
    '`metal`: fine metal given from a lot in stock (item, purity, location, net weight).',
    '`rate_fix`: fine metal owed converted to rupees at an agreed rate per fine gram.',
    'Metal cannot exceed what is owed. The difference between the carrying value and the settlement is booked as metal gain or loss.',
  ].join(' '),
  permission: 'pos.purchase.post',
  body: z.object({
    supplierId: uuid, kind: z.enum(['payment', 'metal', 'rate_fix']), docDate: isoDate.optional(),
    amount: money.optional(), paymentMethodId: uuid.optional(), reference: z.string().max(80).optional(),
    itemId: uuid.optional(), purityId: uuid.optional(), locationId: uuid.optional(), netWeight: weight.optional(),
    metalId: uuid.optional(), fineWeight: weight.optional(), ratePerGram: money.optional(), notes: z.string().max(500).optional(),
  }),
  responses: [{ status: 201, description: 'The settlement.', schema: record }, { status: 422, description: 'More metal than owed, or a payment limit.', schema: errorEnvelope }],
  changelog: added('Supplier settlement.'),
  handler: async (req, res) => { res.status(201).json(await transaction((tx) => createSettlement(tx, req.body))); },
});

defineRoute({
  method: 'post', path: `${P}/settlements/:id/cancel`, module: 'purchase', summary: 'Cancel a supplier payment',
  permission: 'pos.purchase.post', params: idParam, body: reason,
  responses: [{ status: 200, description: 'Cancelled.', schema: record }],
  changelog: added('Cancel a payment.'),
  handler: async (req) => transaction((tx) => cancelSettlement(tx, param(req, 'id'), req.body.reason)),
});
