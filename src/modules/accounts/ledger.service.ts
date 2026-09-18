/**
 * Posting to the books.
 *
 * One call writes the voucher, the money entries and the metal entries
 * together, and refuses the whole thing if the money side does not balance.
 * There is no way to post a half-entry, because there is no API for it.
 */
import type { Tx } from '../../core/db/client.js';
import { BusinessRuleError } from '../../core/errors/app-error.js';
import { compare, sub, sum, type Decimal } from '../../core/util/decimal.js';
import { newId } from '../../core/util/id.js';
import { nextDocumentNumber } from '../numbering/numbering.service.js';

export interface MoneyEntry {
  accountCode?: string;
  accountId?: string;
  partyId?: string | null;
  debit?: Decimal;
  credit?: Decimal;
  narration?: string;
  againstType?: string;
  againstId?: string;
}

export interface MetalEntry {
  accountCode?: string;
  accountId?: string;
  partyId?: string | null;
  metalId: string;
  purityId?: string | null;
  grossWeight?: Decimal;
  weightIn?: Decimal;
  weightOut?: Decimal;
  ratePerGram?: Decimal;
  narration?: string;
}

export interface PostingInput {
  voucherType:
    | 'opening' | 'purchase' | 'purchase_return' | 'sale' | 'sales_return' | 'receipt'
    | 'payment' | 'journal' | 'old_gold' | 'scheme' | 'mortgage' | 'production';
  voucherDate: string;
  branchId: string;
  sourceType: string;
  sourceId: string;
  narration?: string;
  money: MoneyEntry[];
  metal?: MetalEntry[];
}

const accountCache = new WeakMap<object, Map<string, string>>();

/** Resolves an account code like "4000" to its id, cached for the transaction. */
async function resolveAccountId(tx: Tx, entry: { accountId?: string; accountCode?: string }): Promise<string> {
  if (entry.accountId) return entry.accountId;
  if (!entry.accountCode) throw new Error('A ledger entry needs either accountId or accountCode');

  let cache = accountCache.get(tx.context);
  if (!cache) {
    cache = new Map();
    accountCache.set(tx.context, cache);
  }

  const cached = cache.get(entry.accountCode);
  if (cached) return cached;

  const row = await tx.maybeOne<{ id: string }>(
    `select id from account where code = $1 and deleted_at is null`,
    [entry.accountCode],
  );
  if (!row) {
    throw new BusinessRuleError(
      `Account "${entry.accountCode}" does not exist in the chart of accounts.`,
      'account_missing',
    );
  }

  cache.set(entry.accountCode, row.id);
  return row.id;
}

export async function postVoucher(tx: Tx, input: PostingInput): Promise<{ voucherId: string; voucherNumber: string }> {
  const money = input.money.filter((e) => compare(e.debit ?? '0', '0') !== 0 || compare(e.credit ?? '0', '0') !== 0);

  if (money.length === 0) throw new BusinessRuleError('A voucher must have at least one entry.', 'empty_voucher');

  const totalDebit = sum(money.map((e) => e.debit ?? '0'));
  const totalCredit = sum(money.map((e) => e.credit ?? '0'));
  if (compare(totalDebit, totalCredit) !== 0) {
    throw new BusinessRuleError(
      `The entry does not balance: debits ${totalDebit} vs credits ${totalCredit} (out by ${sub(totalDebit, totalCredit)}).`,
      'unbalanced_voucher',
      { totalDebit, totalCredit },
    );
  }

  // One series for every voucher type. The type is already a column, so a
  // separate series per type would only add setup work for no extra meaning.
  const { number } = await nextDocumentNumber(tx, 'voucher', { branchId: input.branchId });

  const voucherId = newId();
  await tx.query(
    `insert into voucher
       (id, tenant_id, voucher_number, voucher_type, voucher_date, branch_id, narration,
        source_type, source_id, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [voucherId, tx.context.tenantId, number, input.voucherType, input.voucherDate, input.branchId,
     input.narration ?? null, input.sourceType, input.sourceId, tx.context.userId],
  );

  for (const entry of money) {
    await tx.query(
      `insert into ledger_entry
         (id, tenant_id, voucher_id, account_id, party_id, branch_id, entry_date,
          debit, credit, narration, against_type, against_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
      [
        newId(), tx.context.tenantId, voucherId, await resolveAccountId(tx, entry),
        entry.partyId ?? null, input.branchId, input.voucherDate,
        entry.debit ?? '0', entry.credit ?? '0', entry.narration ?? null,
        entry.againstType ?? null, entry.againstId ?? null, tx.context.userId,
      ],
    );
  }

  for (const entry of input.metal ?? []) {
    if (compare(entry.weightIn ?? '0', '0') === 0 && compare(entry.weightOut ?? '0', '0') === 0) continue;
    await tx.query(
      `insert into metal_ledger_entry
         (id, tenant_id, voucher_id, account_id, party_id, branch_id, entry_date, metal_id, purity_id,
          gross_weight, weight_in, weight_out, rate_per_gram, narration, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
      [
        newId(), tx.context.tenantId, voucherId, await resolveAccountId(tx, entry),
        entry.partyId ?? null, input.branchId, input.voucherDate, entry.metalId, entry.purityId ?? null,
        entry.grossWeight ?? '0', entry.weightIn ?? '0', entry.weightOut ?? '0',
        entry.ratePerGram ?? null, entry.narration ?? null, tx.context.userId,
      ],
    );
  }

  return { voucherId, voucherNumber: number };
}

/**
 * Cancels a posted voucher by writing its mirror image. The original stays
 * exactly as it was — an auditor can see both the mistake and the correction.
 */
export async function reverseVoucher(tx: Tx, voucherId: string, reason: string): Promise<string> {
  const original = await tx.maybeOne<{
    id: string; voucher_type: PostingInput['voucherType']; branch_id: string;
    source_type: string; source_id: string; is_reversed: boolean;
  }>(`select * from voucher where id = $1`, [voucherId]);

  if (!original) throw new BusinessRuleError('That voucher does not exist.', 'voucher_missing');
  if (original.is_reversed) throw new BusinessRuleError('That voucher was already reversed.', 'already_reversed');

  const moneyRows = await tx.query<{ account_id: string; party_id: string | null; debit: Decimal; credit: Decimal }>(
    `select account_id, party_id, debit, credit from ledger_entry where voucher_id = $1`,
    [voucherId],
  );
  const metalRows = await tx.query<{
    account_id: string; party_id: string | null; metal_id: string; purity_id: string | null;
    gross_weight: Decimal; weight_in: Decimal; weight_out: Decimal;
  }>(`select * from metal_ledger_entry where voucher_id = $1`, [voucherId]);

  const today = new Date().toISOString().slice(0, 10);
  const { voucherId: reversalId } = await postVoucher(tx, {
    voucherType: original.voucher_type,
    voucherDate: today,
    branchId: original.branch_id,
    sourceType: original.source_type,
    sourceId: original.source_id,
    narration: `Reversal: ${reason}`,
    money: moneyRows.map((r) => ({
      accountId: r.account_id,
      partyId: r.party_id,
      debit: r.credit,
      credit: r.debit,
      narration: reason,
    })),
    metal: metalRows.map((r) => ({
      accountId: r.account_id,
      partyId: r.party_id,
      metalId: r.metal_id,
      purityId: r.purity_id,
      grossWeight: r.gross_weight,
      weightIn: r.weight_out,
      weightOut: r.weight_in,
      narration: reason,
    })),
  });

  await tx.query(
    `update voucher set is_reversed = true, updated_at = now() where id = $1`,
    [voucherId],
  );
  await tx.query(
    `update voucher set reverses_voucher_id = $2 where id = $1`,
    [reversalId, voucherId],
  );

  return reversalId;
}
