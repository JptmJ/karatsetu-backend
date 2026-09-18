/**
 * Module 5.2 — creating and posting a sales invoice.
 *
 * The mirror image of purchase, with two additions that matter in a jewellery
 * shop: cost of goods sold is captured at the moment of sale (so margin does
 * not shift when the rate moves next week), and a sale can be settled by
 * several tenders at once.
 */
import type { Tx } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import { newId } from '../../core/util/id.js';
import { add, compare, div, isZero, mul, sub, sum, type Decimal } from '../../core/util/decimal.js';
import { nextDocumentNumber } from '../numbering/numbering.service.js';
import { loadPricingSettings, priceLine, totalDocument } from '../pricing/pricing.service.js';
import { recordMovements, reverseMovementsFor } from '../inventory/stock.service.js';
import { postVoucher, reverseVoucher, type MoneyEntry } from '../accounts/ledger.service.js';
import { pricedLineToColumns } from '../purchase/purchase.service.js';
import { CONFIG } from '../../core/config/definitions.js';
import { getConfig } from '../../core/config/config-service.js';

export interface SalesLineInput {
  itemId: string;
  purityId?: string | null;
  pieceId?: string | null;
  locationId?: string | null;
  description?: string;
  quantity?: Decimal;
  grossWeight: Decimal;
  stoneWeight?: Decimal;
  /** Leave out to use today's rate from the rate master. */
  ratePerGram?: Decimal;
  makingBasis?: 'per_gram' | 'percent' | 'flat';
  makingRate?: Decimal;
  wastagePercent?: Decimal;
  stoneAmount?: Decimal;
  discountAmount?: Decimal;
  hallmarkCharge?: Decimal;
  gstRate?: Decimal;
  notes?: string;
}

export interface PaymentInput {
  mode: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'cheque' | 'credit' | 'old_gold' | 'scheme' | 'advance';
  amount: Decimal;
  reference?: string;
  accountId?: string;
  notes?: string;
}

export interface CreateSalesInvoiceInput {
  customerId: string;
  branchId: string;
  docDate: string;
  channel?: 'counter' | 'wholesale' | 'export' | 'online';
  salespersonId?: string;
  otherCharges?: Decimal;
  notes?: string;
  lines: SalesLineInput[];
  payments?: PaymentInput[];
}

/** Today's selling rate for a purity, from the rate master (Module 12.6). */
export async function currentRate(tx: Tx, purityId: string, branchId?: string | null): Promise<Decimal> {
  const row = await tx.maybeOne<{ rate_per_gram: Decimal }>(
    `select rate_per_gram
       from metal_rate
      where purity_id = $1
        and effective_from <= now()
        and (branch_id = $2 or branch_id is null)
      order by effective_from desc, branch_id nulls last
      limit 1`,
    [purityId, branchId ?? null],
  );
  if (!row) {
    throw new BusinessRuleError(
      "No rate has been entered for this purity today. Set it under Settings > Rate Master.",
      'rate_missing',
      { purityId },
    );
  }
  return row.rate_per_gram;
}

export async function createSalesInvoice(tx: Tx, input: CreateSalesInvoiceInput) {
  if (input.lines.length === 0) throw new ValidationError('An invoice needs at least one line.');

  const allowBackdating = await getConfig(tx, CONFIG.allowBackdating);
  const today = new Date().toISOString().slice(0, 10);
  if (!allowBackdating && input.docDate < today) {
    throw new BusinessRuleError('Back-dated invoices are switched off for this business.', 'backdating_not_allowed');
  }

  const branch = await tx.maybeOne<{ id: string; state_code: string | null }>(
    `select id, state_code from branch where id = $1 and deleted_at is null`, [input.branchId],
  );
  if (!branch) throw new NotFoundError('Branch', input.branchId);

  const customer = await tx.maybeOne<{ id: string; name: string; state_code: string | null; is_customer: boolean }>(
    `select id, name, state_code, is_customer from party where id = $1 and deleted_at is null`, [input.customerId],
  );
  if (!customer) throw new NotFoundError('Customer', input.customerId);
  if (!customer.is_customer) {
    throw new BusinessRuleError(`${customer.name} is not marked as a customer.`, 'not_a_customer');
  }

  const isExport = input.channel === 'export';
  const interState = Boolean(branch.state_code && customer.state_code && branch.state_code !== customer.state_code);

  const settings = await loadPricingSettings(tx);
  const purities = await loadPurityMap(tx, input.lines.map((l) => l.purityId));

  const priced = [];
  for (const line of input.lines) {
    const rate = line.ratePerGram ?? (line.purityId ? await currentRate(tx, line.purityId, input.branchId) : '0');
    priced.push(
      priceLine(
        {
          quantity: line.quantity,
          grossWeight: line.grossWeight,
          stoneWeight: line.stoneWeight,
          purityPercent: line.purityId ? purities.get(line.purityId) : '100',
          ratePerGram: rate,
          makingBasis: line.makingBasis,
          makingRate: line.makingRate,
          wastagePercent: line.wastagePercent,
          stoneAmount: line.stoneAmount,
          discountAmount: line.discountAmount,
          gstRate: line.gstRate,
          interState,
          // Exports are zero-rated.
          taxExempt: isExport,
        },
        settings,
      ),
    );
  }

  const totals = totalDocument(priced, settings, input.otherCharges ?? '0');
  const paid = sum((input.payments ?? []).map((p) => p.amount));
  if (compare(paid, totals.totalAmount) > 0) {
    throw new BusinessRuleError(
      `Payments (${paid}) are more than the invoice total (${totals.totalAmount}).`,
      'overpayment',
    );
  }

  const { number } = await nextDocumentNumber(tx, 'sales_invoice', {
    branchId: input.branchId,
    date: new Date(input.docDate),
  });

  const invoiceId = newId();
  const fallbackLocation = await defaultSalesLocation(tx, input.branchId);

  const invoice = await repo(tx, 'sales_invoice').insert({
    id: invoiceId,
    doc_number: number,
    doc_date: input.docDate,
    branch_id: input.branchId,
    customer_id: input.customerId,
    status: 'draft',
    channel: input.channel ?? 'counter',
    salesperson_id: input.salespersonId ?? tx.context.userId,
    place_of_supply_code: customer.state_code,
    is_export: isExport,
    other_charges: input.otherCharges ?? '0',
    notes: input.notes ?? null,
    metal_amount: totals.metalAmount,
    making_amount: totals.makingAmount,
    stone_amount: totals.stoneAmount,
    discount_amount: totals.discountAmount,
    taxable_amount: totals.taxableAmount,
    cgst_amount: totals.cgstAmount,
    sgst_amount: totals.sgstAmount,
    igst_amount: totals.igstAmount,
    round_off: totals.roundOff,
    total_amount: totals.totalAmount,
    total_gross_weight: totals.totalGrossWeight,
    total_net_weight: totals.totalNetWeight,
    total_fine_weight: totals.totalFineWeight,
    paid_amount: paid,
    balance_amount: sub(totals.totalAmount, paid),
  });

  await repo(tx, 'sales_invoice_line').insertMany(
    priced.map((p, index) => ({
      sales_invoice_id: invoiceId,
      line_number: index + 1,
      item_id: input.lines[index]!.itemId,
      purity_id: input.lines[index]!.purityId ?? null,
      piece_id: input.lines[index]!.pieceId ?? null,
      location_id: input.lines[index]!.locationId ?? fallbackLocation,
      description: input.lines[index]!.description ?? null,
      hallmark_charge: input.lines[index]!.hallmarkCharge ?? '0',
      notes: input.lines[index]!.notes ?? null,
      ...pricedLineToColumns(p),
    })),
  );

  if (input.payments?.length) {
    await repo(tx, 'sales_payment').insertMany(
      input.payments.map((p) => ({
        sales_invoice_id: invoiceId,
        mode: p.mode,
        amount: p.amount,
        reference: p.reference ?? null,
        account_id: p.accountId ?? null,
        notes: p.notes ?? null,
      })),
    );
  }

  return invoice;
}

async function defaultSalesLocation(tx: Tx, branchId: string): Promise<string> {
  const location = await tx.maybeOne<{ id: string }>(
    `select id from stock_location
      where branch_id = $1 and is_active = true and deleted_at is null
      order by is_default desc, (kind = 'counter') desc, code
      limit 1`,
    [branchId],
  );
  if (!location) {
    throw new BusinessRuleError('This branch has no stock location set up.', 'no_stock_location');
  }
  return location.id;
}

async function loadPurityMap(tx: Tx, ids: Array<string | null | undefined>): Promise<Map<string, Decimal>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const rows = await tx.query<{ id: string; fineness_percent: Decimal }>(
    `select id, fineness_percent from purity where id = any($1::uuid[])`, [wanted],
  );
  return new Map(rows.map((r) => [r.id, r.fineness_percent]));
}

/**
 * Posting a sale. Stock goes out at cost, revenue and GST are recognised, and
 * the customer is either paid up or left owing the balance.
 */
export async function postSalesInvoice(tx: Tx, invoiceId: string) {
  const invoice = await tx.maybeOne<Record<string, any>>(
    `select * from sales_invoice where id = $1 for update`, [invoiceId],
  );
  if (!invoice) throw new NotFoundError('Sales invoice', invoiceId);
  if (invoice.status === 'posted') throw new BusinessRuleError('This invoice is already posted.', 'already_posted');
  if (invoice.status === 'cancelled') throw new BusinessRuleError('This invoice was cancelled.', 'cancelled');

  const lines = await tx.query<Record<string, any>>(
    `select l.*, i.metal_id, i.tracking
       from sales_invoice_line l
       join item i on i.id = l.item_id
      where l.sales_invoice_id = $1
      order by l.line_number`,
    [invoiceId],
  );
  if (lines.length === 0) throw new BusinessRuleError('This invoice has no lines.', 'empty_document');

  /* --- 1. what the goods cost us, captured now and never recomputed --- */
  const costByLine = new Map<string, Decimal>();
  for (const line of lines) {
    costByLine.set(line.id, await costOfLine(tx, line));
  }
  const totalCost = sum([...costByLine.values()]);

  /* --- 2. stock out --- */
  await recordMovements(
    tx,
    lines.map((line) => ({
      direction: 'out' as const,
      reason: 'sale' as const,
      itemId: line.item_id,
      tracking: line.tracking,
      purityId: line.purity_id,
      locationId: line.location_id,
      pieceId: line.piece_id,
      quantity: line.quantity,
      grossWeight: line.gross_weight,
      netWeight: line.net_weight,
      fineWeight: line.fine_weight,
      value: costByLine.get(line.id) ?? '0',
      sourceType: 'sales_invoice',
      sourceId: invoiceId,
      sourceLineId: line.id,
      movedAt: new Date(invoice.doc_date),
    })),
  );

  for (const line of lines) {
    await tx.query(`update sales_invoice_line set cost_value = $2 where id = $1`, [
      line.id, costByLine.get(line.id) ?? '0',
    ]);
    if (line.piece_id) {
      await tx.query(
        `update stock_piece set status = 'sold', sold_at = now(), updated_at = now() where id = $1`,
        [line.piece_id],
      );
    }
  }

  /* --- 3. the books --- */
  const payments = await tx.query<{ mode: string; amount: Decimal; account_id: string | null }>(
    `select mode, amount, account_id from sales_payment where sales_invoice_id = $1`, [invoiceId],
  );
  const paid = sum(payments.map((p) => p.amount));
  const balance = sub(invoice.total_amount, paid);
  const outputTax = sum([invoice.cgst_amount, invoice.sgst_amount, invoice.igst_amount]);

  const money: MoneyEntry[] = [];

  // What the customer settled, by tender.
  for (const payment of payments) {
    if (compare(payment.amount, '0') <= 0) continue;
    const accountCode = payment.mode === 'cash' ? '1000' : payment.mode === 'advance' ? '2400' : '1010';
    money.push(
      payment.account_id
        ? { accountId: payment.account_id, debit: payment.amount, narration: `Received by ${payment.mode}` }
        : { accountCode, debit: payment.amount, narration: `Received by ${payment.mode}` },
    );
  }

  // Whatever is still owed sits against the customer.
  if (compare(balance, '0') > 0) {
    money.push({
      accountCode: '1100',
      partyId: invoice.customer_id,
      debit: balance,
      narration: `Invoice ${invoice.doc_number}`,
      againstType: 'sales_invoice',
      againstId: invoiceId,
    });
  }

  money.push({ accountCode: '4000', credit: invoice.taxable_amount, narration: 'Sales' });
  if (compare(outputTax, '0') > 0) {
    money.push({ accountCode: '2200', credit: outputTax, narration: 'GST payable' });
  }
  if (compare(invoice.round_off, '0') !== 0) {
    const positive = compare(invoice.round_off, '0') > 0;
    const amount = positive ? invoice.round_off : String(invoice.round_off).replace('-', '');
    money.push(positive
      ? { accountCode: '4900', credit: amount, narration: 'Round off' }
      : { accountCode: '4900', debit: amount, narration: 'Round off' });
  }

  // Cost of goods sold: stock asset down, expense up.
  if (compare(totalCost, '0') > 0) {
    money.push({ accountCode: '5100', debit: totalCost, narration: 'Cost of goods sold' });
    money.push({ accountCode: '1200', credit: totalCost, narration: 'Stock issued against sale' });
  }

  const metal = lines
    .filter((line) => line.metal_id && compare(line.fine_weight, '0') > 0)
    .map((line) => ({
      accountCode: '1210',
      metalId: line.metal_id,
      purityId: line.purity_id,
      grossWeight: line.gross_weight,
      weightOut: line.fine_weight,
      ratePerGram: line.rate_per_gram,
      narration: `Sale ${invoice.doc_number}`,
    }));

  const { voucherId, voucherNumber } = await postVoucher(tx, {
    voucherType: 'sale',
    voucherDate: invoice.doc_date,
    branchId: invoice.branch_id,
    sourceType: 'sales_invoice',
    sourceId: invoiceId,
    narration: `Sales invoice ${invoice.doc_number}`,
    money,
    metal,
  });

  const posted = await tx.one<Record<string, any>>(
    `update sales_invoice
        set status = 'posted', posted_at = now(), posted_by = $2, voucher_id = $3,
            paid_amount = $4, balance_amount = $5, updated_at = now()
      where id = $1
      returning *`,
    [invoiceId, tx.context.userId, voucherId, paid, balance],
  );

  return { invoice: posted, voucherId, voucherNumber, costOfGoodsSold: totalCost };
}

/**
 * What a line cost us.
 *  - a tagged piece carries its own cost
 *  - bulk metal is valued at the running weighted average of that location
 */
async function costOfLine(tx: Tx, line: Record<string, any>): Promise<Decimal> {
  if (line.piece_id) {
    const piece = await tx.maybeOne<{ cost_value: Decimal }>(
      `select cost_value from stock_piece where id = $1`, [line.piece_id],
    );
    if (piece) return piece.cost_value;
  }

  const balance = await tx.maybeOne<{ average_rate: Decimal; net_weight: Decimal; value: Decimal }>(
    `select average_rate, net_weight, value from stock_balance
      where item_id = $1 and purity_id is not distinct from $2 and location_id = $3`,
    [line.item_id, line.purity_id, line.location_id],
  );
  if (!balance || isZero(balance.net_weight)) return '0';
  return mul(line.net_weight, balance.average_rate);
}

export async function cancelSalesInvoice(tx: Tx, invoiceId: string, reason: string) {
  const invoice = await tx.maybeOne<Record<string, any>>(
    `select * from sales_invoice where id = $1 for update`, [invoiceId],
  );
  if (!invoice) throw new NotFoundError('Sales invoice', invoiceId);
  if (invoice.status === 'cancelled') throw new BusinessRuleError('Already cancelled.', 'already_cancelled');
  if (invoice.irn_status === 'generated') {
    throw new BusinessRuleError(
      'This invoice has an IRN. Cancel it on the GST portal first — e-invoices can only be cancelled within 24 hours.',
      'irn_cancel_required',
    );
  }

  if (invoice.status === 'posted') {
    await reverseMovementsFor(tx, 'sales_invoice', invoiceId, `Cancelled: ${reason}`);
    if (invoice.voucher_id) await reverseVoucher(tx, invoice.voucher_id, reason);
    await tx.query(
      `update stock_piece set status = 'in_stock', sold_at = null, updated_at = now()
        where id in (select piece_id from sales_invoice_line
                      where sales_invoice_id = $1 and piece_id is not null)`,
      [invoiceId],
    );
  }

  return tx.one(
    `update sales_invoice
        set status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now()
      where id = $1
      returning *`,
    [invoiceId, tx.context.userId, reason],
  );
}
