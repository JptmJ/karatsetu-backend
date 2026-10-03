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
import { businessDate } from '../../core/util/business-date.js';
import { nextDocumentNumber } from '../numbering/numbering.service.js';
import { DEFAULT_ACCOUNTS } from './accounts.schema.js';

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

/**
 * Account codes to ids for this voucher, in one query. A standard account that
 * did not exist when the shop was set up (Supplier Metal Payable, Metal Gain /
 * Loss) is created the first time it is needed.
 */
async function accountIds(tx: Tx, entries: { accountId?: string; accountCode?: string }[]): Promise<Map<string, string>> {
  if (entries.some((e) => !e.accountId && !e.accountCode)) throw new Error('A ledger entry needs either accountId or accountCode');
  const codes = [...new Set(entries.flatMap((e) => (!e.accountId && e.accountCode ? [e.accountCode] : [])))];
  if (codes.length === 0) return new Map();
  const load = async () => new Map((await tx.query<{ code: string; id: string }>(
    `select code, id from account where code = any($1::text[]) and deleted_at is null`, [codes])).map((r) => [r.code, r.id]));
  let ids = await load();
  const standard = DEFAULT_ACCOUNTS.filter((a) => codes.includes(a.code) && !ids.has(a.code));
  if (standard.length) {
    await tx.query(
      `insert into account (id, tenant_id, code, name, account_type, is_control, control_for, tracks_metal, is_system)
       select gen_random_uuid(), $1, x.code, x.name, x.account_type, x.is_control, x.control_for, x.tracks_metal, true
         from jsonb_to_recordset($2::jsonb) as x(code text, name text, account_type text, is_control boolean, control_for text, tracks_metal boolean)
       on conflict do nothing`,
      [tx.context.tenantId, JSON.stringify(standard.map((a) => ({
        code: a.code, name: a.name, account_type: a.account_type,
        is_control: 'is_control' in a && a.is_control, control_for: 'control_for' in a ? a.control_for : null,
        tracks_metal: 'tracks_metal' in a && a.tracks_metal,
      })))]);
    ids = await load();
  }
  const missing = codes.find((c) => !ids.has(c));
  if (missing) throw new BusinessRuleError(`Account "${missing}" does not exist in the chart of accounts.`, 'account_missing');
  return ids;
}

export async function postVoucher(tx: Tx, input: PostingInput): Promise<{ voucherId: string; voucherNumber: string }> {
  const money = input.money.filter((e) => compare(e.debit ?? '0', '0') !== 0 || compare(e.credit ?? '0', '0') !== 0);
  const metal = (input.metal ?? []).filter((e) => compare(e.weightIn ?? '0', '0') !== 0 || compare(e.weightOut ?? '0', '0') !== 0);

  if (money.length === 0 && metal.length === 0) throw new BusinessRuleError('A voucher must have at least one entry.', 'empty_voucher');

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
  const [{ number }, ids] = await Promise.all([
    nextDocumentNumber(tx, 'voucher', { branchId: input.branchId }),
    accountIds(tx, [...money, ...metal]),
  ]);
  const account = (e: { accountId?: string; accountCode?: string }) => e.accountId ?? ids.get(e.accountCode!)!;

  const voucherId = newId();
  await tx.query(
    `insert into voucher
       (id, tenant_id, voucher_number, voucher_type, voucher_date, branch_id, narration,
        source_type, source_id, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [voucherId, tx.context.tenantId, number, input.voucherType, input.voucherDate, input.branchId,
     input.narration ?? null, input.sourceType, input.sourceId, tx.context.userId],
  );

  // All entries of each kind in one statement.
  const base = [tx.context.tenantId, voucherId, input.branchId, input.voucherDate, tx.context.userId];
  if (money.length) {
    await tx.query(
      `insert into ledger_entry
         (id, tenant_id, voucher_id, branch_id, entry_date, created_by, updated_by,
          account_id, party_id, debit, credit, narration, against_type, against_id)
       select gen_random_uuid(), $1, $2, $3, $4, $5, $5,
              x.account_id, x.party_id, x.debit, x.credit, x.narration, x.against_type, x.against_id
         from jsonb_to_recordset($6::jsonb) as x(account_id uuid, party_id uuid, debit numeric, credit numeric,
                                                narration text, against_type text, against_id uuid)`,
      [...base, JSON.stringify(money.map((e) => ({
        account_id: account(e), party_id: e.partyId ?? null, debit: e.debit ?? '0', credit: e.credit ?? '0',
        narration: e.narration ?? null, against_type: e.againstType ?? null, against_id: e.againstId ?? null,
      })))],
    );
  }
  if (metal.length) {
    await tx.query(
      `insert into metal_ledger_entry
         (id, tenant_id, voucher_id, branch_id, entry_date, created_by, updated_by,
          account_id, party_id, metal_id, purity_id, gross_weight, weight_in, weight_out, rate_per_gram, narration)
       select gen_random_uuid(), $1, $2, $3, $4, $5, $5,
              x.account_id, x.party_id, x.metal_id, x.purity_id, x.gross_weight, x.weight_in, x.weight_out, x.rate_per_gram, x.narration
         from jsonb_to_recordset($6::jsonb) as x(account_id uuid, party_id uuid, metal_id uuid, purity_id uuid, gross_weight numeric,
                                                weight_in numeric, weight_out numeric, rate_per_gram numeric, narration text)`,
      [...base, JSON.stringify(metal.map((e) => ({
        account_id: account(e), party_id: e.partyId ?? null, metal_id: e.metalId, purity_id: e.purityId ?? null,
        gross_weight: e.grossWeight ?? '0', weight_in: e.weightIn ?? '0', weight_out: e.weightOut ?? '0',
        rate_per_gram: e.ratePerGram ?? null, narration: e.narration ?? null,
      })))],
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

  const today = await businessDate(tx);
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
