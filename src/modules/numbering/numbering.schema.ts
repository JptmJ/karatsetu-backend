/** Module 4.3 — how every document gets its number. */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';

export const RESET_PERIODS = ['never', 'yearly', 'financial_yearly', 'monthly'] as const;

export const numberingSeriesTable = defineTable({
  name: 'numbering_series',
  module: 'numbering',
  comment: 'One row per document type per branch, e.g. sales invoices at the Andheri showroom.',
  columns: {
    doc_type: col.text({ notNull: true, comment: 'purchase_order, sales_invoice, grn, tag...' }),
    branch_id: col.fk('branch', { comment: 'Null means one shared series across all branches.' }),
    name: col.text({ notNull: true }),
    prefix: col.text({ notNull: true, default: "''", comment: 'Supports {FY}, {YY}, {MM}, {BRANCH}.' }),
    suffix: col.text({ notNull: true, default: "''" }),
    /** 5 gives INV-00042. */
    padding: col.int({ notNull: true, default: '5' }),
    next_number: col.bigint({ notNull: true, default: '1' }),
    reset_period: col.enum(RESET_PERIODS, { notNull: true, default: "'financial_yearly'" }),
    /** The period the current counter belongs to, e.g. "2025-26". Used to detect a rollover. */
    current_period: col.text(),
    is_active: col.bool({ notNull: true, default: 'true' }),
  },
  uniques: [{ columns: ['doc_type', 'branch_id'], nullsNotDistinct: true }],
});

/**
 * Numbers that were generated but whose document was never saved. GST wants an
 * unbroken sequence, so a gap has to be explainable rather than mysterious.
 */
export const numberingGapTable = defineTable({
  name: 'numbering_gap',
  module: 'numbering',
  columns: {
    series_id: col.fk('numbering_series', { notNull: true }),
    doc_number: col.text({ notNull: true }),
    reason: col.text({ notNull: true }),
  },
  indexes: [{ columns: ['series_id'] }],
});
