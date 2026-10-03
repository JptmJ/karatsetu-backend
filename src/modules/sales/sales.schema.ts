/**
 * Module 5.2 — Sales.
 *
 * A counter bill is priced by the shared pricing engine (rates, making and
 * wastage rules, GST from Masters), settled by any mix of tenders, and posted
 * the moment it is saved: stock out at cost, the books, and any balance left
 * on the customer. A mistake is corrected by a return or a cancellation.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';
import {
  documentHeaderColumns,
  documentLineChecks,
  documentLineColumns,
} from '../../core/db/schema/document.js';

export const SALE_CHANNELS = ['counter', 'wholesale', 'export', 'online'] as const;

export const salesInvoiceTable = defineTable({
  name: 'sales_invoice',
  module: 'sales',
  comment: 'Module 5.2 — counter, wholesale and export billing share this table.',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'customer' }),
    channel: col.enum(SALE_CHANNELS, { notNull: true, default: "'counter'" }),
    salesperson_id: col.fk('app_user', { comment: 'Drives staff-wise sales reports (Module 11.4).' }),
    /** Who allowed a discount above the counter limit. */
    discount_approved_by: col.fk('app_user'),

    /** GST place of supply — decides CGST+SGST versus IGST. */
    place_of_supply_code: col.text(),
    is_export: col.bool({ notNull: true, default: 'false' }),
    export_currency: col.text(),
    export_rate: col.rate(),

    /** e-Invoice / IRN (Module 5.2). Filled in after the government portal responds. */
    irn: col.text(),
    irn_status: col.enum(['not_required', 'pending', 'generated', 'cancelled', 'failed'], {
      notNull: true,
      default: "'not_required'",
    }),
    irn_generated_at: col.timestamptz(),
    ack_number: col.text(),
    qr_code_data: col.text(),

    /** Settlement. paid_amount is the tenders; balance_amount is what the customer still owes. */
    paid_amount: col.money({ notNull: true, default: '0' }),
    old_gold_amount: col.money({ notNull: true, default: '0', comment: 'Credit applied from Module 6.' }),
    scheme_amount: col.money({ notNull: true, default: '0', comment: 'Credit applied from Module 7.' }),
    balance_amount: col.money({ notNull: true, default: '0' }),

    order_id: col.uuid({ comment: 'Links back to Module 1 once orders are built.' }),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [
    { columns: ['customer_id', 'doc_date'] },
    { columns: ['status', 'doc_date'] },
    { columns: ['branch_id', 'doc_date'] },
    { columns: ['id'] },
    { columns: ['salesperson_id', 'doc_date'], where: 'salesperson_id is not null' },
    { columns: ['irn'], where: 'irn is not null' },
    { name: 'ix_sales_invoice_due', columns: ['customer_id', 'doc_date'], where: "balance_amount > 0 and status = 'posted'" },
  ],
});

export const salesInvoiceLineTable = defineTable({
  name: 'sales_invoice_line',
  module: 'sales',
  columns: {
    ...documentLineColumns('sales_invoice'),
    other_weight: col.weight({ notNull: true, default: '0' }),
    /** What this piece cost us, copied in at posting so margin survives later rate changes. */
    cost_value: col.money({ notNull: true, default: '0' }),
    hallmark_charge: col.money({ notNull: true, default: '0' }),
    certificate_number: col.text(),
    /** Every rate, rule and GST row the line was priced with, so an old bill can always be explained. */
    pricing_snapshot: col.jsonb({ notNull: true, default: "'{}'::jsonb" }),
    /** How much of this line has come back on returns (net grams; 1 = the piece for a tagged piece). */
    returned_net_weight: col.weight({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['sales_invoice_id', 'line_number'] }],
  indexes: [{ columns: ['piece_id'], where: 'piece_id is not null' }],
  checks: documentLineChecks(),
});

export const PAYMENT_MODES = [
  'cash', 'card', 'upi', 'bank_transfer', 'cheque', 'credit', 'old_gold', 'scheme', 'advance', 'emi', 'wallet',
] as const;

export const salesPaymentTable = defineTable({
  name: 'sales_payment',
  module: 'sales',
  comment: 'One row per tender. A single sale usually has several.',
  columns: {
    sales_invoice_id: col.fk('sales_invoice', { notNull: true, onDelete: 'cascade' }),
    payment_method_id: col.fk('payment_method'),
    mode: col.enum(PAYMENT_MODES, { notNull: true }),
    amount: col.money({ notNull: true }),
    reference: col.text({ comment: 'Cheque number, UPI reference, card approval code.' }),
    account_id: col.fk('account', { comment: 'Which cash or bank account this landed in.' }),
    received_at: col.timestamptz({ notNull: true, default: 'now()' }),
    /** Set when the tender is old gold, pointing at the Module 6 intake. */
    old_gold_intake_id: col.uuid(),
    notes: col.text(),
  },
  indexes: [{ columns: ['sales_invoice_id'] }, { columns: ['mode', 'received_at'] }],
  checks: [{ name: 'amount_positive', expression: 'amount > 0' }],
});

/** Module 5.2 — Customer Return. Opposite accounting direction to a purchase return. */
export const salesReturnTable = defineTable({
  name: 'sales_return',
  module: 'sales',
  columns: {
    ...documentHeaderColumns({ partyLabel: 'customer' }),
    sales_invoice_id: col.fk('sales_invoice', { notNull: true }),
    /** refund: money back now; credit_note: kept as the customer's credit for a later bill (exchange). */
    settlement: col.enum(['refund', 'credit_note'], { notNull: true, default: "'credit_note'" }),
    reason: col.enum(['defect', 'size', 'dislike', 'wrong_item', 'exchange', 'other'], { notNull: true, default: "'other'" }),
    refund_payment_method_id: col.fk('payment_method'),
    /** Taken off what is given back — wear, re-polish, hallmark. */
    deduction_amount: col.money({ notNull: true, default: '0' }),
    refund_amount: col.money({ notNull: true, default: '0' }),
    /** Part of the value that cleared what the customer still owed on the bill. */
    adjusted_amount: col.money({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [{ columns: ['customer_id', 'doc_date'] }, { columns: ['sales_invoice_id'] }, { columns: ['id'] }],
});

export const salesReturnLineTable = defineTable({
  name: 'sales_return_line',
  module: 'sales',
  columns: {
    ...documentLineColumns('sales_return'),
    sales_invoice_line_id: col.fk('sales_invoice_line', { notNull: true }),
    cost_value: col.money({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['sales_return_id', 'line_number'] }],
  checks: documentLineChecks(),
});

/** Money received from a customer outside a bill: clearing what they owe, then any extra as advance. */
export const customerReceiptTable = defineTable({
  name: 'customer_receipt',
  module: 'sales',
  columns: {
    doc_number: col.text({ notNull: true }),
    doc_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    customer_id: col.fk('party', { notNull: true }),
    payment_method_id: col.fk('payment_method', { notNull: true }),
    amount: col.money({ notNull: true }),
    reference: col.text(),
    /** Which bills it cleared: [{ invoiceId, docNumber, amount }]. */
    allocations: col.jsonb({ notNull: true, default: "'[]'::jsonb" }),
    advance_amount: col.money({ notNull: true, default: '0' }),
    notes: col.text(),
    status: col.enum(['posted', 'cancelled'], { notNull: true, default: "'posted'" }),
    voucher_id: col.fk('voucher'),
    cancelled_at: col.timestamptz(),
    cancel_reason: col.text(),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [{ columns: ['customer_id', 'doc_date'] }, { columns: ['id'] }],
  checks: [{ name: 'amount_positive', expression: 'amount > 0' }],
});

/** Pieces sent to a customer on approval. They stay ours until billed or brought back. */
export const approvalMemoTable = defineTable({
  name: 'approval_memo',
  module: 'sales',
  columns: {
    doc_number: col.text({ notNull: true }),
    doc_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    customer_id: col.fk('party', { notNull: true }),
    due_date: col.date({ notNull: true }),
    notes: col.text(),
    status: col.enum(['open', 'closed'], { notNull: true, default: "'open'" }),
    piece_count: col.int({ notNull: true, default: '0' }),
    gross_weight: col.weight({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [{ columns: ['status', 'due_date'] }, { columns: ['customer_id'] }, { columns: ['id'] }],
});

export const approvalMemoLineTable = defineTable({
  name: 'approval_memo_line',
  module: 'sales',
  columns: {
    approval_memo_id: col.fk('approval_memo', { notNull: true, onDelete: 'cascade' }),
    piece_id: col.fk('stock_piece', { notNull: true }),
    returned_at: col.timestamptz(),
    sales_invoice_id: col.fk('sales_invoice'),
  },
  uniques: [{ columns: ['approval_memo_id', 'piece_id'] }],
  indexes: [{ columns: ['piece_id'] }],
});
