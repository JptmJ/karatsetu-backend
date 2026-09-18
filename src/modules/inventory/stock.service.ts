/**
 * Moving stock.
 *
 * Two rules hold everywhere:
 *   1. Nothing writes a balance directly. You append a movement; the balance
 *      follows automatically in the same transaction.
 *   2. A movement is never edited or deleted. Undoing one means writing its
 *      mirror image, linked back to the original.
 */
import type { Tx } from '../../core/db/client.js';
import { BusinessRuleError } from '../../core/errors/app-error.js';
import { add, compare, div, isZero, mul, sub, type Decimal } from '../../core/util/decimal.js';
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
  movedAt?: Date;
  note?: string;
}

interface BalanceRow {
  id: string;
  quantity: Decimal;
  gross_weight: Decimal;
  net_weight: Decimal;
  fine_weight: Decimal;
  value: Decimal;
}

/**
 * Applies a batch of movements atomically. Batching matters: a 40-line invoice
 * should touch the balance table once per item, not once per call.
 */
export async function recordMovements(tx: Tx, movements: MovementInput[]): Promise<string[]> {
  if (movements.length === 0) return [];

  const allowNegative = await getConfig(tx, CONFIG.negativeStock);
  const ids: string[] = [];

  for (const movement of movements) {
    // A piece count on bulk metal would drift meaninglessly negative, so it is
    // simply not kept. The weight is the stock figure for those items.
    const quantity = movement.tracking === 'piece' ? (movement.quantity ?? '0') : '0';
    const grossWeight = movement.grossWeight ?? '0';
    const netWeight = movement.netWeight ?? '0';
    const fine = movement.fineWeight ?? '0';
    const value = movement.value ?? '0';
    const id = newId();

    await tx.query(
      `insert into stock_movement
         (id, tenant_id, moved_at, direction, reason, item_id, purity_id, location_id, piece_id,
          quantity, gross_weight, net_weight, fine_weight, value,
          source_type, source_id, source_line_id, note, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)`,
      [
        id,
        tx.context.tenantId,
        movement.movedAt ?? new Date(),
        movement.direction,
        movement.reason,
        movement.itemId,
        movement.purityId ?? null,
        movement.locationId,
        movement.pieceId ?? null,
        quantity,
        grossWeight,
        netWeight,
        fine,
        value,
        movement.sourceType,
        movement.sourceId,
        movement.sourceLineId ?? null,
        movement.note ?? null,
        tx.context.userId,
      ],
    );

    await applyToBalance(tx, movement, { quantity, grossWeight, netWeight, fine, value }, allowNegative);
    ids.push(id);
  }

  return ids;
}

async function applyToBalance(
  tx: Tx,
  movement: MovementInput,
  amounts: { quantity: Decimal; grossWeight: Decimal; netWeight: Decimal; fine: Decimal; value: Decimal },
  allowNegative: boolean,
): Promise<void> {
  const key = [movement.itemId, movement.purityId ?? null, movement.locationId];

  // `for update` serialises concurrent movements on the same item+location, so
  // two tills selling the last bangle cannot both succeed.
  const existing = await tx.maybeOne<BalanceRow>(
    `select id, quantity, gross_weight, net_weight, fine_weight, value
       from stock_balance
      where item_id = $1 and purity_id is not distinct from $2 and location_id = $3
      for update`,
    key,
  );

  const sign = movement.direction === 'in' ? 1 : -1;
  const shift = (current: Decimal, delta: Decimal): Decimal =>
    sign === 1 ? add(current, delta) : sub(current, delta);

  const current = existing ?? {
    id: newId(),
    quantity: '0',
    gross_weight: '0',
    net_weight: '0',
    fine_weight: '0',
    value: '0',
  };

  const next = {
    quantity: shift(current.quantity, amounts.quantity),
    gross_weight: shift(current.gross_weight, amounts.grossWeight),
    net_weight: shift(current.net_weight, amounts.netWeight),
    fine_weight: shift(current.fine_weight, amounts.fine),
    value: shift(current.value, amounts.value),
  };

  if (!allowNegative && sign === -1) {
    const short =
      movement.tracking === 'piece'
        ? compare(next.quantity, '0') < 0 || compare(next.net_weight, '0') < 0
        : compare(next.net_weight, '0') < 0;

    if (short) {
      const available =
        movement.tracking === 'piece'
          ? `${current.quantity} pcs / ${current.net_weight} g`
          : `${current.net_weight} g`;
      const requested =
        movement.tracking === 'piece'
          ? `${amounts.quantity} pcs / ${amounts.netWeight} g`
          : `${amounts.netWeight} g`;

      throw new BusinessRuleError(
        `Not enough stock. Available: ${available} — tried to remove ${requested}.`,
        'insufficient_stock',
        { itemId: movement.itemId, locationId: movement.locationId, available: current, requested: amounts },
      );
    }
  }

  const averageRate = isZero(next.net_weight) ? '0' : div(next.value, next.net_weight);

  if (existing) {
    await tx.query(
      `update stock_balance
          set quantity = $2, gross_weight = $3, net_weight = $4, fine_weight = $5,
              value = $6, average_rate = $7, last_movement_at = now(), updated_at = now()
        where id = $1`,
      [existing.id, next.quantity, next.gross_weight, next.net_weight, next.fine_weight, next.value, averageRate],
    );
  } else {
    await tx.query(
      `insert into stock_balance
         (id, tenant_id, item_id, purity_id, location_id, quantity, gross_weight, net_weight,
          fine_weight, value, average_rate, last_movement_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, $12)`,
      [
        current.id,
        tx.context.tenantId,
        movement.itemId,
        movement.purityId ?? null,
        movement.locationId,
        next.quantity,
        next.gross_weight,
        next.net_weight,
        next.fine_weight,
        next.value,
        averageRate,
        tx.context.userId,
      ],
    );
  }
}

/** Undoes every movement a document made, by writing their mirror images. */
export async function reverseMovementsFor(tx: Tx, sourceType: string, sourceId: string, note: string): Promise<void> {
  const originals = await tx.query<{
    id: string; direction: MovementDirection; reason: MovementInput['reason'];
    item_id: string; purity_id: string | null; location_id: string; piece_id: string | null;
    quantity: Decimal; gross_weight: Decimal; net_weight: Decimal; fine_weight: Decimal; value: Decimal;
    source_line_id: string | null; tracking: 'lot' | 'piece';
  }>(
    `select sm.*, i.tracking
       from stock_movement sm
       join item i on i.id = sm.item_id
      where sm.source_type = $1 and sm.source_id = $2 and sm.reverses_movement_id is null
        and sm.id not in (select reverses_movement_id from stock_movement
                           where reverses_movement_id is not null and source_id = $2)`,
    [sourceType, sourceId],
  );

  const allowNegative = await getConfig(tx, CONFIG.negativeStock);

  for (const original of originals) {
    const flipped: MovementDirection = original.direction === 'in' ? 'out' : 'in';
    const id = newId();

    await tx.query(
      `insert into stock_movement
         (id, tenant_id, moved_at, direction, reason, item_id, purity_id, location_id, piece_id,
          quantity, gross_weight, net_weight, fine_weight, value,
          source_type, source_id, source_line_id, reverses_movement_id, note, created_by, updated_by)
       values ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)`,
      [
        id, tx.context.tenantId, flipped, original.reason, original.item_id, original.purity_id,
        original.location_id, original.piece_id, original.quantity, original.gross_weight,
        original.net_weight, original.fine_weight, original.value, sourceType, sourceId,
        original.source_line_id, original.id, note, tx.context.userId,
      ],
    );

    await applyToBalance(
      tx,
      {
        direction: flipped,
        reason: original.reason,
        itemId: original.item_id,
        tracking: original.tracking,
        purityId: original.purity_id,
        locationId: original.location_id,
        sourceType,
        sourceId,
      },
      {
        quantity: original.quantity,
        grossWeight: original.gross_weight,
        netWeight: original.net_weight,
        fine: original.fine_weight,
        value: original.value,
      },
      // A reversal must always be allowed through, even into negative stock —
      // refusing it would leave the books in a worse state than the mistake.
      allowNegative || true,
    );
  }
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
