/**
 * Module 5.2 — Sales.
 *
 * One invoice table covers counter billing, B2B and export. They differ in
 * which fields are filled in and which GST treatment applies, not in shape —
 * three near-identical tables would mean three places to fix every bug.
 *
 * Payment is its own table because a single sale is routinely settled several
 * ways at once: part cash, part card, part old gold, part scheme credit. That
 * is the normal case here, not an edge case.
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

    /** Settlement. paid_amount is the sum of the payment rows. */
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
    { columns: ['salesperson_id', 'doc_date'], where: 'salesperson_id is not null' },
    { columns: ['irn'], where: 'irn is not null' },
  ],
});

export const salesInvoiceLineTable = defineTable({
  name: 'sales_invoice_line',
  module: 'sales',
  columns: {
    ...documentLineColumns('sales_invoice'),
    /** What this piece cost us, copied in at posting so margin survives later rate changes. */
    cost_value: col.money({ notNull: true, default: '0' }),
    hallmark_charge: col.money({ notNull: true, default: '0' }),
    certificate_number: col.text(),
  },
  uniques: [{ columns: ['sales_invoice_id', 'line_number'] }],
  checks: documentLineChecks(),
});

export const PAYMENT_MODES = [
  'cash',
  'card',
  'upi',
  'bank_transfer',
  'cheque',
  'credit',
  'old_gold',
  'scheme',
  'advance',
] as const;

export const salesPaymentTable = defineTable({
  name: 'sales_payment',
  module: 'sales',
  comment: 'One row per tender. A single sale usually has several.',
  columns: {
    sales_invoice_id: col.fk('sales_invoice', { notNull: true, onDelete: 'cascade' }),
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
    sales_invoice_id: col.fk('sales_invoice'),
    settlement: col.enum(['refund', 'exchange', 'credit_note'], { notNull: true, default: "'credit_note'" }),
    reason: col.enum(['defect', 'size', 'dislike', 'wrong_item', 'other'], {
      notNull: true,
      default: "'other'",
    }),
    /** Returned jewellery is re-tested before it goes back on the shelf. */
    retested: col.bool({ notNull: true, default: 'false' }),
    restock: col.bool({ notNull: true, default: 'true' }),
    refund_amount: col.money({ notNull: true, default: '0' }),
  },
  uniques: [{ columns: ['doc_number'] }],
  indexes: [{ columns: ['customer_id', 'doc_date'] }, { columns: ['sales_invoice_id'] }],
});

export const salesReturnLineTable = defineTable({
  name: 'sales_return_line',
  module: 'sales',
  columns: {
    ...documentLineColumns('sales_return'),
    sales_invoice_line_id: col.fk('sales_invoice_line'),
  },
  uniques: [{ columns: ['sales_return_id', 'line_number'] }],
  checks: documentLineChecks(),
});
