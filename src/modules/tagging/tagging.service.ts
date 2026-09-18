/**
 * Tagging a piece.
 *
 * The rule this exists to enforce: **a piece row and a stock movement are
 * created together, always.** Writing one without the other leaves a piece
 * sitting in the vault that the balance says does not exist — which is exactly
 * the kind of discrepancy this system is supposed to make impossible.
 *
 * Where the piece came from decides the movement reason:
 *   - already bought on a purchase invoice → the purchase already raised the
 *     stock, so tagging only re-labels it and moves nothing
 *   - anything else (opening stock, production, a remake) → an `in` movement
 */
import type { Tx } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { BusinessRuleError } from '../../core/errors/app-error.js';
import { compare, div, mul, sub, type Decimal } from '../../core/util/decimal.js';
import { nextDocumentNumber } from '../numbering/numbering.service.js';
import { recordMovements } from '../inventory/stock.service.js';

export interface TagPieceInput {
  itemId: string;
  purityId: string;
  locationId: string;
  grossWeight: Decimal;
  stoneWeight?: Decimal;
  otherWeight?: Decimal;
  stoneCount?: number;
  stoneValue?: Decimal;
  huid?: string;
  hallmarkCentre?: string;
  costValue?: Decimal;
  makingCost?: Decimal;
  supplierId?: string;
  tagNumber?: string;
  /**
   * Why this piece is appearing. `purchase` means a purchase invoice already
   * raised the stock, so no movement is written.
   */
  origin?: 'opening' | 'purchase' | 'production_receipt' | 'sales_return';
  sourceType?: string;
  sourceId?: string;
}

export async function tagPiece(tx: Tx, input: TagPieceInput) {
  const stone = input.stoneWeight ?? '0';
  const other = input.otherWeight ?? '0';
  const net = sub(sub(input.grossWeight, stone), other);

  if (compare(net, '0') < 0) {
    throw new BusinessRuleError(
      `Stones (${stone}g) and other weight (${other}g) add up to more than the gross weight (${input.grossWeight}g).`,
      'weights_inconsistent',
    );
  }

  const purity = await tx.one<{ fineness_percent: Decimal; metal_id: string }>(
    `select fineness_percent, metal_id from purity where id = $1`, [input.purityId],
  );
  const fine = div(mul(net, purity.fineness_percent), '100');
  const tagNumber = input.tagNumber ?? (await nextDocumentNumber(tx, 'tag')).number;

  const piece = await repo<{ id: string }>(tx, 'stock_piece').insert({
    tag_number: tagNumber,
    item_id: input.itemId,
    purity_id: input.purityId,
    location_id: input.locationId,
    gross_weight: input.grossWeight,
    stone_weight: stone,
    other_weight: other,
    net_weight: net,
    fine_weight: fine,
    stone_count: input.stoneCount ?? null,
    stone_cost: input.stoneValue ?? '0',
    huid: input.huid ?? null,
    hallmark_centre: input.hallmarkCentre ?? null,
    cost_value: input.costValue ?? '0',
    making_cost: input.makingCost ?? '0',
    supplier_id: input.supplierId ?? null,
    status: 'in_stock',
  });

  if (input.huid) {
    await repo(tx, 'huid_assignment').insert({
      piece_id: piece.id,
      huid: input.huid,
      hallmark_centre_name: input.hallmarkCentre ?? null,
      certified_purity_percent: purity.fineness_percent,
      assigned_by: tx.context.userId,
    });
  }

  const origin = input.origin ?? 'opening';
  if (origin !== 'purchase') {
    await recordMovements(tx, [{
      direction: 'in',
      reason: origin === 'production_receipt' ? 'production_receipt' : origin === 'sales_return' ? 'sales_return' : 'opening',
      itemId: input.itemId,
      tracking: 'piece',
      purityId: input.purityId,
      locationId: input.locationId,
      pieceId: piece.id,
      quantity: '1',
      grossWeight: input.grossWeight,
      netWeight: net,
      fineWeight: fine,
      value: input.costValue ?? '0',
      sourceType: input.sourceType ?? 'stock_piece',
      sourceId: input.sourceId ?? piece.id,
      note: `Tagged ${tagNumber}`,
    }]);
  }

  return piece;
}
