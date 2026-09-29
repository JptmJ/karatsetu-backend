/**
 * Stock count — the physical check of one location.
 *
 * Staff scan every tag they can see and weigh each lot. The count compares
 * that with the books: pieces found, pieces missing, pieces that belong to
 * another location, tags nobody knows, and the weight difference on each lot.
 * Posting it (manager only) makes the books match the shelf in one adjustment.
 */
import type { Tx } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { BusinessRuleError } from '../../core/errors/app-error.js';
import { compare, isZero, sub, type Decimal } from '../../core/util/decimal.js';
import { reserveDocumentNumbers } from '../numbering/numbering.service.js';
import { lotMovements, postAdjustment, type AdjustmentMovement } from './adjustment.service.js';

type Count = { id: string; doc_number: string; status: string; branch_id: string; location_id: string };

async function openCount(tx: Tx, id: string): Promise<Count> {
  const count = await tx.one<Count>(`select * from stock_count where id = $1 for update`, [id]);
  if (count.status !== 'open') throw new BusinessRuleError(`${count.doc_number} is already ${count.status}.`, 'count_not_open');
  return count;
}

export async function startCount(tx: Tx, input: { locationId: string; note?: string }) {
  const location = await tx.maybeOne<{ branch_id: string; kind: string }>(
    `select branch_id, kind from stock_location where id = $1 and is_active and deleted_at is null`, [input.locationId]);
  if (!location) throw new BusinessRuleError('That location does not exist or is inactive.', 'not_found');
  const running = await tx.maybeOne<{ doc_number: string }>(
    `select doc_number from stock_count where location_id = $1 and status = 'open'`, [input.locationId]);
  if (running) throw new BusinessRuleError(`${running.doc_number} is already counting this location — continue that one.`, 'count_already_open');
  const { numbers: [docNumber] } = await reserveDocumentNumbers(tx, 'stock_count', 1, { branchId: location.branch_id });
  return repo(tx, 'stock_count').insert({
    doc_number: docNumber, branch_id: location.branch_id, location_id: input.locationId, note: input.note ?? null,
  });
}

/** Records scanned tags. A tag scanned twice counts once. Returns what each tag turned out to be. */
export async function scanTags(tx: Tx, id: string, tags: string[]) {
  const count = await openCount(tx, id);
  const unique = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  return tx.query(
    `with scanned as (select unnest($2::text[]) as tag_number),
     classified as (
       select s.tag_number, p.id as piece_id,
              case when p.id is null or p.status <> 'in_stock' then 'unknown'
                   when p.location_id = $3 then 'found' else 'elsewhere' end as outcome
         from scanned s left join stock_piece p on p.tag_number = s.tag_number
     ),
     inserted as (
       insert into stock_count_line (id, tenant_id, stock_count_id, kind, tag_number, piece_id, outcome, created_by, updated_by)
       select gen_random_uuid(), $4, $1, 'piece', tag_number, piece_id, outcome, $5, $5 from classified
       on conflict (tenant_id, stock_count_id, tag_number) do nothing returning tag_number
     )
     select c.tag_number, c.outcome, (i.tag_number is null) as repeated
       from classified c left join inserted i on i.tag_number = c.tag_number`,
    [count.id, unique, count.location_id, tx.context.tenantId, tx.context.userId]);
}

/** Records (or corrects) the weight on the scale for one lot. */
export async function weighLot(tx: Tx, id: string, input: { itemId: string; purityId: string; netWeight: Decimal }) {
  const count = await openCount(tx, id);
  if (compare(input.netWeight, '0') < 0) throw new BusinessRuleError('Weight cannot be negative.', 'weight_required');
  return tx.one(
    `insert into stock_count_line (id, tenant_id, stock_count_id, kind, outcome, item_id, purity_id, counted_net_weight, created_by, updated_by)
     values (gen_random_uuid(), $1, $2, 'lot', 'lot', $3, $4, $5, $6, $6)
     on conflict (tenant_id, stock_count_id, item_id, purity_id) where kind = 'lot' do update
       set counted_net_weight = excluded.counted_net_weight, updated_at = now(), updated_by = excluded.updated_by
     returning *`,
    [tx.context.tenantId, count.id, input.itemId, input.purityId, input.netWeight, tx.context.userId]);
}

export async function removeCountLine(tx: Tx, id: string, lineId: string) {
  await openCount(tx, id);
  await tx.query(`delete from stock_count_line where id = $1 and stock_count_id = $2`, [lineId, id]);
}

/** The count against the books. Everything the screen and the posting need, in three queries. */
export async function countResult(tx: Tx, id: string) {
  const count = await tx.one<Count & Record<string, unknown>>(
    `select c.*, l.name as location_name, b.name as branch_name
       from stock_count c join stock_location l on l.id = c.location_id join branch b on b.id = c.branch_id where c.id = $1`, [id]);
  const [pieces, lots] = await Promise.all([
    // Every scanned tag, plus every piece the books put here that was not scanned (missing).
    tx.query<{ line_id: string | null; tag_number: string; outcome: string; piece_id: string | null; item_name: string | null;
      purity_code: string | null; gross_weight: Decimal | null; net_weight: Decimal | null; location_name: string | null; location_branch_id: string | null }>(
      `select l.id as line_id, coalesce(l.tag_number, p.tag_number) as tag_number,
              coalesce(l.outcome::text, 'missing') as outcome, p.id as piece_id, i.name as item_name, pu.code as purity_code,
              p.gross_weight, p.net_weight, loc.name as location_name, loc.branch_id as location_branch_id
         from (select * from stock_count_line where stock_count_id = $1 and kind = 'piece') l
         full join (select * from stock_piece where location_id = $2 and status = 'in_stock') here on here.id = l.piece_id
         left join stock_piece p on p.id = coalesce(l.piece_id, here.id)
         left join item i on i.id = p.item_id left join purity pu on pu.id = p.purity_id
         left join stock_location loc on loc.id = p.location_id
        order by 3, 2`, [id, count.location_id]),
    // Every lot on the books here, plus every lot weighed, with the difference.
    tx.query<{ line_id: string | null; item_id: string; purity_id: string; item_name: string; purity_code: string;
      book_net_weight: Decimal; counted_net_weight: Decimal | null }>(
      `select l.id as line_id, coalesce(l.item_id, b.item_id) as item_id, coalesce(l.purity_id, b.purity_id) as purity_id,
              i.name as item_name, pu.code as purity_code, coalesce(b.net_weight, 0) as book_net_weight, l.counted_net_weight
         from (select * from stock_count_line where stock_count_id = $1 and kind = 'lot') l
         full join (select sb.* from stock_balance sb join item it on it.id = sb.item_id
                     where sb.location_id = $2 and it.tracking = 'lot' and sb.net_weight <> 0) b
           on b.item_id = l.item_id and b.purity_id = l.purity_id
         join item i on i.id = coalesce(l.item_id, b.item_id) join purity pu on pu.id = coalesce(l.purity_id, b.purity_id)
        order by i.name, pu.code`, [id, count.location_id]),
  ]);
  const tally = (o: string) => pieces.filter((p) => p.outcome === o).length;
  return {
    count, pieces, lots,
    summary: {
      found: tally('found'), missing: tally('missing'), elsewhere: tally('elsewhere'), unknown: tally('unknown'),
      lotsWeighed: lots.filter((l) => l.counted_net_weight !== null).length, lotsTotal: lots.length,
    },
  };
}

/**
 * Makes the books match the shelf. Missing pieces are written off only when
 * asked (they often turn up at another counter). Pieces from another location
 * of the same branch are moved here. Weighed lots are set to what the scale said;
 * lots not weighed are left alone.
 */
export async function postCount(tx: Tx, id: string, input: { writeOffMissing: boolean; note: string }) {
  const count = await openCount(tx, id);
  const { pieces, lots } = await countResult(tx, id);
  const moveHere = pieces.filter((p) => p.outcome === 'elsewhere' && p.location_branch_id === count.branch_id);
  const missing = input.writeOffMissing ? pieces.filter((p) => p.outcome === 'missing') : [];
  const pieceIds = [...moveHere, ...missing].map((p) => p.piece_id!);
  const rows = pieceIds.length ? await tx.query<{ id: string; item_id: string; purity_id: string; location_id: string;
    gross_weight: Decimal; net_weight: Decimal; fine_weight: Decimal; cost_value: Decimal }>(
    `select * from stock_piece where id = any($1::uuid[]) and status = 'in_stock' for update`, [pieceIds]) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pieceMove = (id: string, direction: 'in' | 'out', locationId: string): AdjustmentMovement[] => {
    const p = byId.get(id);
    return p ? [{ direction, tracking: 'piece', itemId: p.item_id, purityId: p.purity_id, locationId, pieceId: p.id,
      quantity: '1', grossWeight: p.gross_weight, netWeight: p.net_weight, fineWeight: p.fine_weight, value: p.cost_value }] : [];
  };

  const lotDiffs = lots.filter((l) => l.counted_net_weight !== null).map((l) => ({ ...l, diff: sub(l.counted_net_weight!, l.book_net_weight) }))
    .filter((l) => !isZero(l.diff));
  const toLine = (l: (typeof lotDiffs)[number]) => ({ itemId: l.item_id, purityId: l.purity_id, locationId: count.location_id, netWeight: l.diff.replace('-', '') });
  const movements: AdjustmentMovement[] = [
    ...moveHere.flatMap((p) => [...pieceMove(p.piece_id!, 'out', byId.get(p.piece_id!)?.location_id ?? count.location_id), ...pieceMove(p.piece_id!, 'in', count.location_id)]),
    ...missing.flatMap((p) => pieceMove(p.piece_id!, 'out', count.location_id)),
    ...await lotMovements(tx, lotDiffs.filter((l) => compare(l.diff, '0') > 0).map(toLine), 'in'),
    ...await lotMovements(tx, lotDiffs.filter((l) => compare(l.diff, '0') < 0).map(toLine), 'out'),
  ];

  let adjustmentId: string | null = null;
  if (movements.length) {
    const adjustment = await postAdjustment(tx, {
      branchId: count.branch_id, reason: 'stock_count', note: `${count.doc_number}: ${input.note}`,
      sourceType: 'stock_count', sourceId: count.id, movements,
    });
    adjustmentId = adjustment.id;
    if (moveHere.length) {
      await tx.query(`update stock_piece set location_id = $2, updated_at = now(), updated_by = $3 where id = any($1::uuid[])`,
        [moveHere.map((p) => p.piece_id), count.location_id, tx.context.userId]);
    }
    if (missing.length) {
      await tx.query(`update stock_piece set status = 'written_off', updated_at = now(), updated_by = $2 where id = any($1::uuid[])`,
        [missing.map((p) => p.piece_id), tx.context.userId]);
    }
  }
  return tx.one(
    `update stock_count set status = 'posted', posted_at = now(), posted_by = $2, adjustment_id = $3, updated_at = now(), updated_by = $2
      where id = $1 returning *`, [id, tx.context.userId, adjustmentId]);
}

export async function cancelCount(tx: Tx, id: string) {
  await openCount(tx, id);
  return tx.one(`update stock_count set status = 'cancelled', updated_at = now(), updated_by = $2 where id = $1 returning *`, [id, tx.context.userId]);
}
