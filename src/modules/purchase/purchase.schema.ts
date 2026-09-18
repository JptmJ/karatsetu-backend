/**
 * Module 5.1 — Purchase.
 *
 * The flow, and why it is three documents rather than one:
 *
 *     Purchase Order ──► Goods Receipt ──► Purchase Invoice
 *      (what we asked    (what actually    (what we agreed
 *       for; no effect)   arrived; stock    to pay; ledger
 *                         goes up here)     moves here)
 *
 * Separating them matters because in this trade they genuinely disagree. You
 * order 500g, 487g arrives, and the bill comes a week later at a rate that was
 * fixed on the day of delivery. Collapsing the three into one document means
 * that difference has nowhere to live.
 *
 * A small shop that does not care can still create an invoice directly — the
 * order and receipt are optional links, not required steps.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';
import {
  documentHeaderColumns,
  documentLineChecks,
  documentLineColumns,
} from '../../core/db/schema/document.js';

export const purchaseOrderTable = defineTable({
  name: 'purchase_order',
  module: 'purchase',
  comment: 'What we asked the supplier for. Affects nothing until goods arrive.',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'supplier' }),
    expected_date: col.date(),
    /** Fixed rate agreed up front, or priced at whatever the rate is on delivery. */
    rate_basis: col.enum(['fixed', 'on_delivery'], { notNull: true, default: "'fixed'" }),
    fulfilled_weight: col.weight({ notNull: true, default: '0', comment: 'Rolled up from receipts.' }),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [
    { columns: ['supplier_id', 'doc_date'] },
    { columns: ['status', 'doc_date'] },
    { columns: ['branch_id', 'doc_date'] },
  ],
});

export const purchaseOrderLineTable = defineTable({
  name: 'purchase_order_line',
  module: 'purchase',
  columns: {
    ...documentLineColumns('purchase_order'),
    received_quantity: col.numeric(14, 3, { notNull: true, default: '0' }),
    received_weight: col.weight({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['purchase_order_id', 'line_number'] }],
  checks: documentLineChecks(),
});

export const goodsReceiptTable = defineTable({
  name: 'goods_receipt',
  module: 'purchase',
  comment: 'What physically arrived. This is the document that raises stock.',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'supplier' }),
    purchase_order_id: col.fk('purchase_order'),
    received_at: col.timestamptz({ notNull: true, default: 'now()' }),
    /** Weighed on arrival by whom — disputes about 2 grams are common. */
    weighed_by: col.uuid(),
    transport_details: col.text(),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [
    { columns: ['supplier_id', 'doc_date'] },
    { columns: ['purchase_order_id'] },
    { columns: ['status', 'doc_date'] },
  ],
});

export const goodsReceiptLineTable = defineTable({
  name: 'goods_receipt_line',
  module: 'purchase',
  columns: {
    ...documentLineColumns('goods_receipt'),
    purchase_order_line_id: col.fk('purchase_order_line'),
    /** What the supplier claimed versus what the scale said. */
    declared_weight: col.weight({ notNull: true, default: '0' }),
    weight_variance: col.weight({ notNull: true, default: '0' }),
    /** Purity as tested on arrival, which may differ from what was ordered. */
    tested_purity_percent: col.purity(),
  },
  uniques: [{ columns: ['goods_receipt_id', 'line_number'] }],
  checks: documentLineChecks(),
});

export const purchaseInvoiceTable = defineTable({
  name: 'purchase_invoice',
  module: 'purchase',
  comment: 'What we owe the supplier. This is the document that moves the ledger.',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'supplier' }),
    goods_receipt_id: col.fk('goods_receipt'),
    purchase_order_id: col.fk('purchase_order'),
    /** The supplier's own invoice number and date, needed for GST matching. */
    supplier_invoice_number: col.text(),
    supplier_invoice_date: col.date(),
    due_date: col.date(),
    /** Set when this invoice raises stock directly, with no separate receipt. */
    raises_stock: col.bool({ notNull: true, default: 'false' }),
    paid_amount: col.money({ notNull: true, default: '0' }),
    /** Metal paid back in kind rather than cash — very common with bullion dealers. */
    metal_settled_weight: col.weight({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [
    { columns: ['supplier_id', 'doc_date'] },
    { columns: ['status', 'due_date'] },
    { columns: ['goods_receipt_id'] },
  ],
});

export const purchaseInvoiceLineTable = defineTable({
  name: 'purchase_invoice_line',
  module: 'purchase',
  columns: {
    ...documentLineColumns('purchase_invoice'),
    goods_receipt_line_id: col.fk('goods_receipt_line'),
  },
  uniques: [{ columns: ['purchase_invoice_id', 'line_number'] }],
  checks: documentLineChecks(),
});

/**
 * Return to Vendor (Module 5.1). Kept separate from a customer return because
 * the accounting runs the other way — this one credits the supplier.
 */
export const purchaseReturnTable = defineTable({
  name: 'purchase_return',
  module: 'purchase',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'supplier' }),
    purchase_invoice_id: col.fk('purchase_invoice'),
    goods_receipt_id: col.fk('goods_receipt'),
    reason: col.enum(['quality', 'wrong_item', 'excess', 'damaged', 'other'], {
      notNull: true,
      default: "'other'",
    }),
    /** The supplier's credit note against this return. */
    credit_note_number: col.text(),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [{ columns: ['supplier_id', 'doc_date'] }, { columns: ['purchase_invoice_id'] }],
});

export const purchaseReturnLineTable = defineTable({
  name: 'purchase_return_line',
  module: 'purchase',
  columns: {
    ...documentLineColumns('purchase_return'),
    purchase_invoice_line_id: col.fk('purchase_invoice_line'),
  },
  uniques: [{ columns: ['purchase_return_id', 'line_number'] }],
  checks: documentLineChecks(),
});
