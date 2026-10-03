/**
 * Old Gold: jewellery customers bring in.
 *
 * One intake voucher per visit. Every article is weighed, its stones and dirt
 * come off, its purity is tested (XRF, touchstone, hallmark) or estimated, the
 * shop's melting loss is deducted, and it is valued at the day's rate the way
 * the shop has chosen. The value is credited to the customer: spent on a bill
 * (exchange), paid out (buyback), or kept as advance. The metal waits in stock
 * as old gold until it is melted in-house or sent to a refiner.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';

export const OLD_GOLD_TEST_METHODS = ['xrf', 'touchstone', 'hallmark', 'estimate'] as const;

export const oldGoldIntakeTable = defineTable({
  name: 'old_gold_intake',
  module: 'oldgold',
  comment: 'The intake voucher. One per customer visit; posts on saving.',
  columns: {
    voucher_number: col.text({ notNull: true }),
    voucher_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    customer_id: col.fk('party', { notNull: true }),
    /** Where the metal is kept until it is melted. */
    location_id: col.fk('stock_location', { notNull: true }),
    status: col.enum(['posted', 'cancelled'], { notNull: true, default: "'posted'" }),
    /** exchange = credit to spend on a bill or keep as advance; buyback = paid out on the spot. */
    settlement_type: col.enum(['exchange', 'buyback'], { notNull: true, default: "'exchange'" }),
    /** desk = the Old Gold screen; counter = taken in as part of a bill. */
    channel: col.enum(['desk', 'counter'], { notNull: true, default: "'desk'" }),
    tested_by: col.fk('app_user'),

    total_gross_weight: col.weight({ notNull: true, default: '0' }),
    total_deduction_weight: col.weight({ notNull: true, default: '0', comment: 'Stones and dirt.' }),
    total_net_weight: col.weight({ notNull: true, default: '0' }),
    total_loss_weight: col.weight({ notNull: true, default: '0', comment: 'Fine metal kept back as melting loss.' }),
    total_fine_weight: col.weight({ notNull: true, default: '0', comment: 'Fine metal bought, after melting loss.' }),
    gross_value: col.money({ notNull: true, default: '0' }),
    deduction_amount: col.money({ notNull: true, default: '0' }),
    /** What the customer is credited. */
    net_value: col.money({ notNull: true, default: '0' }),

    /** Paid out to the customer (buyback now, or later from the credit). */
    paid_out_amount: col.money({ notNull: true, default: '0' }),
    payout_method_id: col.fk('payment_method'),
    payout_reference: col.text(),
    /** The bill it was taken in on (counter). */
    applied_to_invoice_id: col.fk('sales_invoice'),

    /** Proof of identity, as the shop's register settings require. */
    id_proof_type: col.enum(['aadhaar', 'pan', 'voter_id', 'driving_licence', 'passport', 'other']),
    id_proof_number: col.text(),

    voucher_id: col.fk('voucher'),
    notes: col.text(),
    cancelled_at: col.timestamptz(),
    cancel_reason: col.text(),
  },
  uniques: [{ columns: ['voucher_number'] }],
  indexes: [
    { columns: ['customer_id', 'voucher_date'] },
    { columns: ['branch_id', 'voucher_date'] },
    { columns: ['status', 'voucher_date'] },
    { columns: ['applied_to_invoice_id'] },
  ],
  checks: [
    { name: 'weights_not_negative', expression: 'total_gross_weight >= 0 and total_net_weight >= 0' },
    { name: 'net_within_gross', expression: 'total_net_weight <= total_gross_weight' },
    { name: 'paid_within_value', expression: 'paid_out_amount >= 0 and paid_out_amount <= net_value' },
  ],
});

export const oldGoldItemTable = defineTable({
  name: 'old_gold_item',
  module: 'oldgold',
  comment: 'One row per article brought in, weighed, tested and valued on its own.',
  columns: {
    old_gold_intake_id: col.fk('old_gold_intake', { notNull: true, onDelete: 'cascade' }),
    line_number: col.int({ notNull: true }),
    description: col.text({ notNull: true }),
    item_category_id: col.fk('item_category'),
    metal_id: col.fk('metal', { notNull: true }),

    gross_weight: col.weight({ notNull: true }),
    stone_weight: col.weight({ notNull: true, default: '0' }),
    dirt_weight: col.weight({ notNull: true, default: '0' }),
    net_weight: col.weight({ notNull: true }),

    test_method: col.enum(OLD_GOLD_TEST_METHODS, { notNull: true, default: "'xrf'" }),
    tested_purity_percent: col.purity({ notNull: true }),
    /** What the customer said it was, when it differs. */
    declared_purity_percent: col.purity(),
    /** Machine and reading, kept for disputes. */
    test_instrument: col.text(),
    huid: col.text(),
    /** A piece this shop sold, bought back under its own-jewellery terms. */
    own_piece_id: col.fk('stock_piece'),

    loss_percent: col.purity({ notNull: true, default: '0', comment: 'Melting loss deducted from the fine metal.' }),
    loss_weight: col.weight({ notNull: true, default: '0' }),
    fine_weight: col.weight({ notNull: true, comment: 'net × tested purity, less melting loss.' }),
    rate_basis: col.enum(['fine', 'purity'], { notNull: true, default: "'fine'" }),
    rate_per_gram: col.money({ notNull: true, default: '0' }),
    value: col.money({ notNull: true, default: '0' }),

    /** Set when this article goes into a melt or refine batch. */
    melt_batch_id: col.fk('melt_batch'),
    notes: col.text(),
  },
  uniques: [{ columns: ['old_gold_intake_id', 'line_number'] }],
  indexes: [{ columns: ['melt_batch_id'] }, { columns: ['own_piece_id'] }],
  checks: [
    { name: 'gross_positive', expression: 'gross_weight > 0' },
    { name: 'deductions_within_gross', expression: 'stone_weight + dirt_weight <= gross_weight' },
    { name: 'net_within_gross', expression: 'net_weight <= gross_weight' },
    { name: 'purity_range', expression: 'tested_purity_percent > 0 and tested_purity_percent <= 100' },
    { name: 'loss_range', expression: 'loss_percent >= 0 and loss_percent < 100' },
  ],
});

export const oldGoldPayoutTable = defineTable({
  name: 'old_gold_payout',
  module: 'oldgold',
  comment: 'Money paid to the customer for old gold: at intake (buyback) or later from the credit.',
  columns: {
    old_gold_intake_id: col.fk('old_gold_intake', { notNull: true }),
    customer_id: col.fk('party', { notNull: true }),
    doc_date: col.date({ notNull: true }),
    payment_method_id: col.fk('payment_method', { notNull: true }),
    amount: col.money({ notNull: true }),
    reference: col.text(),
    voucher_id: col.fk('voucher'),
  },
  indexes: [{ columns: ['old_gold_intake_id'] }, { columns: ['customer_id', 'doc_date'] }],
  checks: [{ name: 'amount_positive', expression: 'amount > 0' }],
});

export const meltBatchTable = defineTable({
  name: 'melt_batch',
  module: 'oldgold',
  comment: 'Old gold melted in-house or sent to a refiner, and the metal that came back.',
  columns: {
    batch_number: col.text({ notNull: true }),
    batch_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    metal_id: col.fk('metal', { notNull: true }),
    kind: col.enum(['melt', 'refine'], { notNull: true, default: "'melt'" }),
    /** melt: melted at once. refine: sent, then received. */
    status: col.enum(['melted', 'sent', 'received', 'cancelled'], { notNull: true, default: "'melted'" }),

    input_gross_weight: col.weight({ notNull: true, default: '0' }),
    input_net_weight: col.weight({ notNull: true, default: '0' }),
    input_fine_weight: col.weight({ notNull: true, default: '0' }),
    input_value: col.money({ notNull: true, default: '0' }),

    output_item_id: col.fk('item'),
    output_purity_id: col.fk('purity'),
    output_weight: col.weight({ notNull: true, default: '0' }),
    output_purity_percent: col.purity({ comment: 'The assay, when it differs from the purity’s fineness.' }),
    output_fine_weight: col.weight({ notNull: true, default: '0' }),
    /** Input fine − output fine; negative is a gain. */
    loss_fine_weight: col.weight({ notNull: true, default: '0' }),

    refiner_id: col.fk('party', { comment: 'The refinery, when sent out.' }),
    refining_charge: col.money({ notNull: true, default: '0' }),
    sent_at: col.timestamptz(),
    received_at: col.timestamptz(),
    assay_certificate_number: col.text(),
    received_into_location_id: col.fk('stock_location'),
    voucher_id: col.fk('voucher'),
    receive_voucher_id: col.fk('voucher'),
    notes: col.text(),
    cancelled_at: col.timestamptz(),
    cancel_reason: col.text(),
  },
  uniques: [{ columns: ['batch_number'] }],
  indexes: [{ columns: ['status', 'batch_date'] }, { columns: ['metal_id', 'batch_date'] }],
});
