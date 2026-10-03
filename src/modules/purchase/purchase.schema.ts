/**
 * Module 5.1 — Purchase.
 *
 *     Purchase Order ──► Goods Inward ──► Supplier Bill
 *      (optional; what    (weighed; the     (the supplier's GST
 *       we asked for)      terms agreed;     invoice for one or
 *                          stock goes up,    more inwards; GST
 *                          supplier owed)    input is claimed)
 *
 * The inward carries the commercial terms because that is when a jewellery
 * purchase is settled: the weight on our scale and the supplier's rate or
 * touch. The bill often comes days later and only adds the GST. When the bill
 * comes with the goods, both are saved from one screen.
 *
 * A supplier is owed in rupees, in fine gold, or both. Rupees sit on Sundry
 * Creditors (2000); fine metal on Supplier Metal Payable (2010), in grams on
 * the metal ledger. Supplier settlement pays rupees, gives metal back, or fixes
 * a rate to turn metal owed into rupees.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';
import {
  documentHeaderColumns,
  documentLineChecks,
  documentLineColumns,
} from '../../core/db/schema/document.js';

/** How the metal on a line is paid for: in rupees at a rate, or owed back as fine metal at a touch. */
export const METAL_BASIS = ['rupee', 'fine'] as const;

export const purchaseOrderTable = defineTable({
  name: 'purchase_order',
  module: 'purchase',
  comment: 'What we asked the supplier for. Affects nothing until goods arrive.',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'supplier' }),
    expected_date: col.date(),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [{ columns: ['supplier_id', 'doc_date'] }, { columns: ['status', 'doc_date'] }, { columns: ['branch_id', 'doc_date'] }, { columns: ['id'] }],
});

export const purchaseOrderLineTable = defineTable({
  name: 'purchase_order_line',
  module: 'purchase',
  columns: {
    ...documentLineColumns('purchase_order'),
    /** Rolled up from inwards, so an order shows what is still to come. */
    received_quantity: col.numeric(14, 3, { notNull: true, default: '0' }),
    received_weight: col.weight({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['purchase_order_id', 'line_number'] }],
  checks: documentLineChecks(),
});

export const goodsReceiptTable = defineTable({
  name: 'goods_receipt',
  module: 'purchase',
  comment: 'Goods Inward: what arrived and on what terms. Posting raises stock and what we owe the supplier.',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'supplier' }),
    purchase_order_id: col.fk('purchase_order'),
    location_id: col.fk('stock_location', { notNull: true }),
    /** The supplier bill this inward was billed on. Null = not billed yet (goods on approval or bill awaited). */
    purchase_invoice_id: col.fk('purchase_invoice'),
    /** A direct purchase: goods and the supplier's bill entered as one. It is cancelled as one and its bill cannot be cancelled alone. */
    is_direct: col.bool({ notNull: true, default: 'false' }),
    /** Fine metal owed to the supplier on this inward, per metal: [{ metalId, fine }]. */
    fine_owed: col.jsonb({ notNull: true, default: "'[]'::jsonb" }),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [
    { columns: ['supplier_id', 'doc_date'] },
    { columns: ['status', 'doc_date'] },
    { columns: ['purchase_order_id'] },
    { columns: ['id'] },
    { name: 'ix_goods_receipt_unbilled', columns: ['supplier_id'], where: "purchase_invoice_id is null and status = 'posted'" },
  ],
});

export const goodsReceiptLineTable = defineTable({
  name: 'goods_receipt_line',
  module: 'purchase',
  columns: {
    ...documentLineColumns('goods_receipt'),
    purchase_order_line_id: col.fk('purchase_order_line'),
    other_weight: col.weight({ notNull: true, default: '0' }),
    /** What the supplier's challan said, against what our scale said. */
    declared_weight: col.weight(),
    metal_basis: col.enum(METAL_BASIS, { notNull: true, default: "'rupee'" }),
    /** Fine basis: the percentage of net weight owed back as pure metal (fineness plus the supplier's wastage). */
    touch_percent: col.purity(),
    fine_owed: col.weight({ notNull: true, default: '0' }),
    /** What this line adds to stock value: metal at the rate, making and stones. */
    cost_value: col.money({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['goods_receipt_id', 'line_number'] }],
  checks: documentLineChecks(),
});

export const purchaseInvoiceTable = defineTable({
  name: 'purchase_invoice',
  module: 'purchase',
  comment: 'Supplier Bill: the supplier\'s GST invoice for one or more inwards.',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'supplier' }),
    supplier_invoice_number: col.text({ notNull: true }),
    supplier_invoice_date: col.date({ notNull: true }),
    due_date: col.date(),
  },
  uniques: [{ columns: ['doc_number'] }, { columns: ['supplier_id', 'supplier_invoice_number'] }],
  indexes: [{ columns: ['supplier_id', 'doc_date'] }, { columns: ['status', 'due_date'] }, { columns: ['id'] }],
});

export const purchaseReturnTable = defineTable({
  name: 'purchase_return',
  module: 'purchase',
  comment: 'Goods sent back to the supplier. Reduces what we owe them, in rupees or fine metal as they were bought.',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'supplier' }),
    goods_receipt_id: col.fk('goods_receipt'),
    reason: col.enum(['quality', 'wrong_item', 'excess', 'damaged', 'on_approval', 'other'], { notNull: true, default: "'other'" }),
    fine_owed: col.jsonb({ notNull: true, default: "'[]'::jsonb" }),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [{ columns: ['supplier_id', 'doc_date'] }, { columns: ['id'] }],
});

export const purchaseReturnLineTable = defineTable({
  name: 'purchase_return_line',
  module: 'purchase',
  columns: {
    ...documentLineColumns('purchase_return'),
    goods_receipt_line_id: col.fk('goods_receipt_line'),
    metal_basis: col.enum(METAL_BASIS, { notNull: true, default: "'rupee'" }),
    fine_owed: col.weight({ notNull: true, default: '0' }),
    cost_value: col.money({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['purchase_return_id', 'line_number'] }],
  checks: documentLineChecks(),
});

/**
 * Paying a supplier. `payment` pays rupees; `metal` gives fine metal back from
 * a lot in stock; `rate_fix` converts fine metal owed into rupees at an agreed rate.
 */
export const supplierSettlementTable = defineTable({
  name: 'supplier_settlement',
  module: 'purchase',
  columns: {
    doc_number: col.text({ notNull: true }),
    doc_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    supplier_id: col.fk('party', { notNull: true }),
    kind: col.enum(['payment', 'metal', 'rate_fix'], { notNull: true }),
    payment_method_id: col.fk('payment_method'),
    amount: col.money({ notNull: true, default: '0' }),
    reference: col.text(),
    metal_id: col.fk('metal'),
    /** metal: the lot the metal is taken from. */
    item_id: col.fk('item'),
    purity_id: col.fk('purity'),
    location_id: col.fk('stock_location'),
    net_weight: col.weight({ notNull: true, default: '0' }),
    fine_weight: col.weight({ notNull: true, default: '0' }),
    rate_per_gram: col.money({ comment: 'rate_fix: rupees per fine gram agreed.' }),
    notes: col.text(),
    voucher_id: col.fk('voucher'),
    status: col.enum(['posted', 'cancelled'], { notNull: true, default: "'posted'" }),
    cancelled_at: col.timestamptz(),
    cancel_reason: col.text(),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [{ columns: ['supplier_id', 'doc_date'] }, { columns: ['id'] }],
});
