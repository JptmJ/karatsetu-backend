/**
 * Moving stock.
 *
 * Two rules hold everywhere:
 *   1. Nothing writes a balance directly. You append movements; the balances
 *      follow in the same transaction.
 *   2. A movement is never edited or deleted. Undoing one means writing its
 *      mirror image, linked back to the original.
 *
 * However many lines a document has, posting it is two statements: one insert
 * of every movement, and one upsert that adds each item + purity + location's
 * change to its balance. The upsert locks each balance row it touches, so two
 * counters selling the last bangle cannot both succeed.
 */
import type { Tx } from '../../core/db/client.js';
import { BusinessRuleError } from '../../core/errors/app-error.js';
import { add, compare, div, isZero, sub, type Decimal } from '../../core/util/decimal.js';
import { newId } from '../../core/util/id.js';
import { CONFIG } from '../../core/config/definitions.js';
import { getConfig } from '../../core/config/config-service.js';

export type MovementDirection = 'in' | 'out';

export interface MovementInput {
  direction: MovementDirection;
  reason:
    | 'opening' | 'purchase' | 'purchase_return' | 'sale' | 'sales_return'
    | 'transfer_out' | 'transfer_in' | 'production_issue' | 'production_receipt'
    | 'old_gold_intake' | 'melting' | 'adjustment' | 'memo_out' | 'memo_in';
  itemId: string;
  /**
   * How this item is counted. `lot` items (bulk metal, findings) are measured
   * in grams and have no meaningful piece count — you buy 100g once and sell it
   * across thirty bills. `piece` items are individually tagged and counted.
   * Getting this wrong makes a full vault look empty, so it is required.
   */
  tracking: 'lot' | 'piece';
  purityId?: string | null;
  locationId: string;
  pieceId?: string | null;
  quantity?: Decimal;
  grossWeight?: Decimal;
  netWeight?: Decimal;
  fineWeight?: Decimal;
  value?: Decimal;
  sourceType: string;
  sourceId: string;
  sourceLineId?: string | null;
  reversesMovementId?: string | null;
  movedAt?: Date;
  note?: string;
}

const COLUMNS = 20;
const neg = (d: Decimal): Decimal => sub('0', d);

/** Records movements and updates balances. Refuses to take stock below zero unless the business allows it. */
export async function recordMovements(
  tx: Tx, movements: MovementInput[], options: { allowNegative?: boolean } = {},
): Promise<string[]> {
  if (movements.length === 0) return [];
  const allowNegative = options.allowNegative ?? (await getConfig(tx, CONFIG.negativeStock));

  const rows = movements.map((m) => ({
    ...m,
    id: newId(),
    // A piece count on bulk metal would drift meaninglessly negative, so it is not kept.
    quantity: m.tracking === 'piece' ? (m.quantity ?? '0') : '0',
    grossWeight: m.grossWeight ?? '0',
    netWeight: m.netWeight ?? '0',
    fineWeight: m.fineWeight ?? '0',
    value: m.value ?? '0',
  }));

  for (let start = 0; start < rows.length; start += 500) {
    const params: unknown[] = [];
    const tuples = rows.slice(start, start + 500).map((m) => {
      params.push(
        m.id, tx.context.tenantId, m.movedAt ?? new Date(), m.direction, m.reason, m.itemId, m.purityId ?? null,
        m.locationId, m.pieceId ?? null, m.quantity, m.grossWeight, m.netWeight, m.fineWeight, m.value,
        m.sourceType, m.sourceId, m.sourceLineId ?? null, m.reversesMovementId ?? null, m.note ?? null, tx.context.userId,
      );
      const base = params.length - COLUMNS;
      return `(${Array.from({ length: COLUMNS }, (_, i) => `$${base + i + 1}`).join(', ')}, $${base + COLUMNS})`;
    });
    await tx.query(
      `insert into stock_movement
         (id, tenant_id, moved_at, direction, reason, item_id, purity_id, location_id, piece_id,
          quantity, gross_weight, net_weight, fine_weight, value,
          source_type, source_id, source_line_id, reverses_movement_id, note, created_by, updated_by)
       values ${tuples.join(', ')}`,
      params,
    );
  }

  // One signed change per balance row, applied in a fixed order so two
  // documents touching the same rows never deadlock.
  const changes = new Map<string, {
    itemId: string; purityId: string | null; locationId: string; tracking: 'lot' | 'piece'; out: boolean;
    quantity: Decimal; gross: Decimal; net: Decimal; fine: Decimal; value: Decimal;
  }>();
  for (const m of rows) {
    const k = `${m.itemId}|${m.purityId ?? ''}|${m.locationId}`;
    const c = changes.get(k) ?? {
      itemId: m.itemId, purityId: m.purityId ?? null, locationId: m.locationId, tracking: m.tracking, out: false,
      quantity: '0', gross: '0', net: '0', fine: '0', value: '0',
    };
    const signed = m.direction === 'in' ? (d: Decimal) => d : neg;
    c.out ||= m.direction === 'out';
    c.quantity = add(c.quantity, signed(m.quantity));
    c.gross = add(c.gross, signed(m.grossWeight));
    c.net = add(c.net, signed(m.netWeight));
    c.fine = add(c.fine, signed(m.fineWeight));
    c.value = add(c.value, signed(m.value));
    changes.set(k, c);
  }
  const ordered = [...changes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, c]) => c);

  const params: unknown[] = [];
  const tuples = ordered.map((c) => {
    params.push(
      newId(), tx.context.tenantId, c.itemId, c.purityId, c.locationId, c.quantity, c.gross, c.net, c.fine, c.value,
      isZero(c.net) ? '0' : div(c.value, c.net), tx.context.userId,
    );
    const b = params.length - 12;
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, now(), $${b + 12}, $${b + 12})`;
  });
  const balances = await tx.query<{
    item_id: string; purity_id: string | null; location_id: string; quantity: Decimal; net_weight: Decimal;
  }>(
    `insert into stock_balance as b
       (id, tenant_id, item_id, purity_id, location_id, quantity, gross_weight, net_weight, fine_weight, value,
        average_rate, last_movement_at, created_by, updated_by)
     values ${tuples.join(', ')}
     on conflict (tenant_id, item_id, purity_id, location_id) do update set
       quantity = b.quantity + excluded.quantity,
       gross_weight = b.gross_weight + excluded.gross_weight,
       net_weight = b.net_weight + excluded.net_weight,
       fine_weight = b.fine_weight + excluded.fine_weight,
       value = b.value + excluded.value,
       average_rate = case when b.net_weight + excluded.net_weight = 0 then 0
                           else (b.value + excluded.value) / (b.net_weight + excluded.net_weight) end,
       last_movement_at = now(), updated_at = now(), updated_by = excluded.updated_by
     returning item_id, purity_id, location_id, quantity, net_weight`,
    params,
  );

  if (!allowNegative) {
    for (const c of ordered) {
      if (!c.out) continue;
      const after = balances.find((b) => b.item_id === c.itemId && b.purity_id === c.purityId && b.location_id === c.locationId)!;
      const short = compare(after.net_weight, '0') < 0 || (c.tracking === 'piece' && compare(after.quantity, '0') < 0);
      if (!short) continue;
      const available = c.tracking === 'piece'
        ? `${sub(after.quantity, c.quantity)} pcs / ${sub(after.net_weight, c.net)} g`
        : `${sub(after.net_weight, c.net)} g`;
      const requested = c.tracking === 'piece' ? `${neg(c.quantity)} pcs / ${neg(c.net)} g` : `${neg(c.net)} g`;
      throw new BusinessRuleError(
        `Not enough stock. Available: ${available} — tried to remove ${requested}.`,
        'insufficient_stock',
        { itemId: c.itemId, locationId: c.locationId, available, requested },
      );
    }
  }

  return rows.map((m) => m.id);
}

/** Undoes every movement a document made, by writing their mirror images. */
export async function reverseMovementsFor(tx: Tx, sourceType: string, sourceId: string, note: string): Promise<void> {
  const originals = await tx.query<{
    id: string; direction: MovementDirection; reason: MovementInput['reason']; tracking: 'lot' | 'piece';
    item_id: string; purity_id: string | null; location_id: string; piece_id: string | null;
    quantity: Decimal; gross_weight: Decimal; net_weight: Decimal; fine_weight: Decimal; value: Decimal;
    source_line_id: string | null;
  }>(
    `select sm.*, i.tracking
       from stock_movement sm
       join item i on i.id = sm.item_id
      where sm.source_type = $1 and sm.source_id = $2 and sm.reverses_movement_id is null
        and not exists (select 1 from stock_movement r where r.reverses_movement_id = sm.id)`,
    [sourceType, sourceId],
  );

  // A reversal must always go through, even into negative stock — refusing it
  // would leave the books in a worse state than the mistake.
  await recordMovements(tx, originals.map((o) => ({
    direction: o.direction === 'in' ? 'out' as const : 'in' as const,
    reason: o.reason, tracking: o.tracking, itemId: o.item_id, purityId: o.purity_id, locationId: o.location_id,
    pieceId: o.piece_id, quantity: o.quantity, grossWeight: o.gross_weight, netWeight: o.net_weight,
    fineWeight: o.fine_weight, value: o.value, sourceType, sourceId, sourceLineId: o.source_line_id,
    reversesMovementId: o.id, note,
  })), { allowNegative: true });
}

/** Rebuilds stock_balance from the movement journal. The safety net. */
export async function rebuildBalances(tx: Tx): Promise<number> {
  await tx.query(`delete from stock_balance`);
  const { rowCount } = await tx.raw.query(
    `insert into stock_balance
       (id, tenant_id, item_id, purity_id, location_id, quantity, gross_weight, net_weight,
        fine_weight, value, average_rate, last_movement_at, created_at, updated_at)
     select gen_random_uuid(), tenant_id, item_id, purity_id, location_id,
            sum(case when direction = 'in' then quantity else -quantity end),
            sum(case when direction = 'in' then gross_weight else -gross_weight end),
            sum(case when direction = 'in' then net_weight else -net_weight end),
            sum(case when direction = 'in' then fine_weight else -fine_weight end),
            sum(case when direction = 'in' then value else -value end),
            case when sum(case when direction = 'in' then net_weight else -net_weight end) = 0 then 0
                 else sum(case when direction = 'in' then value else -value end)
                      / sum(case when direction = 'in' then net_weight else -net_weight end) end,
            max(moved_at), now(), now()
       from stock_movement
      group by tenant_id, item_id, purity_id, location_id`,
  );
  return rowCount ?? 0;
}
