/**
 * Module 3 — Stock.
 *
 * The model is a journal, not a set of counters. Nothing ever writes "the
 * balance is now X"; every change appends a row to `stock_movement` saying what
 * moved, and the balance is the sum of those rows. `stock_balance` is a cache
 * of that sum, updated in the same transaction, and it can always be rebuilt
 * from the journal if it ever disagrees.
 *
 * That choice is what makes "why is 4 grams missing?" answerable at 9pm on a
 * Saturday, which in this trade is the question that actually gets asked.
 */
import { defineTable } from '../../core/db/schema/registry.js';
import { col } from '../../core/db/schema/columns.js';

export const PIECE_STATUSES = [
  'in_stock',
  'on_memo',
  'sold',
  'in_transit',
  'with_karigar',
  'in_repair',
  'melted',
  'written_off',
] as const;

export const stockPieceTable = defineTable({
  name: 'stock_piece',
  module: 'inventory',
  comment: 'One row per physically tagged item. Only used by items with tracking = piece.',
  columns: {
    tag_number: col.text({ notNull: true, comment: 'What is printed on the label.' }),
    item_id: col.fk('item', { notNull: true }),
    purity_id: col.fk('purity'),
    location_id: col.fk('stock_location', { notNull: true }),
    status: col.enum(PIECE_STATUSES, { notNull: true, default: "'in_stock'" }),

    /** Weights, all in grams. gross = net metal + stones + findings. */
    gross_weight: col.weight({ notNull: true, default: '0' }),
    net_weight: col.weight({ notNull: true, default: '0', comment: 'Metal only — what purity applies to.' }),
    stone_weight: col.weight({ notNull: true, default: '0' }),
    other_weight: col.weight({ notNull: true, default: '0' }),
    fine_weight: col.weight({ notNull: true, default: '0', comment: 'net_weight x purity — the pure metal content.' }),

    stone_count: col.int(),
    /** Hallmarking Unique ID — six characters, mandatory on hallmarked pieces. */
    huid: col.text(),
    hallmark_centre: col.text(),

    /** What this piece cost to acquire or make. Drives valuation and margin. */
    cost_value: col.money({ notNull: true, default: '0' }),
    making_cost: col.money({ notNull: true, default: '0' }),
    stone_cost: col.money({ notNull: true, default: '0' }),

    design_id: col.uuid({ comment: 'Filled in once Module 2 exists.' }),
    supplier_id: col.fk('party'),
    received_at: col.timestamptz({ notNull: true, default: 'now()' }),
    sold_at: col.timestamptz(),
    /** Days in stock is the single most useful retail number; derived from received_at. */
    image_urls: col.jsonb({ notNull: true, default: "'[]'::jsonb" }),
    attributes: col.jsonb({ notNull: true, default: "'{}'::jsonb" }),
  },
  uniques: [{ columns: ['tag_number'] }],
  indexes: [
    { columns: ['item_id'] },
    { columns: ['location_id', 'status'] },
    { columns: ['huid'], where: 'huid is not null' },
    { columns: ['status', 'received_at'] },
  ],
});

export const MOVEMENT_DIRECTIONS = ['in', 'out'] as const;
export const MOVEMENT_REASONS = [
  'opening',
  'purchase',
  'purchase_return',
  'sale',
  'sales_return',
  'transfer_out',
  'transfer_in',
  'production_issue',
  'production_receipt',
  'old_gold_intake',
  'melting',
  'adjustment',
  'memo_out',
  'memo_in',
] as const;

export const stockMovementTable = defineTable({
  name: 'stock_movement',
  module: 'inventory',
  comment: 'Append-only. Never updated, never deleted — a mistake is corrected by a reversing row.',
  columns: {
    moved_at: col.timestamptz({ notNull: true, default: 'now()' }),
    direction: col.enum(MOVEMENT_DIRECTIONS, { notNull: true }),
    reason: col.enum(MOVEMENT_REASONS, { notNull: true }),

    item_id: col.fk('item', { notNull: true }),
    purity_id: col.fk('purity'),
    location_id: col.fk('stock_location', { notNull: true }),
    piece_id: col.fk('stock_piece', { comment: 'Set for piece-tracked items, null for bulk metal.' }),

    quantity: col.numeric(14, 3, { notNull: true, default: '0', comment: 'Piece count, or units for consumables.' }),
    gross_weight: col.weight({ notNull: true, default: '0' }),
    net_weight: col.weight({ notNull: true, default: '0' }),
    fine_weight: col.weight({ notNull: true, default: '0' }),
    value: col.money({ notNull: true, default: '0' }),

    /** Which document caused this. Not a FK: the target table varies. */
    source_type: col.text({ notNull: true }),
    source_id: col.uuid({ notNull: true }),
    source_line_id: col.uuid(),

    /** Set on the reversing row when a posted document is cancelled. */
    reverses_movement_id: col.fk('stock_movement'),
    note: col.text(),
  },
  indexes: [
    { columns: ['item_id', 'purity_id', 'location_id', 'moved_at'] },
    { columns: ['source_type', 'source_id'] },
    { columns: ['piece_id'] },
    { columns: ['moved_at'] },
  ],
  checks: [
    { name: 'nothing_negative', expression: 'quantity >= 0 and gross_weight >= 0 and net_weight >= 0' },
  ],
});

export const stockBalanceTable = defineTable({
  name: 'stock_balance',
  module: 'inventory',
  comment: 'A running total, kept in step with stock_movement inside the same transaction.',
  columns: {
    item_id: col.fk('item', { notNull: true }),
    purity_id: col.fk('purity'),
    location_id: col.fk('stock_location', { notNull: true }),

    quantity: col.numeric(14, 3, { notNull: true, default: '0' }),
    gross_weight: col.weight({ notNull: true, default: '0' }),
    net_weight: col.weight({ notNull: true, default: '0' }),
    fine_weight: col.weight({ notNull: true, default: '0' }),
    value: col.money({ notNull: true, default: '0' }),
    /** value / net_weight, kept alongside so valuation reports do not recompute it. */
    average_rate: col.money({ notNull: true, default: '0' }),
    last_movement_at: col.timestamptz(),
  },
  uniques: [{ columns: ['item_id', 'purity_id', 'location_id'], nullsNotDistinct: true }],
  indexes: [{ columns: ['location_id'] }],
});
