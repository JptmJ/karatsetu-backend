/**
 * Tax and pricing rules as data. Nothing here is ever edited once a document
 * has used it — a change is a new row with a later effective_from, and every
 * invoice line keeps a copy of the rate it was billed at.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';

export const hsnGstRateTable = defineTable({
  name: 'hsn_gst_rate',
  module: 'masters',
  comment: 'GST per HSN/SAC code and price component, versioned by date.',
  columns: {
    hsn_code: col.text({ notNull: true, comment: 'HSN for goods (e.g. 7113), SAC for services (e.g. 9988).' }),
    code_type: col.enum(['hsn', 'sac'], { notNull: true, default: "'hsn'", comment: 'HSN for goods, SAC for services.' }),
    description: col.text(),
    component: col.enum(['metal', 'making', 'stone', 'service', 'hallmark', 'other'], { notNull: true }),
    gst_rate: col.rate({ notNull: true, comment: 'Total GST %. Split into CGST+SGST or IGST at billing time.' }),
    cess_rate: col.rate({ notNull: true, default: '0' }),
    is_reverse_charge: col.bool({ notNull: true, default: 'false' }),
    effective_from: col.date({ notNull: true }),
    effective_to: col.date({ comment: 'Null = still in force. Filled in when a newer version is added.' }),
    source_note: col.text({ comment: 'Why this rate — notification number or CA confirmation.' }),
  },
  uniques: [{ columns: ['hsn_code', 'component', 'effective_from'] }],
  checks: [
    { name: 'gst_rate_range', expression: 'gst_rate >= 0 and gst_rate <= 28' },
    { name: 'effective_order', expression: 'effective_to is null or effective_to >= effective_from' },
  ],
});

export const priceRuleTable = defineTable({
  name: 'price_rule',
  module: 'masters',
  softDelete: true,
  comment: 'Making, wastage, stone, hallmark and discount rules. The most specific matching rule wins.',
  columns: {
    code: col.text({ notNull: true }),
    name: col.text({ notNull: true }),
    applies_to: col.enum(['making', 'wastage', 'stone', 'hallmark', 'discount'], { notNull: true }),
    basis: col.enum(['per_gram', 'percent', 'flat', 'slab', 'hybrid'], { notNull: true }),
    rate: col.rate({ comment: 'per_gram: ₹/g · percent: % of metal value · flat: ₹ · hybrid: the % part.' }),
    flat_amount: col.money({ comment: 'hybrid only: the fixed ₹ added to the % part.' }),
    slabs: col.jsonb({
      notNull: true, default: "'[]'::jsonb",
      comment: 'basis = slab: [{"fromG":0,"toG":10,"rate":450},{"fromG":10,"toG":null,"rate":400}]. toG exclusive; null = no upper limit.',
    }),
    slab_mode: col.enum(['whole', 'tiered'], {
      notNull: true, default: "'whole'",
      comment: 'whole: the matched slab rate applies to all the weight. tiered: each slab portion at its own rate, like tax brackets.',
    }),
    minimum_amount: col.money({ comment: 'Charge at least this much per piece.' }),
    // Scope — null means "any". More filled-in fields = more specific = wins.
    metal_id: col.fk('metal'),
    purity_id: col.fk('purity'),
    item_category_id: col.fk('item_category'),
    item_id: col.fk('item'),
    branch_id: col.fk('branch'),
    priority: col.int({ notNull: true, default: '0', comment: 'Tie-breaker between equally specific rules. Higher wins.' }),
    effective_from: col.date({ notNull: true, default: 'current_date' }),
    effective_to: col.date(),
    is_active: col.bool({ notNull: true, default: 'true' }),
  },
  indexes: [
    { name: 'ux_price_rule_code', columns: ['code'], unique: true, where: 'deleted_at is null' },
    { columns: ['applies_to', 'is_active'] },
  ],
  checks: [
    { name: 'rate_needed', expression: "basis = 'slab' or rate is not null" },
    { name: 'hybrid_needs_flat', expression: "basis <> 'hybrid' or flat_amount is not null" },
    { name: 'effective_order', expression: 'effective_to is null or effective_to >= effective_from' },
  ],
});

export const paymentMethodTable = defineTable({
  name: 'payment_method',
  module: 'masters',
  softDelete: true,
  comment: 'The tenders a branch accepts. `kind` tells the system how to settle it; everything else is the tenant\'s choice.',
  columns: {
    code: col.text({ notNull: true }),
    name: col.text({ notNull: true, comment: 'What staff see, e.g. "HDFC Card Machine", "PhonePe QR".' }),
    kind: col.enum(
      ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'credit', 'old_gold', 'scheme', 'advance', 'emi', 'wallet'],
      { notNull: true },
    ),
    account_id: col.fk('account', { comment: 'Ledger the money lands in — Cash in Hand, HDFC Current A/c...' }),
    requires_reference: col.bool({ notNull: true, default: 'false', comment: 'Ask for UTR / card slip / cheque no.' }),
    charges_percent: col.rate({ comment: 'Card or wallet fee the shop pays, if tracked.' }),
    max_amount: col.money({ comment: 'Per-transaction limit — e.g. the cash limit. Configurable, never hardcoded.' }),
    is_active: col.bool({ notNull: true, default: 'true' }),
    sort_order: col.int({ notNull: true, default: '0' }),
  },
  indexes: [
    { name: 'ux_payment_method_code', columns: ['code'], unique: true, where: 'deleted_at is null' },
    { columns: ['is_active'] },
  ],
});

export const paymentMethodBranchTable = defineTable({
  name: 'payment_method_branch',
  module: 'masters',
  comment: 'Branches where a payment method is offered. No rows = offered at every branch.',
  columns: {
    payment_method_id: col.fk('payment_method', { notNull: true, onDelete: 'cascade' }),
    branch_id: col.fk('branch', { notNull: true }),
  },
  uniques: [{ columns: ['payment_method_id', 'branch_id'] }],
});
