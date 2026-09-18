/**
 * Karigars — the goldsmiths who actually make the jewellery.
 *
 * The part that matters financially is `ghat`: metal handed to a karigar comes
 * back lighter, and the difference between the loss you agreed to allow and the
 * loss that actually happened is either normal wastage or money walking out of
 * the door. The ledger below is what makes that distinction visible.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';

export const karigarTable = defineTable({
  name: 'karigar',
  module: 'master',
  softDelete: true,
  comment: 'Goldsmith master. Can be an employee or an outside workshop.',
  columns: {
    code: col.text({ notNull: true }),
    name: col.text({ notNull: true }),
    workshop_name: col.text(),
    engagement: col.enum(['in_house', 'external'], { notNull: true, default: "'external'" }),
    /** What they are known for — "Bridal Sets", "Kundan Meena", "Chains & Bangles". */
    speciality: col.text(),
    phone: col.text(),
    address: col.text(),
    pan: col.text(),
    gstin: col.text(),
    /** Agreed loss allowance in percent. Actual loss above this is recoverable. */
    standard_ghat_percent: col.rate({ notNull: true, default: '0' }),
    /** Default labour rate, per gram unless overridden on the job. */
    labour_rate_per_gram: col.money({ notNull: true, default: '0' }),
    /** Metal currently in their hands, in fine grams. Derived from the ledger. */
    metal_balance_fine: col.weight({ notNull: true, default: '0' }),
    wage_balance: col.money({ notNull: true, default: '0' }),
    is_active: col.bool({ notNull: true, default: 'true' }),
  },
  uniques: [{ columns: ['code'] }],
  indexes: [{ columns: ['name'] }, { columns: ['engagement', 'is_active'] }],
});

export const KARIGAR_ENTRY_TYPES = [
  'issue', 'return', 'ghat_allowed', 'ghat_excess', 'wage_earned', 'wage_paid', 'adjustment',
] as const;

/**
 * Append-only, like every other ledger here. Issue metal, receive it back,
 * record the loss, pay the wage — each is a row, never an edit.
 */
export const karigarLedgerTable = defineTable({
  name: 'karigar_ledger',
  module: 'master',
  timestamps: true,
  comment: 'Metal and wages per karigar. Append-only.',
  columns: {
    karigar_id: col.fk('karigar', { notNull: true }),
    entry_type: col.enum(KARIGAR_ENTRY_TYPES, { notNull: true }),
    entry_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),

    metal_id: col.fk('metal'),
    purity_id: col.fk('purity'),
    gross_weight: col.weight({ notNull: true, default: '0' }),
    /** Fine grams handed over / returned. The number that actually balances. */
    weight_in: col.weight({ notNull: true, default: '0' }),
    weight_out: col.weight({ notNull: true, default: '0' }),

    amount_debit: col.money({ notNull: true, default: '0' }),
    amount_credit: col.money({ notNull: true, default: '0' }),

    /** What this was for. */
    retail_order_id: col.fk('retail_order'),
    job_card_id: col.uuid({ comment: 'Reserved for the manufacturer production module.' }),
    voucher_id: col.fk('voucher'),
    narration: col.text(),
  },
  indexes: [
    { columns: ['karigar_id', 'entry_date'] },
    { columns: ['retail_order_id'], where: 'retail_order_id is not null' },
    { columns: ['entry_type', 'entry_date'] },
  ],
  checks: [
    { name: 'one_metal_direction', expression: 'weight_in = 0 or weight_out = 0' },
    { name: 'one_money_direction', expression: 'amount_debit = 0 or amount_credit = 0' },
  ],
});
