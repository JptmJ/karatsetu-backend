/**
 * Module 5.1 — creating and posting a purchase invoice.
 *
 * Posting is where everything happens at once, in one transaction:
 *   stock goes up  ·  the supplier is credited  ·  GST input is recorded
 * If any one of those fails, none of them happened.
 */
import type { Tx } from '../../core/db/client.js';
import { repo } from '../../core/db/repository.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import { newId } from '../../core/util/id.js';
import { add, compare, sum, type Decimal } from '../../core/util/decimal.js';
import { nextDocumentNumber } from '../numbering/numbering.service.js';
import { loadPricingSettings, priceLine, totalDocument, type PricedLine } from '../pricing/pricing.service.js';
import { recordMovements, reverseMovementsFor } from '../inventory/stock.service.js';
import { postVoucher, reverseVoucher, type MoneyEntry } from '../accounts/ledger.service.js';
import { CONFIG } from '../../core/config/definitions.js';
import { getConfig } from '../../core/config/config-service.js';

export interface PurchaseLineInput {
  itemId: string;
  purityId?: string | null;
  locationId?: string | null;
  description?: string;
  quantity?: Decimal;
  grossWeight: Decimal;
  stoneWeight?: Decimal;
  ratePerGram: Decimal;
  makingBasis?: 'per_gram' | 'percent' | 'flat';
  makingRate?: Decimal;
  wastagePercent?: Decimal;
  stoneAmount?: Decimal;
  discountAmount?: Decimal;
  gstRate?: Decimal;
  notes?: string;
}

export interface CreatePurchaseInvoiceInput {
  supplierId: string;
  branchId: string;
  docDate: string;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: string;
  dueDate?: string;
  goodsReceiptId?: string;
  purchaseOrderId?: string;
  raisesStock?: boolean;
  otherCharges?: Decimal;
  notes?: string;
  lines: PurchaseLineInput[];
}

interface PartyRow { id: string; name: string; state_code: string | null; is_supplier: boolean }
interface BranchRow { id: string; state_code: string | null; name: string }

async function resolveTaxDirection(tx: Tx, branchId: string, partyId: string): Promise<{
  interState: boolean; party: PartyRow; branch: BranchRow;
}> {
  const branch = await tx.maybeOne<BranchRow>(
    `select id, state_code, name from branch where id = $1 and deleted_at is null`, [branchId],
  );
  if (!branch) throw new NotFoundError('Branch', branchId);

  const party = await tx.maybeOne<PartyRow>(
    `select id, name, state_code, is_supplier from party where id = $1 and deleted_at is null`, [partyId],
  );
  if (!party) throw new NotFoundError('Party', partyId);

  // Missing state codes default to intra-state, which is the common case and
  // the safer error: over-collecting IGST is harder to unwind than the reverse.
  const interState = Boolean(branch.state_code && party.state_code && branch.state_code !== party.state_code);
  return { interState, party, branch };
}

async function defaultLocation(tx: Tx, branchId: string): Promise<string> {
  const location = await tx.maybeOne<{ id: string }>(
    `select id from stock_location
      where branch_id = $1 and is_active = true and deleted_at is null
      order by is_default desc, code
      limit 1`,
    [branchId],
  );
  if (!location) {
    throw new BusinessRuleError(
      'This branch has no stock location set up. Add one under Masters > Branch.',
      'no_stock_location',
    );
  }
  return location.id;
}

export async function createPurchaseInvoice(tx: Tx, input: CreatePurchaseInvoiceInput) {
  if (input.lines.length === 0) throw new ValidationError('A purchase invoice needs at least one line.');

  const allowBackdating = await getConfig(tx, CONFIG.allowBackdating);
  const today = new Date().toISOString().slice(0, 10);
  if (!allowBackdating && input.docDate < today) {
    throw new BusinessRuleError(
      'Back-dated documents are switched off for this business.',
      'backdating_not_allowed',
    );
  }

  const { interState, party } = await resolveTaxDirection(tx, input.branchId, input.supplierId);
  if (!party.is_supplier) {
    throw new BusinessRuleError(`${party.name} is not marked as a supplier.`, 'not_a_supplier');
  }

  const settings = await loadPricingSettings(tx);
  const purities = await loadPurities(tx, input.lines.map((l) => l.purityId));

  const priced = input.lines.map((line) =>
    priceLine(
      {
        quantity: line.quantity,
        grossWeight: line.grossWeight,
        stoneWeight: line.stoneWeight,
        purityPercent: line.purityId ? purities.get(line.purityId) : '100',
        ratePerGram: line.ratePerGram,
        makingBasis: line.makingBasis,
        makingRate: line.makingRate,
        wastagePercent: line.wastagePercent,
        stoneAmount: line.stoneAmount,
        discountAmount: line.discountAmount,
        gstRate: line.gstRate,
        interState,
      },
      settings,
    ),
  );

  const totals = totalDocument(priced, settings, input.otherCharges ?? '0');
  const { number } = await nextDocumentNumber(tx, 'purchase_invoice', { branchId: input.branchId, date: new Date(input.docDate) });
  const invoiceId = newId();
  const locationId = input.lines[0]?.locationId ?? (await defaultLocation(tx, input.branchId));

  const invoice = await repo(tx, 'purchase_invoice').insert({
    id: invoiceId,
    doc_number: number,
    doc_date: input.docDate,
    branch_id: input.branchId,
    supplier_id: input.supplierId,
    status: 'draft',
    goods_receipt_id: input.goodsReceiptId ?? null,
    purchase_order_id: input.purchaseOrderId ?? null,
    supplier_invoice_number: input.supplierInvoiceNumber ?? null,
    supplier_invoice_date: input.supplierInvoiceDate ?? null,
    due_date: input.dueDate ?? null,
    raises_stock: input.raisesStock ?? true,
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
  });

  await repo(tx, 'purchase_invoice_line').insertMany(
    priced.map((p, index) => ({
      purchase_invoice_id: invoiceId,
      line_number: index + 1,
      item_id: input.lines[index]!.itemId,
      purity_id: input.lines[index]!.purityId ?? null,
      location_id: input.lines[index]!.locationId ?? locationId,
      description: input.lines[index]!.description ?? null,
      notes: input.lines[index]!.notes ?? null,
      ...pricedLineToColumns(p),
    })),
  );

  return invoice;
}

/** Maps the calculated line onto the database column names. */
export function pricedLineToColumns(p: PricedLine): Record<string, unknown> {
  return {
    quantity: p.quantity,
    gross_weight: p.grossWeight,
    stone_weight: p.stoneWeight,
    net_weight: p.netWeight,
    fine_weight: p.fineWeight,
    rate_per_gram: p.ratePerGram,
    metal_amount: p.metalAmount,
    making_basis: p.makingBasis,
    making_rate: p.makingRate,
    making_amount: p.makingAmount,
    wastage_percent: p.wastagePercent,
    wastage_weight: p.wastageWeight,
    wastage_amount: p.wastageAmount,
    stone_amount: p.stoneAmount,
    discount_amount: p.discountAmount,
    taxable_amount: p.taxableAmount,
    gst_rate: p.gstRate,
    cgst_amount: p.cgstAmount,
    sgst_amount: p.sgstAmount,
    igst_amount: p.igstAmount,
    line_total: p.lineTotal,
  };
}

async function loadPurities(tx: Tx, ids: Array<string | null | undefined>): Promise<Map<string, Decimal>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const rows = await tx.query<{ id: string; fineness_percent: Decimal }>(
    `select id, fineness_percent from purity where id = any($1::uuid[])`, [wanted],
  );
  if (rows.length !== wanted.length) {
    const found = new Set(rows.map((r) => r.id));
    throw new NotFoundError('Purity', wanted.find((id) => !found.has(id)));
  }
  return new Map(rows.map((r) => [r.id, r.fineness_percent]));
}

/**
 * The moment of truth. Stock rises, the supplier is credited, GST input is
 * claimed — and the document becomes read-only.
 */
export async function postPurchaseInvoice(tx: Tx, invoiceId: string) {
  const invoice = await tx.maybeOne<Record<string, any>>(
    `select * from purchase_invoice where id = $1 for update`, [invoiceId],
  );
  if (!invoice) throw new NotFoundError('Purchase invoice', invoiceId);
  if (invoice.status === 'posted') throw new BusinessRuleError('This invoice is already posted.', 'already_posted');
  if (invoice.status === 'cancelled') throw new BusinessRuleError('This invoice was cancelled.', 'cancelled');

  const lines = await tx.query<Record<string, any>>(
    `select l.*, i.tracking, i.metal_id
       from purchase_invoice_line l
       join item i on i.id = l.item_id
      where l.purchase_invoice_id = $1
      order by l.line_number`,
    [invoiceId],
  );
  if (lines.length === 0) throw new BusinessRuleError('This invoice has no lines.', 'empty_document');

  /* --- 1. stock in --- */
  if (invoice.raises_stock) {
    await recordMovements(
      tx,
      lines.map((line) => ({
        direction: 'in' as const,
        reason: 'purchase' as const,
        itemId: line.item_id,
        tracking: line.tracking,
        purityId: line.purity_id,
        locationId: line.location_id,
        pieceId: line.piece_id,
        quantity: line.quantity,
        grossWeight: line.gross_weight,
        netWeight: line.net_weight,
        fineWeight: line.fine_weight,
        // Stock is valued at cost before tax — GST is recoverable, not part of
        // what the goods are worth.
        value: line.taxable_amount,
        sourceType: 'purchase_invoice',
        sourceId: invoiceId,
        sourceLineId: line.id,
        movedAt: new Date(invoice.doc_date),
      })),
    );
  }

  /* --- 2. the books --- */
  const inputTax = sum([invoice.cgst_amount, invoice.sgst_amount, invoice.igst_amount]);
  const money: MoneyEntry[] = [
    { accountCode: '1200', debit: invoice.taxable_amount, narration: 'Stock purchased' },
    ...(compare(inputTax, '0') > 0 ? [{ accountCode: '1300', debit: inputTax, narration: 'GST input credit' }] : []),
    {
      accountCode: '2000',
      partyId: invoice.supplier_id,
      credit: invoice.total_amount,
      narration: `Purchase invoice ${invoice.doc_number}`,
      againstType: 'purchase_invoice',
      againstId: invoiceId,
    },
  ];

  // Rounding is posted explicitly so the two sides balance to the paisa.
  if (compare(invoice.round_off, '0') !== 0) {
    const positive = compare(invoice.round_off, '0') > 0;
    const amount = positive ? invoice.round_off : String(invoice.round_off).replace('-', '');
    money.push(
      positive
        ? { accountCode: '4900', credit: amount, narration: 'Round off' }
        : { accountCode: '4900', debit: amount, narration: 'Round off' },
    );
  }

  const metal = lines
    .filter((line) => line.metal_id && compare(line.fine_weight, '0') > 0)
    .map((line) => ({
      accountCode: '1210',
      metalId: line.metal_id,
      purityId: line.purity_id,
      grossWeight: line.gross_weight,
      weightIn: line.fine_weight,
      ratePerGram: line.rate_per_gram,
      narration: `Purchase ${invoice.doc_number}`,
    }));

  const { voucherId, voucherNumber } = await postVoucher(tx, {
    voucherType: 'purchase',
    voucherDate: invoice.doc_date,
    branchId: invoice.branch_id,
    sourceType: 'purchase_invoice',
    sourceId: invoiceId,
    narration: `Purchase invoice ${invoice.doc_number}`,
    money,
    metal,
  });

  /* --- 3. freeze the document --- */
  const posted = await tx.one<Record<string, any>>(
    `update purchase_invoice
        set status = 'posted', posted_at = now(), posted_by = $2, voucher_id = $3, updated_at = now()
      where id = $1
      returning *`,
    [invoiceId, tx.context.userId, voucherId],
  );

  return { invoice: posted, voucherId, voucherNumber };
}

export async function cancelPurchaseInvoice(tx: Tx, invoiceId: string, reason: string) {
  const invoice = await tx.maybeOne<Record<string, any>>(
    `select * from purchase_invoice where id = $1 for update`, [invoiceId],
  );
  if (!invoice) throw new NotFoundError('Purchase invoice', invoiceId);
  if (invoice.status === 'cancelled') throw new BusinessRuleError('Already cancelled.', 'already_cancelled');

  if (invoice.status === 'posted') {
    await reverseMovementsFor(tx, 'purchase_invoice', invoiceId, `Cancelled: ${reason}`);
    if (invoice.voucher_id) await reverseVoucher(tx, invoice.voucher_id, reason);
  }

  return tx.one(
    `update purchase_invoice
        set status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now()
      where id = $1
      returning *`,
    [invoiceId, tx.context.userId, reason],
  );
}
