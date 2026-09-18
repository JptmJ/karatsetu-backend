/**
 * Handing out document numbers.
 *
 * The counter is bumped with `update ... returning`, which takes a row lock for
 * the rest of the transaction. Two tills billing at the same instant queue up
 * for a moment and get consecutive numbers — never the same one.
 *
 * Because the number is taken inside the caller's transaction, a rolled-back
 * invoice also rolls back its number. That is deliberate: GST auditors expect a
 * sequence with no holes in it.
 */
import type { Tx } from '../../core/db/client.js';
import { BusinessRuleError } from '../../core/errors/app-error.js';

export interface SeriesRow {
  id: string;
  doc_type: string;
  branch_id: string | null;
  prefix: string;
  suffix: string;
  padding: number;
  next_number: string;
  reset_period: 'never' | 'yearly' | 'financial_yearly' | 'monthly';
  current_period: string | null;
}

/** Indian financial year: April to March, so 15 Jan 2026 is "2025-26". */
export function financialYear(date: Date): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function periodKey(reset: SeriesRow['reset_period'], date: Date): string | null {
  switch (reset) {
    case 'never':
      return null;
    case 'yearly':
      return String(date.getFullYear());
    case 'monthly':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    case 'financial_yearly':
      return financialYear(date);
  }
}

function expandTokens(template: string, date: Date, branchCode: string | null): string {
  return template
    .replaceAll('{FY}', financialYear(date))
    .replaceAll('{YYYY}', String(date.getFullYear()))
    .replaceAll('{YY}', String(date.getFullYear() % 100).padStart(2, '0'))
    .replaceAll('{MM}', String(date.getMonth() + 1).padStart(2, '0'))
    .replaceAll('{BRANCH}', branchCode ?? '');
}

export async function nextDocumentNumber(
  tx: Tx,
  docType: string,
  options: { branchId?: string | null; date?: Date } = {},
): Promise<{ number: string; seriesId: string }> {
  const date = options.date ?? new Date();
  const branchId = options.branchId ?? tx.context.branchId ?? null;

  // Prefer a series defined for this branch; fall back to the shared one.
  const series = await tx.maybeOne<SeriesRow & { branch_code: string | null }>(
    `select s.*, b.code as branch_code
       from numbering_series s
       left join branch b on b.id = s.branch_id
      where s.doc_type = $1
        and s.is_active = true
        and (s.branch_id = $2 or s.branch_id is null)
      order by s.branch_id nulls last
      limit 1
      for update of s`,
    [docType, branchId],
  );

  if (!series) {
    throw new BusinessRuleError(
      `No numbering series is set up for "${docType}". Add one under Settings > Numbering.`,
      'numbering_series_missing',
    );
  }

  const wantedPeriod = periodKey(series.reset_period, date);
  const rolledOver = wantedPeriod !== null && series.current_period !== wantedPeriod;
  const counter = rolledOver ? 1n : BigInt(series.next_number);

  await tx.query(
    `update numbering_series
        set next_number = $2, current_period = $3, updated_at = now()
      where id = $1`,
    [series.id, (counter + 1n).toString(), wantedPeriod],
  );

  const prefix = expandTokens(series.prefix, date, series.branch_code);
  const suffix = expandTokens(series.suffix, date, series.branch_code);
  const body = counter.toString().padStart(series.padding, '0');

  return { number: `${prefix}${body}${suffix}`, seriesId: series.id };
}

/** Records a number that was issued but whose document never got saved. */
export async function recordNumberGap(tx: Tx, seriesId: string, docNumber: string, reason: string): Promise<void> {
  await tx.query(
    `insert into numbering_gap (id, tenant_id, series_id, doc_number, reason, created_by, updated_by)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $5)`,
    [tx.context.tenantId, seriesId, docNumber, reason, tx.context.userId],
  );
}

/** The series a new tenant starts with. */
export const DEFAULT_SERIES = [
  { doc_type: 'purchase_order', name: 'Purchase Order', prefix: 'PO/{FY}/' },
  { doc_type: 'goods_receipt', name: 'Goods Receipt', prefix: 'GRN/{FY}/' },
  { doc_type: 'purchase_invoice', name: 'Purchase Invoice', prefix: 'PI/{FY}/' },
  { doc_type: 'purchase_return', name: 'Return to Vendor', prefix: 'PR/{FY}/' },
  { doc_type: 'sales_invoice', name: 'Sales Invoice', prefix: 'INV/{FY}/' },
  { doc_type: 'sales_return', name: 'Customer Return', prefix: 'CRN/{FY}/' },
  { doc_type: 'stock_transfer', name: 'Stock Transfer', prefix: 'ST/{FY}/' },
  { doc_type: 'stock_adjustment', name: 'Stock Adjustment', prefix: 'ADJ/{FY}/' },
  { doc_type: 'tag', name: 'Item Tag', prefix: 'T', padding: 7, reset_period: 'never' as const },
  { doc_type: 'voucher', name: 'Accounting Voucher', prefix: 'V/{FY}/', padding: 6 },
  { doc_type: 'retail_order', name: 'Retail Order', prefix: 'ORD/{FY}/' },
  { doc_type: 'old_gold', name: 'Old Gold Voucher', prefix: 'OG/{FY}/' },
  { doc_type: 'melt_batch', name: 'Melt Batch', prefix: 'MELT/{FY}/' },
  { doc_type: 'scheme_account', name: 'Scheme Account', prefix: 'SN/{FY}/' },
  { doc_type: 'scheme_redemption', name: 'Scheme Redemption', prefix: 'SNR/{FY}/' },
  { doc_type: 'girvi_loan', name: 'Girvi Loan', prefix: 'GRV/{FY}/' },
  { doc_type: 'girvi_receipt', name: 'Girvi Receipt', prefix: 'GRC/{FY}/' },
] as const;
