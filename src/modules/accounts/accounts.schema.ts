/**
 * Module 9 — the dual ledger.
 *
 * A jewellery business owes two different things to the same person at the
 * same time: rupees, and grams of gold. A customer who leaves 10g of old gold
 * against a future purchase is owed metal, not money — and if the rate moves
 * overnight, the rupee value of that debt moves with it while the gram figure
 * does not.
 *
 * So there are two parallel journals:
 *
 *     money ledger  ->  debit / credit in rupees      (what accountants expect)
 *     metal ledger  ->  in / out in fine grams        (what the trade runs on)
 *
 * Both hang off the same `voucher`, so a single transaction posts to both and
 * they can never drift apart.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

export const accountTable = defineTable({
  name: 'account',
  module: 'accounts',
  softDelete: true,
  comment: 'Chart of accounts (Module 9.2).',
  columns: {
    code: col.text({ notNull: true }),
    name: col.text({ notNull: true }),
    account_type: col.enum(ACCOUNT_TYPES, { notNull: true }),
    parent_id: col.fk('account'),
    /** A control account is posted to through a party, never directly. */
    is_control: col.bool({ notNull: true, default: 'false' }),
    control_for: col.enum(['customer', 'supplier', 'karigar'], {}),
    /** Metal accounts are measured in grams as well as rupees. */
    tracks_metal: col.bool({ notNull: true, default: 'false' }),
    is_system: col.bool({ notNull: true, default: 'false' }),
    is_active: col.bool({ notNull: true, default: 'true' }),
  },
  uniques: [{ columns: ['code'] }],
  indexes: [{ columns: ['account_type'] }, { columns: ['parent_id'] }],
});

export const VOUCHER_TYPES = [
  'opening',
  'purchase',
  'purchase_return',
  'sale',
  'sales_return',
  'receipt',
  'payment',
  'journal',
  'old_gold',
  'scheme',
  'mortgage',
  'production',
] as const;

export const voucherTable = defineTable({
  name: 'voucher',
  module: 'accounts',
  comment: 'The accounting header. Every posted document creates exactly one.',
  columns: {
    voucher_number: col.text({ notNull: true }),
    voucher_type: col.enum(VOUCHER_TYPES, { notNull: true }),
    voucher_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    narration: col.text(),
    /** The document this came from: sales_invoice, purchase_invoice... */
    source_type: col.text({ notNull: true }),
    source_id: col.uuid({ notNull: true }),
    is_reversed: col.bool({ notNull: true, default: 'false' }),
    reverses_voucher_id: col.fk('voucher'),
  },
  uniques: [{ columns: ['voucher_number'] }],
  indexes: [
    { columns: ['voucher_date'] },
    { columns: ['source_type', 'source_id'] },
    { columns: ['voucher_type', 'voucher_date'] },
  ],
});

export const ledgerEntryTable = defineTable({
  name: 'ledger_entry',
  module: 'accounts',
  comment: 'The money side. Debits and credits in the base currency.',
  columns: {
    voucher_id: col.fk('voucher', { notNull: true, onDelete: 'cascade' }),
    account_id: col.fk('account', { notNull: true }),
    /** Set when the account is a control account — whose balance this is. */
    party_id: col.fk('party'),
    branch_id: col.fk('branch', { notNull: true }),
    entry_date: col.date({ notNull: true }),
    debit: col.money({ notNull: true, default: '0' }),
    credit: col.money({ notNull: true, default: '0' }),
    narration: col.text(),
    /** For ageing reports: which invoice this payment is against. */
    against_type: col.text(),
    against_id: col.uuid(),
  },
  indexes: [
    { columns: ['account_id', 'entry_date'] },
    { columns: ['party_id', 'entry_date'], where: 'party_id is not null' },
    { columns: ['voucher_id'] },
  ],
  checks: [
    {
      name: 'one_side_only',
      expression: '(debit = 0 or credit = 0) and debit >= 0 and credit >= 0 and (debit + credit) > 0',
    },
  ],
});

export const metalLedgerEntryTable = defineTable({
  name: 'metal_ledger_entry',
  module: 'accounts',
  comment: 'The metal side. Weights in fine grams, so 22K and 24K are directly comparable.',
  columns: {
    voucher_id: col.fk('voucher', { notNull: true, onDelete: 'cascade' }),
    account_id: col.fk('account', { notNull: true }),
    party_id: col.fk('party'),
    branch_id: col.fk('branch', { notNull: true }),
    entry_date: col.date({ notNull: true }),
    metal_id: col.fk('metal', { notNull: true }),
    purity_id: col.fk('purity'),
    /** As weighed, at the stated purity. */
    gross_weight: col.weight({ notNull: true, default: '0' }),
    /** Converted to pure metal. This is the number that gets added up. */
    weight_in: col.weight({ notNull: true, default: '0' }),
    weight_out: col.weight({ notNull: true, default: '0' }),
    /** The rate used at the moment of posting, kept so history stays explainable. */
    rate_per_gram: col.money(),
    narration: col.text(),
  },
  indexes: [
    { columns: ['account_id', 'entry_date'] },
    { columns: ['party_id', 'metal_id', 'entry_date'], where: 'party_id is not null' },
    { columns: ['voucher_id'] },
  ],
  checks: [
    {
      name: 'one_direction_only',
      expression: '(weight_in = 0 or weight_out = 0) and weight_in >= 0 and weight_out >= 0',
    },
  ],
});

/**
 * The accounts every tenant needs before it can post anything. Codes follow the
 * usual Indian layout so an accountant recognises them on sight.
 */
export const DEFAULT_ACCOUNTS = [
  { code: '1000', name: 'Cash in Hand', account_type: 'asset' },
  { code: '1010', name: 'Bank Accounts', account_type: 'asset' },
  { code: '1100', name: 'Sundry Debtors', account_type: 'asset', is_control: true, control_for: 'customer' },
  { code: '1200', name: 'Stock in Hand', account_type: 'asset' },
  { code: '1210', name: 'Metal Stock', account_type: 'asset', tracks_metal: true },
  { code: '1300', name: 'GST Input Credit', account_type: 'asset' },
  { code: '2000', name: 'Sundry Creditors', account_type: 'liability', is_control: true, control_for: 'supplier' },
  { code: '2100', name: 'Customer Metal Payable', account_type: 'liability', tracks_metal: true },
  { code: '2200', name: 'GST Output Payable', account_type: 'liability' },
  { code: '2300', name: 'Scheme Liability', account_type: 'liability' },
  { code: '2400', name: 'Advance from Customers', account_type: 'liability' },
  { code: '3000', name: 'Capital Account', account_type: 'equity' },
  { code: '4000', name: 'Sales', account_type: 'income' },
  { code: '4100', name: 'Making Charges Income', account_type: 'income' },
  { code: '4900', name: 'Round Off', account_type: 'income' },
  { code: '5000', name: 'Purchases', account_type: 'expense' },
  { code: '5100', name: 'Cost of Goods Sold', account_type: 'expense' },
  { code: '5200', name: 'Karigar Wages', account_type: 'expense' },
  { code: '5900', name: 'Other Expenses', account_type: 'expense' },
] as const;
