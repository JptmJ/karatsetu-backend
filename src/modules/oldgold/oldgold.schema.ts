/**
 * Old Gold Exchange & Melt.
 *
 * Shared intake and testing, then the settlement branches: exchange credit
 * against a purchase, or cash buyback with nothing attached. Both start from
 * the same voucher — that shared-intake, branched-settlement shape is why this
 * is one module rather than two.
 *
 * The weights matter more than usual here. A customer brings in a bangle that
 * weighs 22g gross; after deducting stones, solder and dirt it is 19.4g of
 * actual metal, and XRF says it is 78.2% pure, so you are buying 15.17g fine.
 * Every one of those numbers has to be on the voucher or the customer will
 * argue, and they will be right to.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';

export const OLD_GOLD_STATUSES = ['draft', 'tested', 'approved', 'settled', 'returned', 'cancelled'] as const;

export const oldGoldIntakeTable = defineTable({
  name: 'old_gold_intake',
  module: 'oldgold',
  comment: 'The appraisal voucher. One per customer visit.',
  columns: {
    voucher_number: col.text({ notNull: true }),
    voucher_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    customer_id: col.fk('party', { notNull: true }),
    status: col.enum(OLD_GOLD_STATUSES, { notNull: true, default: "'draft'" }),

    /** exchange = credit toward a purchase; buyback = cash out. */
    settlement_type: col.enum(['exchange', 'buyback'], {}),
    tested_by: col.fk('app_user'),
    approved_by: col.fk('app_user'),
    approved_at: col.timestamptz(),

    /** Totals rolled up from the items. */
    total_gross_weight: col.weight({ notNull: true, default: '0' }),
    total_deduction_weight: col.weight({ notNull: true, default: '0' }),
    total_net_weight: col.weight({ notNull: true, default: '0' }),
    total_fine_weight: col.weight({ notNull: true, default: '0' }),
    /** The buying rate applied, which is normally below the selling rate. */
    rate_per_gram: col.money({ notNull: true, default: '0' }),
    gross_value: col.money({ notNull: true, default: '0' }),
    /** Handling or refining charge withheld from the payout. */
    deduction_amount: col.money({ notNull: true, default: '0' }),
    net_value: col.money({ notNull: true, default: '0' }),

    /** Set when the credit is applied to a sale (exchange). */
    applied_to_invoice_id: col.fk('sales_invoice'),
    applied_to_order_id: col.fk('retail_order'),
    /** Set when paid out in cash (buyback). */
    payout_mode: col.enum(['cash', 'bank_transfer', 'upi', 'cheque'], {}),
    payout_reference: col.text(),
    settled_at: col.timestamptz(),
    voucher_id: col.fk('voucher'),

    /** Where the metal went after settlement. */
    melt_batch_id: col.fk('melt_batch'),
    notes: col.text(),
  },
  uniques: [{ columns: ['voucher_number'] }],
  indexes: [
    { columns: ['customer_id', 'voucher_date'] },
    { columns: ['status', 'voucher_date'] },
    { columns: ['branch_id', 'voucher_date'] },
  ],
  checks: [
    { name: 'weights_not_negative', expression: 'total_gross_weight >= 0 and total_net_weight >= 0' },
    { name: 'net_within_gross', expression: 'total_net_weight <= total_gross_weight' },
  ],
});

export const PURITY_TEST_METHODS = ['xrf', 'touchstone', 'fire_assay', 'declared', 'visual'] as const;

export const oldGoldItemTable = defineTable({
  name: 'old_gold_item',
  module: 'oldgold',
  comment: 'One row per physical article brought in. Weighed and tested individually.',
  columns: {
    old_gold_intake_id: col.fk('old_gold_intake', { notNull: true, onDelete: 'cascade' }),
    line_number: col.int({ notNull: true }),
    description: col.text({ notNull: true }),
    item_category_id: col.fk('item_category'),
    metal_id: col.fk('metal', { notNull: true }),

    gross_weight: col.weight({ notNull: true }),
    /** What comes off before you are looking at metal. */
    stone_weight: col.weight({ notNull: true, default: '0' }),
    dirt_weight: col.weight({ notNull: true, default: '0' }),
    solder_weight: col.weight({ notNull: true, default: '0' }),
    net_weight: col.weight({ notNull: true }),

    test_method: col.enum(PURITY_TEST_METHODS, { notNull: true, default: "'xrf'" }),
    /** What the machine actually read, as a percentage. */
    tested_purity_percent: col.purity({ notNull: true }),
    /** What the customer was told it was, when they said. Often disagrees. */
    declared_purity_percent: col.purity(),
    /** Machine serial + reading, kept for disputes. */
    test_instrument: col.text(),
    test_reading_raw: col.jsonb({ notNull: true, default: "'{}'::jsonb" }),
    tested_at: col.timestamptz(),

    fine_weight: col.weight({ notNull: true, comment: 'net_weight x tested_purity_percent.' }),
    rate_per_gram: col.money({ notNull: true, default: '0' }),
    value: col.money({ notNull: true, default: '0' }),

    photo_storage_key: col.text(),
    /** Returned to the customer instead of being bought. */
    is_returned: col.bool({ notNull: true, default: 'false' }),
    notes: col.text(),
  },
  uniques: [{ columns: ['old_gold_intake_id', 'line_number'] }],
  checks: [
    { name: 'gross_positive', expression: 'gross_weight > 0' },
    {
      name: 'deductions_within_gross',
      expression: 'stone_weight + dirt_weight + solder_weight <= gross_weight',
    },
    { name: 'net_within_gross', expression: 'net_weight <= gross_weight' },
    { name: 'purity_range', expression: 'tested_purity_percent > 0 and tested_purity_percent <= 100' },
  ],
});

export const meltBatchTable = defineTable({
  name: 'melt_batch',
  module: 'oldgold',
  comment: 'Scrap collected, melted and assayed. Closes the loop on metal reconciliation.',
  columns: {
    batch_number: col.text({ notNull: true }),
    batch_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    metal_id: col.fk('metal', { notNull: true }),
    status: col.enum(['open', 'sent', 'melted', 'received', 'closed'], { notNull: true, default: "'open'" }),

    /** What went in, summed from the linked intakes. */
    input_gross_weight: col.weight({ notNull: true, default: '0' }),
    input_fine_weight: col.weight({ notNull: true, default: '0' }),
    /** What came back. The gap is melting loss. */
    output_weight: col.weight({ notNull: true, default: '0' }),
    output_purity_percent: col.purity(),
    output_fine_weight: col.weight({ notNull: true, default: '0' }),
    loss_fine_weight: col.weight({ notNull: true, default: '0' }),

    refiner_id: col.fk('party', { comment: 'The refinery, when sent out.' }),
    refining_charge: col.money({ notNull: true, default: '0' }),
    sent_at: col.timestamptz(),
    received_at: col.timestamptz(),
    assay_certificate_number: col.text(),
    /** Where the recovered metal landed. */
    received_into_location_id: col.fk('stock_location'),
    voucher_id: col.fk('voucher'),
    notes: col.text(),
  },
  uniques: [{ columns: ['batch_number'] }],
  indexes: [{ columns: ['status', 'batch_date'] }, { columns: ['metal_id', 'batch_date'] }],
});
