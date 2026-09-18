/**
 * Turning weights into money.
 *
 * This is the one piece of logic that absolutely must not be scattered across
 * the codebase. Purchase, sales, returns, orders and estimates all price a line
 * the same way, and every one of them reads the same config keys to do it — so
 * when a tenant changes "charge making on gross weight" to off, every screen in
 * the product changes together.
 *
 * The shape of a line, worked example (22K ring, 10g gross, 1g stones):
 *
 *   net weight      = gross 10.000 − stones 1.000            =  9.000 g
 *   fine weight     = net 9.000 × 91.6%                      =  8.244 g
 *   metal amount    = net 9.000 × rate 6,500/g               = 58,500.00
 *   wastage         = net 9.000 × 8%  = 0.720 g × 6,500      =  4,680.00
 *   making          = 10.000 g × 450/g   (gross, per config) =  4,500.00
 *   stones                                                   =  8,000.00
 *                                                              ──────────
 *   taxable                                                   = 75,680.00
 *   GST @ 3% (intra-state → 1.5% + 1.5%)                       =  2,270.40
 *                                                              ──────────
 *   line total                                                 = 77,950.40
 */
import type { Tx } from '../../core/db/client.js';
import { CONFIG } from '../../core/config/definitions.js';
import { getConfig } from '../../core/config/config-service.js';
import { add, div, fineWeight, mul, round, sub, sum, type Decimal } from '../../core/util/decimal.js';

export interface PricingInput {
  quantity?: Decimal;
  grossWeight: Decimal;
  stoneWeight?: Decimal;
  /** Fineness as a percentage: 91.6 for 22K. */
  purityPercent?: Decimal;
  ratePerGram: Decimal;

  makingBasis?: 'per_gram' | 'percent' | 'flat';
  makingRate?: Decimal;

  wastagePercent?: Decimal;
  stoneAmount?: Decimal;
  discountAmount?: Decimal;

  /** Percentage. Defaults to the configured GST rate for jewellery. */
  gstRate?: Decimal;
  /** Same state as the branch means CGST + SGST; different state means IGST. */
  interState?: boolean;
  /** Purchases from an unregistered supplier, exports, and so on. */
  taxExempt?: boolean;
}

export interface PricedLine {
  quantity: Decimal;
  grossWeight: Decimal;
  stoneWeight: Decimal;
  netWeight: Decimal;
  fineWeight: Decimal;
  ratePerGram: Decimal;
  metalAmount: Decimal;
  makingBasis: 'per_gram' | 'percent' | 'flat';
  makingRate: Decimal;
  makingAmount: Decimal;
  wastagePercent: Decimal;
  wastageWeight: Decimal;
  wastageAmount: Decimal;
  stoneAmount: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  gstRate: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  lineTotal: Decimal;
}

export interface PricingSettings {
  makingBasis: 'per_gram' | 'percent' | 'flat';
  makingOnGross: boolean;
  wastageBasis: 'percent' | 'per_gram' | 'none';
  currencyDecimals: number;
  weightDecimals: number;
  gstEnabled: boolean;
  gstMetalRate: Decimal;
  lineRounding: 'none' | 'nearest_1' | 'nearest_10';
  invoiceRounding: 'none' | 'nearest_1' | 'nearest_10';
}

/** Read once per document, then used for every line on it. */
export async function loadPricingSettings(tx: Tx): Promise<PricingSettings> {
  const [makingBasis, makingOnGross, wastageBasis, currencyDecimals, weightDecimals, gstEnabled, gstMetalRate, lineRounding, invoiceRounding] =
    await Promise.all([
      getConfig(tx, CONFIG.makingChargeBasis),
      getConfig(tx, CONFIG.makingChargeOnGross),
      getConfig(tx, CONFIG.wastageBasis),
      getConfig(tx, CONFIG.currencyDecimals),
      getConfig(tx, CONFIG.weightDecimals),
      getConfig(tx, CONFIG.gstEnabled),
      getConfig(tx, CONFIG.gstMetalRate),
      getConfig(tx, CONFIG.rateRounding),
      getConfig(tx, CONFIG.invoiceRounding),
    ]);

  return {
    makingBasis,
    makingOnGross,
    wastageBasis,
    currencyDecimals,
    weightDecimals,
    gstEnabled,
    gstMetalRate,
    lineRounding,
    invoiceRounding,
  };
}

function applyRounding(value: Decimal, mode: 'none' | 'nearest_1' | 'nearest_10', decimals: number): Decimal {
  switch (mode) {
    case 'nearest_1':
      return round(value, 0);
    case 'nearest_10':
      return mul(round(div(value, '10'), 0), '10');
    default:
      return round(value, decimals);
  }
}

export function priceLine(input: PricingInput, settings: PricingSettings): PricedLine {
  const money = settings.currencyDecimals;
  const wdp = settings.weightDecimals;

  const quantity = input.quantity ?? '1';
  const grossWeight = round(input.grossWeight, wdp);
  const stoneWeight = round(input.stoneWeight ?? '0', wdp);
  const netWeight = round(sub(grossWeight, stoneWeight), wdp);
  const purityPercent = input.purityPercent ?? '100';
  const fine = round(fineWeight(netWeight, purityPercent), wdp);

  const metalAmount = round(mul(netWeight, input.ratePerGram), money);

  /* --- wastage: extra metal the shop charges for, expressed as weight --- */
  const wastagePercent = settings.wastageBasis === 'none' ? '0' : (input.wastagePercent ?? '0');
  const wastageWeight =
    settings.wastageBasis === 'per_gram'
      ? round(mul(netWeight, wastagePercent), wdp)
      : round(div(mul(netWeight, wastagePercent), '100'), wdp);
  const wastageAmount = round(mul(wastageWeight, input.ratePerGram), money);

  /* --- making charges --- */
  const makingBasis = input.makingBasis ?? settings.makingBasis;
  const makingRate = input.makingRate ?? '0';
  const makingWeight = settings.makingOnGross ? grossWeight : netWeight;

  let makingAmount: Decimal;
  switch (makingBasis) {
    case 'percent':
      makingAmount = round(div(mul(metalAmount, makingRate), '100'), money);
      break;
    case 'flat':
      makingAmount = round(mul(makingRate, quantity), money);
      break;
    default:
      makingAmount = round(mul(makingWeight, makingRate), money);
  }

  const stoneAmount = round(input.stoneAmount ?? '0', money);
  const discountAmount = round(input.discountAmount ?? '0', money);

  const beforeDiscount = sum([metalAmount, wastageAmount, makingAmount, stoneAmount]);
  let taxableAmount = sub(beforeDiscount, discountAmount);
  taxableAmount = applyRounding(taxableAmount, settings.lineRounding, money);

  /* --- GST --- */
  const gstRate = input.taxExempt || !settings.gstEnabled ? '0' : (input.gstRate ?? settings.gstMetalRate);
  const totalTax = round(div(mul(taxableAmount, gstRate), '100'), money);

  let cgstAmount = '0';
  let sgstAmount = '0';
  let igstAmount = '0';
  if (input.interState) {
    igstAmount = totalTax;
  } else {
    // Split in half, then give the remainder to CGST so the two always add
    // back to exactly the total rather than losing a paisa to rounding.
    cgstAmount = round(div(totalTax, '2'), money);
    sgstAmount = sub(totalTax, cgstAmount);
  }

  const lineTotal = round(add(taxableAmount, totalTax), money);

  return {
    quantity,
    grossWeight,
    stoneWeight,
    netWeight,
    fineWeight: fine,
    ratePerGram: input.ratePerGram,
    metalAmount,
    makingBasis,
    makingRate,
    makingAmount,
    wastagePercent,
    wastageWeight,
    wastageAmount,
    stoneAmount,
    discountAmount,
    taxableAmount,
    gstRate,
    cgstAmount,
    sgstAmount,
    igstAmount,
    lineTotal,
  };
}

export interface DocumentTotals {
  metalAmount: Decimal;
  makingAmount: Decimal;
  stoneAmount: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  roundOff: Decimal;
  totalAmount: Decimal;
  totalGrossWeight: Decimal;
  totalNetWeight: Decimal;
  totalFineWeight: Decimal;
}

export function totalDocument(
  lines: PricedLine[],
  settings: PricingSettings,
  otherCharges: Decimal = '0',
): DocumentTotals {
  const pick = (key: keyof PricedLine) => sum(lines.map((l) => l[key] as Decimal));

  const taxableAmount = add(pick('taxableAmount'), otherCharges);
  const cgstAmount = pick('cgstAmount');
  const sgstAmount = pick('sgstAmount');
  const igstAmount = pick('igstAmount');

  const beforeRounding = sum([taxableAmount, cgstAmount, sgstAmount, igstAmount]);
  const totalAmount = applyRounding(beforeRounding, settings.invoiceRounding, settings.currencyDecimals);

  return {
    // Wastage is metal the customer pays for, so it belongs with the metal value.
    metalAmount: add(pick('metalAmount'), pick('wastageAmount')),
    makingAmount: pick('makingAmount'),
    stoneAmount: pick('stoneAmount'),
    discountAmount: pick('discountAmount'),
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    roundOff: sub(totalAmount, beforeRounding),
    totalAmount,
    totalGrossWeight: pick('grossWeight'),
    totalNetWeight: pick('netWeight'),
    totalFineWeight: pick('fineWeight'),
  };
}
