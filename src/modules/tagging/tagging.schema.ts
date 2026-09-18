/**
 * Tagging & Barcoding.
 *
 * Every finished piece gets a physical string tag carrying its weights, purity
 * and BIS HUID. The HUID is the part with legal weight: since hallmarking
 * became mandatory, selling an untagged piece is an offence, which is why the
 * frontend's stock module reports "zero untagged precious metal" as a headline
 * status rather than a nice-to-have.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';

export const tagTemplateTable = defineTable({
  name: 'tag_template',
  module: 'tagging',
  softDelete: true,
  comment: 'Label layouts. Dual-wing string tags are the common jewellery format.',
  columns: {
    code: col.text({ notNull: true }),
    name: col.text({ notNull: true }),
    format: col.enum(['string_tag_dual_wing', 'sticker', 'hang_tag', 'box_label'], {
      notNull: true, default: "'string_tag_dual_wing'",
    }),
    width_mm: col.numeric(6, 2, { notNull: true, default: '85' }),
    height_mm: col.numeric(6, 2, { notNull: true, default: '15' }),
    barcode_type: col.enum(['code128', 'qr', 'datamatrix', 'ean13'], { notNull: true, default: "'code128'" }),
    /** Which fields print on each wing, and where. */
    layout: col.jsonb({ notNull: true, default: "'{}'::jsonb" }),
    /** e.g. "Argox CP-2140" */
    printer_model: col.text(),
    is_default: col.bool({ notNull: true, default: 'false' }),
    is_active: col.bool({ notNull: true, default: 'true' }),
  },
  uniques: [{ columns: ['code'] }],
});

/**
 * HUID assignment history. A piece carries its current HUID on `stock_piece`;
 * this is the trail of how it got there, including re-hallmarking after a
 * repair or remake.
 */
export const huidAssignmentTable = defineTable({
  name: 'huid_assignment',
  module: 'tagging',
  columns: {
    piece_id: col.fk('stock_piece', { notNull: true }),
    huid: col.text({ notNull: true, comment: 'The BIS 6-character alphanumeric identifier.' }),
    hallmark_centre_code: col.text(),
    hallmark_centre_name: col.text(),
    hallmarked_on: col.date(),
    /** Purity certified by the centre, which is what the HUID actually attests. */
    certified_purity_percent: col.purity(),
    certificate_number: col.text(),
    /** Set when a HUID is retired — piece melted, remade or wrongly entered. */
    superseded_at: col.timestamptz(),
    supersede_reason: col.text(),
    assigned_by: col.fk('app_user'),
  },
  indexes: [
    { columns: ['huid'] },
    { columns: ['piece_id', 'superseded_at'] },
  ],
  checks: [
    // BIS HUIDs are six alphanumeric characters.
    { name: 'huid_format', expression: "huid ~ '^[A-Z0-9]{6}$'" },
  ],
});

export const PRINT_JOB_STATUSES = ['queued', 'printing', 'printed', 'failed', 'cancelled'] as const;

export const tagPrintJobTable = defineTable({
  name: 'tag_print_job',
  module: 'tagging',
  comment: 'The thermal printer queue the tagging screen shows.',
  columns: {
    tag_template_id: col.fk('tag_template', { notNull: true }),
    branch_id: col.fk('branch', { notNull: true }),
    status: col.enum(PRINT_JOB_STATUSES, { notNull: true, default: "'queued'" }),
    piece_count: col.int({ notNull: true, default: '0' }),
    queued_by: col.fk('app_user'),
    queued_at: col.timestamptz({ notNull: true, default: 'now()' }),
    printed_at: col.timestamptz(),
    printer_name: col.text(),
    error_message: col.text(),
  },
  indexes: [{ columns: ['status', 'queued_at'] }, { columns: ['branch_id', 'status'] }],
});

export const tagPrintJobItemTable = defineTable({
  name: 'tag_print_job_item',
  module: 'tagging',
  columns: {
    tag_print_job_id: col.fk('tag_print_job', { notNull: true, onDelete: 'cascade' }),
    piece_id: col.fk('stock_piece', { notNull: true }),
    copies: col.int({ notNull: true, default: '1' }),
    /** What was actually rendered, frozen so a reprint matches the original. */
    rendered_payload: col.jsonb({ notNull: true, default: "'{}'::jsonb" }),
    printed: col.bool({ notNull: true, default: 'false' }),
  },
  uniques: [{ columns: ['tag_print_job_id', 'piece_id'] }],
  checks: [{ name: 'copies_positive', expression: 'copies > 0' }],
});
