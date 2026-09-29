/**
 * Module 4 — tagging a piece: its weights, purity, HUID and tag number.
 *
 * A tagged piece and its stock always move together: creating a piece writes
 * the matching stock movement in the same transaction, so a piece can never be
 * in the vault while the balance says it does not exist.
 */
import type { Tx } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { BusinessRuleError } from '../../core/errors/app-error.js';
import { compare, div, mul, sub, sum, type Decimal } from '../../core/util/decimal.js';
import { reserveDocumentNumbers } from '../numbering/numbering.service.js';
import { recordMovements } from '../inventory/stock.service.js';
import { postAdjustment } from '../inventory/adjustment.service.js';

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
  /** Leave out to take the next number from Masters → Bill Numbers → Item Tag. */
  tagNumber?: string;
}

/** Why pieces are appearing. `purchase` writes no movement: the receipt already raised the stock. */
export type TagOrigin = 'opening' | 'purchase' | 'production_receipt' | 'sales_return';

interface Prepared extends TagPieceInput { net: Decimal; fine: Decimal; stone: Decimal; other: Decimal; fineness: Decimal }

export const HUID_PATTERN = /^[A-Z0-9]{6}$/;

/**
 * preparePieces catches a duplicate before saving. Two counters saving the same
 * tag number or HUID at the same instant are stopped by the database; this says which.
 */
const explainDuplicate = (saving: { huids: (string | undefined)[]; tags: (string | undefined)[] }) => (error: unknown): never => {
  const e = error as { code?: string; constraint?: string };
  // Row-level security keeps the clashing value out of the database's message, so name what was being saved.
  const list = (values: (string | undefined)[]) => values.filter(Boolean).join(', ');
  if (e.code === '23505' && e.constraint === 'ux_stock_piece_huid') {
    throw new BusinessRuleError(`HUID ${list(saving.huids)} was just saved on another piece by someone else.`, 'huid_taken');
  }
  if (e.code === '23505' && e.constraint?.endsWith('_tag_number')) {
    throw new BusinessRuleError(`Tag number ${list(saving.tags)} was just used for another piece by someone else.`, 'tag_number_taken');
  }
  throw error;
};

/**
 * Checks every piece before anything is written, and says what is wrong with
 * each one by its position — the tag form shows the first, an import shows all.
 */
export async function preparePieces(
  tx: Tx, inputs: TagPieceInput[], name: (index: number) => string = (i) => `piece ${i + 1}`,
): Promise<{ ready: { index: number; piece: Prepared }[]; errors: { index: number; message: string }[] }> {
  const ids = (pick: (i: TagPieceInput) => string | undefined) => [...new Set(inputs.map(pick).filter((v): v is string => Boolean(v)))];
  // Everything the checks need, in one round trip.
  const found = await tx.one<{
    items: { id: string; name: string; tracking: string; metal_id: string | null; is_active: boolean }[];
    purities: { id: string; metal_id: string; fineness_percent: Decimal }[];
    locations: string[]; huids: string[]; tags: string[];
  }>(
    `select
       (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'tracking', tracking, 'metal_id', metal_id, 'is_active', is_active)), '[]')
          from item where id = any($1::uuid[]) and deleted_at is null) as items,
       (select coalesce(json_agg(json_build_object('id', id, 'metal_id', metal_id, 'fineness_percent', fineness_percent::text)), '[]')
          from purity where id = any($2::uuid[]) and is_active) as purities,
       (select coalesce(json_agg(id), '[]') from stock_location where id = any($3::uuid[]) and is_active and deleted_at is null) as locations,
       (select coalesce(json_agg(huid), '[]') from stock_piece where huid = any($4::text[]) and status not in ('melted', 'written_off')) as huids,
       (select coalesce(json_agg(tag_number), '[]') from stock_piece where tag_number = any($5::text[])) as tags`,
    [ids((i) => i.itemId), ids((i) => i.purityId), ids((i) => i.locationId), ids((i) => i.huid?.trim().toUpperCase()), ids((i) => i.tagNumber?.trim())]);
  const item = new Map(found.items.map((r) => [r.id, r]));
  const purity = new Map(found.purities.map((r) => [r.id, r]));
  const location = new Set(found.locations);
  const huids = new Set(found.huids);
  const tags = new Set(found.tags);

  const ready: { index: number; piece: Prepared }[] = [];
  const errors: { index: number; message: string }[] = [];
  /** First piece in this batch to use each HUID and tag number. */
  const batch = { huids: new Map<string, number>(), tags: new Map<string, number>() };
  inputs.forEach((input, index) => {
    const fail = (message: string) => errors.push({ index, message });
    const it = item.get(input.itemId);
    const pu = purity.get(input.purityId);
    if (!it || !it.is_active) return fail('That item does not exist or is inactive.');
    if (it.tracking !== 'piece') return fail(`${it.name} is counted by weight (a lot item) and is not tagged.`);
    if (!pu) return fail('That purity does not exist or is inactive.');
    if (it.metal_id && it.metal_id !== pu.metal_id) return fail(`That purity is for a different metal than ${it.name}.`);
    if (!location.has(input.locationId)) return fail('That stock location does not exist or is inactive.');
    if (!(compare(input.grossWeight, '0') > 0)) return fail('Gross weight must be more than 0 g.');
    const stone = input.stoneWeight ?? '0';
    const other = input.otherWeight ?? '0';
    const net = sub(sub(input.grossWeight, stone), other);
    if (compare(net, '0') < 0) {
      return fail(`Stones (${stone} g) and other weight (${other} g) add up to more than the gross weight (${input.grossWeight} g).`);
    }
    const huid = input.huid?.trim().toUpperCase() || undefined;
    if (huid && !HUID_PATTERN.test(huid)) return fail('HUID is 6 letters or digits.');
    if (huid && huids.has(huid)) return fail(`HUID ${huid} is already on another piece.`);
    if (huid && batch.huids.has(huid)) return fail(`HUID ${huid} is repeated on ${name(batch.huids.get(huid)!)}.`);
    const tagNumber = input.tagNumber?.trim() || undefined;
    if (tagNumber && tags.has(tagNumber)) return fail(`Tag number ${tagNumber} is already used.`);
    if (tagNumber && batch.tags.has(tagNumber)) return fail(`Tag number ${tagNumber} is repeated on ${name(batch.tags.get(tagNumber)!)}.`);
    if (huid) batch.huids.set(huid, index);
    if (tagNumber) batch.tags.set(tagNumber, index);
    ready.push({
      index,
      piece: { ...input, huid, tagNumber, stone, other, net, fineness: pu.fineness_percent, fine: div(mul(net, pu.fineness_percent), '100') },
    });
  });
  return { ready, errors };
}

/** Creates the pieces, their HUID records and the stock that comes with them. Returns them in input order. */
export async function tagPieces(
  tx: Tx, pieces: Prepared[], origin: TagOrigin, source?: { type: string; id: string },
): Promise<Array<Record<string, unknown> & { id: string; tag_number: string }>> {
  if (pieces.length === 0) return [];
  const untagged = pieces.filter((p) => !p.tagNumber);
  const { numbers } = untagged.length ? await reserveDocumentNumbers(tx, 'tag', untagged.length) : { numbers: [] };
  untagged.forEach((p, i) => { p.tagNumber = numbers[i]; });

  const created = await repo<Record<string, unknown> & { id: string; tag_number: string }>(tx, 'stock_piece').insertMany(
    pieces.map((p) => ({
      tag_number: p.tagNumber,
      item_id: p.itemId,
      purity_id: p.purityId,
      location_id: p.locationId,
      gross_weight: p.grossWeight,
      stone_weight: p.stone,
      other_weight: p.other,
      net_weight: p.net,
      fine_weight: p.fine,
      stone_count: p.stoneCount ?? null,
      stone_cost: p.stoneValue ?? '0',
      huid: p.huid ?? null,
      hallmark_centre: p.hallmarkCentre ?? null,
      cost_value: p.costValue ?? '0',
      making_cost: p.makingCost ?? '0',
      supplier_id: p.supplierId ?? null,
      status: 'in_stock',
    })),
  ).catch(explainDuplicate({ huids: pieces.map((p) => p.huid), tags: pieces.map((p) => p.tagNumber) }));

  if (pieces.some((p) => p.huid)) {
    await repo(tx, 'huid_assignment').insertMany(created.flatMap((c, i) => {
      const p = pieces[i]!;
      return p.huid ? [{
        piece_id: c.id, huid: p.huid, hallmark_centre_name: p.hallmarkCentre ?? null,
        certified_purity_percent: p.fineness, assigned_by: tx.context.userId,
      }] : [];
    }));
  }

  if (origin !== 'purchase') {
    await recordMovements(tx, created.map((c, i) => {
      const p = pieces[i]!;
      return {
        direction: 'in' as const,
        reason: origin,
        itemId: p.itemId,
        tracking: 'piece' as const,
        purityId: p.purityId,
        locationId: p.locationId,
        pieceId: c.id,
        quantity: '1',
        grossWeight: p.grossWeight,
        netWeight: p.net,
        fineWeight: p.fine,
        value: sum([p.costValue ?? '0']),
        sourceType: source?.type ?? 'stock_piece',
        sourceId: source?.id ?? c.id,
        note: `Tagged ${c.tag_number}`,
      };
    }));
  }
  return created;
}

/** Adds or replaces a piece's HUID — typically when it comes back from the hallmarking centre. */
export async function assignHuid(tx: Tx, pieceId: string, input: { huid: string; hallmarkCentre?: string }) {
  const huid = input.huid.trim().toUpperCase();
  if (!HUID_PATTERN.test(huid)) throw new BusinessRuleError('HUID is 6 letters or digits.', 'huid_invalid');
  const piece = await tx.one<{ id: string; huid: string | null; status: string; fineness: Decimal }>(
    `select p.id, p.huid, p.status, pu.fineness_percent as fineness
       from stock_piece p left join purity pu on pu.id = p.purity_id where p.id = $1 for update of p`, [pieceId]);
  if (['sold', 'melted', 'written_off'].includes(piece.status)) {
    throw new BusinessRuleError('This piece is no longer in stock.', 'piece_not_in_stock');
  }
  if (piece.huid === huid) return piece;
  const clash = await tx.maybeOne(
    `select 1 from stock_piece where huid = $1 and id <> $2 and status not in ('melted', 'written_off')`, [huid, pieceId]);
  if (clash) throw new BusinessRuleError(`HUID ${huid} is already on another piece.`, 'huid_taken');

  await tx.query(
    `update huid_assignment set superseded_at = now(), supersede_reason = 'Replaced by a new HUID'
      where piece_id = $1 and superseded_at is null`, [pieceId]);
  await repo(tx, 'huid_assignment').insert({
    piece_id: pieceId, huid, hallmark_centre_name: input.hallmarkCentre ?? null,
    certified_purity_percent: piece.fineness, assigned_by: tx.context.userId,
  });
  return tx.one(
    `update stock_piece set huid = $2, hallmark_centre = coalesce($3, hallmark_centre), updated_at = now(), updated_by = $4
      where id = $1 returning *`, [pieceId, huid, input.hallmarkCentre ?? null, tx.context.userId]).catch(explainDuplicate({ huids: [huid], tags: [] }));
}

/**
 * Corrects a piece's weights (a weighing mistake). Stock follows: the old
 * weights go out and the new ones come in, on one adjustment, at the same cost.
 */
export async function correctPieceWeights(
  tx: Tx, pieceId: string, input: { grossWeight: Decimal; stoneWeight?: Decimal; otherWeight?: Decimal; note: string },
) {
  const piece = await tx.one<{
    id: string; tag_number: string; item_id: string; purity_id: string; location_id: string; status: string;
    gross_weight: Decimal; net_weight: Decimal; fine_weight: Decimal; cost_value: Decimal; fineness: Decimal; branch_id: string;
  }>(
    `select p.*, pu.fineness_percent as fineness, l.branch_id
       from stock_piece p join purity pu on pu.id = p.purity_id join stock_location l on l.id = p.location_id
      where p.id = $1 for update of p`, [pieceId]);
  if (piece.status !== 'in_stock') throw new BusinessRuleError('Only a piece in stock can be re-weighed.', 'piece_not_in_stock');
  const stone = input.stoneWeight ?? '0';
  const other = input.otherWeight ?? '0';
  const net = sub(sub(input.grossWeight, stone), other);
  if (!(compare(input.grossWeight, '0') > 0) || compare(net, '0') < 0) {
    throw new BusinessRuleError('Gross weight must be more than 0 g and cover the stones and other weight.', 'weights_inconsistent');
  }
  const fine = div(mul(net, piece.fineness), '100');
  const base = { tracking: 'piece' as const, itemId: piece.item_id, purityId: piece.purity_id, locationId: piece.location_id, pieceId, quantity: '1', value: piece.cost_value };
  await postAdjustment(tx, {
    branchId: piece.branch_id, reason: 'weighing_correction', note: `${piece.tag_number}: ${input.note}`,
    sourceType: 'stock_piece', sourceId: pieceId,
    movements: [
      { ...base, direction: 'out', grossWeight: piece.gross_weight, netWeight: piece.net_weight, fineWeight: piece.fine_weight },
      { ...base, direction: 'in', grossWeight: input.grossWeight, netWeight: net, fineWeight: fine },
    ],
  });
  return tx.one(
    `update stock_piece set gross_weight = $2, stone_weight = $3, other_weight = $4, net_weight = $5, fine_weight = $6,
            updated_at = now(), updated_by = $7
      where id = $1 returning *`,
    [pieceId, input.grossWeight, stone, other, net, fine, tx.context.userId]);
}

/** Tags pieces all-or-nothing: the first problem stops the batch and names the row. */
export async function tagAll(tx: Tx, inputs: TagPieceInput[], origin: TagOrigin, source?: { type: string; id: string }) {
  const { ready, errors } = await preparePieces(tx, inputs);
  if (errors.length) {
    const e = errors[0]!;
    throw new BusinessRuleError(inputs.length > 1 ? `Piece ${e.index + 1}: ${e.message}` : e.message, 'piece_invalid', { errors });
  }
  return tagPieces(tx, ready.map((r) => r.piece), origin, source);
}
