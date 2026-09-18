/**
 * Every business document in this system has the same skeleton, because every
 * one of them goes through the same life:
 *
 *     draft ──► confirmed ──► posted ──► (cancelled)
 *       │                        │
 *       └── freely editable      └── frozen; affects stock and books
 *
 * A draft is scratch paper. Posting is the moment stock moves and the ledger is
 * written, and from then on the document is read-only — a mistake is fixed with
 * a reversing document, never by editing history. That single rule is what lets
 * an auditor trust the numbers a year later.
 */
import { col } from './columns.js';
import type { CheckDef, ColumnDef } from './types.js';

export const DOC_STATUSES = ['draft', 'confirmed', 'posted', 'cancelled', 'closed'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** Statuses in which the document may still be edited or deleted. */
export const EDITABLE_STATUSES: DocStatus[] = ['draft'];

/** Header columns shared by orders, receipts, invoices and returns. */
export function documentHeaderColumns(options: { partyLabel: 'supplier' | 'customer' }): Record<string, ColumnDef> {
  const partyColumn = `${options.partyLabel}_id`;
  return {
    doc_number: col.text({ notNull: true }),
    doc_date: col.date({ notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    [partyColumn]: col.fk('party', { notNull: true }),
    status: col.enum(DOC_STATUSES, { notNull: true, default: "'draft'" }),

    reference_number: col.text({ comment: "The other side's document number." }),
    reference_date: col.date(),
    notes: col.text(),

    /** Money totals, all derived from the lines and recomputed on every save. */
    metal_amount: col.money({ notNull: true, default: '0' }),
    making_amount: col.money({ notNull: true, default: '0' }),
    stone_amount: col.money({ notNull: true, default: '0' }),
    other_charges: col.money({ notNull: true, default: '0' }),
    discount_amount: col.money({ notNull: true, default: '0' }),
    taxable_amount: col.money({ notNull: true, default: '0' }),
    cgst_amount: col.money({ notNull: true, default: '0' }),
    sgst_amount: col.money({ notNull: true, default: '0' }),
    igst_amount: col.money({ notNull: true, default: '0' }),
    round_off: col.money({ notNull: true, default: '0' }),
    total_amount: col.money({ notNull: true, default: '0' }),

    /** Weight totals, so a document can be read in grams without opening the lines. */
    total_gross_weight: col.weight({ notNull: true, default: '0' }),
    total_net_weight: col.weight({ notNull: true, default: '0' }),
    total_fine_weight: col.weight({ notNull: true, default: '0' }),

    posted_at: col.timestamptz(),
    posted_by: col.uuid(),
    cancelled_at: col.timestamptz(),
    cancelled_by: col.uuid(),
    cancel_reason: col.text(),
    voucher_id: col.fk('voucher', { comment: 'The accounting entry created at posting.' }),
  };
}

/** Line columns shared by every document that moves goods. */
export function documentLineColumns(parentTable: string): Record<string, ColumnDef> {
  return {
    [`${parentTable}_id`]: col.fk(parentTable, { notNull: true, onDelete: 'cascade' }),
    line_number: col.int({ notNull: true }),
    item_id: col.fk('item', { notNull: true }),
    purity_id: col.fk('purity'),
    piece_id: col.fk('stock_piece', { comment: 'Set when a specific tagged piece is involved.' }),
    description: col.text(),
    hsn_code: col.text(),

    quantity: col.numeric(14, 3, { notNull: true, default: '1' }),
    gross_weight: col.weight({ notNull: true, default: '0' }),
    stone_weight: col.weight({ notNull: true, default: '0' }),
    net_weight: col.weight({ notNull: true, default: '0' }),
    fine_weight: col.weight({ notNull: true, default: '0' }),

    /** The rate this line was priced at, frozen at the moment of entry. */
    rate_per_gram: col.money({ notNull: true, default: '0' }),
    metal_amount: col.money({ notNull: true, default: '0' }),

    /** How making was charged on this line — copied from config, then overridable. */
    making_basis: col.enum(['per_gram', 'percent', 'flat'], { notNull: true, default: "'per_gram'" }),
    making_rate: col.rate({ notNull: true, default: '0' }),
    making_amount: col.money({ notNull: true, default: '0' }),

    wastage_percent: col.rate({ notNull: true, default: '0' }),
    wastage_weight: col.weight({ notNull: true, default: '0' }),
    wastage_amount: col.money({ notNull: true, default: '0' }),

    stone_amount: col.money({ notNull: true, default: '0' }),
    discount_amount: col.money({ notNull: true, default: '0' }),
    taxable_amount: col.money({ notNull: true, default: '0' }),

    gst_rate: col.rate({ notNull: true, default: '0' }),
    cgst_amount: col.money({ notNull: true, default: '0' }),
    sgst_amount: col.money({ notNull: true, default: '0' }),
    igst_amount: col.money({ notNull: true, default: '0' }),
    line_total: col.money({ notNull: true, default: '0' }),

    location_id: col.fk('stock_location'),
    notes: col.text(),
  };
}

/** Rules that hold for every document line. */
export const documentLineChecks = (): CheckDef[] => [
  { name: 'quantity_positive', expression: 'quantity > 0' },
  { name: 'weights_not_negative', expression: 'gross_weight >= 0 and net_weight >= 0 and fine_weight >= 0' },
  { name: 'net_within_gross', expression: 'net_weight <= gross_weight' },
];
