/**
 * The pricing engine. Pure — no database, no clock — so POS, Orders, Old Gold
 * and the preview endpoint agree to the paisa, and every rule is unit-tested.
 *
 * Rounding: each component is rounded to paise (half-up) once; GST is computed
 * per component on that rounded value; weights round to milligrams.
 * All decimals travel as strings — never as JS numbers.
 */
import { Decimal } from 'decimal.js';
import { ValidationError } from '../../../core/errors/app-error.js';

const Dx = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const d = (v: string | number | null | undefined): Decimal => new Dx(v ?? 0);
const ZERO = new Dx(0);
const money = (v: Decimal): Decimal => v.toDecimalPlaces(2, Dx.ROUND_HALF_UP);
const grams = (v: Decimal): Decimal => v.toDecimalPlaces(3, Dx.ROUND_HALF_UP);
const sum = (vs: Decimal[]): Decimal => vs.reduce((a, b) => a.plus(b), ZERO);

/** A pricing problem the user can fix. Returned as 400 with this message. */
export class PricingError extends ValidationError {}

export type RuleBasis = 'per_gram' | 'percent' | 'flat' | 'slab' | 'hybrid';
export interface Slab { fromG: string | number; toG: string | number | null; rate: string | number }

export interface RuleSnapshot {
  id: string | null;             // null = typed in at the counter, or an item default
  basis: RuleBasis;
  rate: string | null;           // per_gram ₹/g · percent % · flat ₹/piece · hybrid: the % part
  flatAmount?: string | null;    // hybrid: ₹/piece added to the % part
  slabs?: Slab[];
  slabMode?: 'whole' | 'tiered';
  minimumAmount?: string | null; // per piece
}

export type GstComponent = 'metal' | 'wastage' | 'making' | 'stone' | 'hallmark';

export interface PriceLineInput {
  quantity: number;
  grossWeightG: string;
  stoneWeightG?: string;
  otherWeightG?: string;
  finenessPercent: string;
  ratePerGram: string;
  making?: RuleSnapshot | null;
  makingOn?: 'net' | 'gross';
  /** basis 'percent' = % of net weight added as metal; anything else = an amount. */
  wastage?: RuleSnapshot | null;
  stoneAmount?: string;
  hallmarkAmount?: string;
  discount?: { amount: string; on: 'making' | 'total' } | null;
  /** Wastage is taxed at the metal rate. */
  gstPercent: { metal: string; making: string; stone: string; hallmark: string };
  interState: boolean;
}

export interface PriceLineResult {
  netWeightG: string; fineWeightG: string; wastageWeightG: string;
  metalAmount: string; wastageAmount: string; makingAmount: string;
  stoneAmount: string; hallmarkAmount: string; discountAmount: string;
  taxableAmount: string; gstAmount: string; cgstAmount: string; sgstAmount: string; igstAmount: string;
  lineTotal: string;
  taxBreakup: { component: GstComponent; taxable: string; ratePercent: string; tax: string }[];
}

/** Slabs must start at 0 g, meet end-to-end, and only the last may be open-ended. Also used when saving a rule. */
export function validateSlabs(slabs: Slab[]): void {
  if (slabs.length === 0) throw new PricingError('Add at least one slab.');
  const sorted = [...slabs].sort((a, b) => d(a.fromG).cmp(d(b.fromG)));
  if (!d(sorted[0]!.fromG).isZero()) throw new PricingError('The first slab must start at 0 g.');
  sorted.forEach((s, i) => {
    if (d(s.rate).isNegative()) throw new PricingError('Slab rates cannot be negative.');
    const last = i === sorted.length - 1;
    if (s.toG === null || s.toG === undefined) {
      if (!last) throw new PricingError('Only the last slab can be open-ended.');
      return;
    }
    if (d(s.toG).lte(d(s.fromG))) {
      throw new PricingError(`Slab starting at ${d(s.fromG).toString()} g must end after it starts.`);
    }
    if (!last && !d(sorted[i + 1]!.fromG).eq(d(s.toG))) {
      throw new PricingError(`Gap or overlap after ${d(s.toG).toString()} g — each slab must start exactly where the previous one ends.`);
    }
  });
}

function slabAmount(rule: RuleSnapshot, weight: Decimal): Decimal {
  const slabs = rule.slabs ?? [];
  validateSlabs(slabs);
  const sorted = [...slabs].sort((a, b) => d(a.fromG).cmp(d(b.fromG)));
  const open = (s: Slab) => s.toG === null || s.toG === undefined;
  const last = sorted[sorted.length - 1]!;
  if (!open(last) && weight.gte(d(last.toG))) {
    throw new PricingError(`No slab covers ${grams(weight).toFixed(3)} g — the highest slab ends at ${d(last.toG).toString()} g.`);
  }

  if ((rule.slabMode ?? 'whole') === 'whole') {
    const hit = sorted.find((s) => weight.gte(d(s.fromG)) && (open(s) || weight.lt(d(s.toG))))!;
    return weight.mul(d(hit.rate));
  }

  let total = ZERO;
  for (const s of sorted) {
    const from = d(s.fromG);
    if (weight.lte(from)) break;
    const to = open(s) ? weight : Dx.min(weight, d(s.toG));
    total = total.plus(to.minus(from).mul(d(s.rate)));
  }
  return total;
}

function ruleAmount(rule: RuleSnapshot, weight: Decimal, metalAmount: Decimal, quantity: number): Decimal {
  const qty = new Dx(quantity);
  let amount: Decimal;
  switch (rule.basis) {
    case 'per_gram': amount = weight.mul(d(rule.rate)); break;
    case 'percent': amount = metalAmount.mul(d(rule.rate)).div(100); break;
    case 'flat': amount = d(rule.rate).mul(qty); break;
    case 'hybrid': amount = d(rule.flatAmount).mul(qty).plus(metalAmount.mul(d(rule.rate)).div(100)); break;
    case 'slab': amount = slabAmount(rule, weight); break;
    default: throw new PricingError(`Unknown pricing basis "${String(rule.basis)}".`);
  }
  return money(Dx.max(amount, d(rule.minimumAmount).mul(qty)));
}

/** Splits `total` in proportion to `weights`; any rounding paisa goes to the largest share. */
function allocate(total: Decimal, weights: Decimal[]): Decimal[] {
  const whole = sum(weights);
  if (whole.isZero()) return weights.map(() => ZERO);
  const shares = weights.map((w) => money(total.mul(w).div(whole)));
  const drift = total.minus(sum(shares));
  if (!drift.isZero()) {
    const largest = weights.reduce((best, w, i) => (w.gt(weights[best]!) ? i : best), 0);
    shares[largest] = shares[largest]!.plus(drift);
  }
  return shares;
}

export function priceLine(input: PriceLineInput): PriceLineResult {
  const qty = input.quantity;
  if (!Number.isInteger(qty) || qty < 1) throw new PricingError('Quantity must be a whole number of at least 1.');

  const gross = d(input.grossWeightG);
  const stoneW = d(input.stoneWeightG);
  const otherW = d(input.otherWeightG);
  if (gross.isNegative() || stoneW.isNegative() || otherW.isNegative()) throw new PricingError('Weights cannot be negative.');
  const net = gross.minus(stoneW).minus(otherW);
  if (net.isNegative()) throw new PricingError('Stone and other weight cannot add up to more than the gross weight.');

  const rate = d(input.ratePerGram);
  const fine = grams(net.mul(d(input.finenessPercent)).div(100));
  const metal = money(net.mul(rate));

  let wastageWeight = ZERO;
  let wastage = ZERO;
  if (input.wastage) {
    if (input.wastage.basis === 'percent') {
      wastageWeight = grams(net.mul(d(input.wastage.rate)).div(100));
      wastage = money(wastageWeight.mul(rate));
    } else {
      wastage = ruleAmount(input.wastage, net, metal, qty);
    }
  }

  const making = input.making
    ? ruleAmount(input.making, input.makingOn === 'gross' ? gross : net, metal, qty)
    : ZERO;

  const parts: { component: GstComponent; amount: Decimal; discount: Decimal; gst: Decimal }[] = [
    { component: 'metal', amount: metal, discount: ZERO, gst: d(input.gstPercent.metal) },
    { component: 'wastage', amount: wastage, discount: ZERO, gst: d(input.gstPercent.metal) },
    { component: 'making', amount: making, discount: ZERO, gst: d(input.gstPercent.making) },
    { component: 'stone', amount: money(d(input.stoneAmount)), discount: ZERO, gst: d(input.gstPercent.stone) },
    { component: 'hallmark', amount: money(d(input.hallmarkAmount)), discount: ZERO, gst: d(input.gstPercent.hallmark) },
  ];

  const discount = money(d(input.discount?.amount));
  if (discount.isNegative()) throw new PricingError('Discount cannot be negative.');
  if (discount.gt(0)) {
    const on = input.discount!.on;
    const targets = on === 'making' ? parts.filter((p) => p.component === 'making') : parts;
    const available = sum(targets.map((p) => p.amount));
    if (discount.gt(available)) {
      throw new PricingError(on === 'making'
        ? `Discount ₹${discount.toFixed(2)} is more than the making charge ₹${available.toFixed(2)}.`
        : `Discount ₹${discount.toFixed(2)} is more than the line value ₹${available.toFixed(2)}.`);
    }
    allocate(discount, targets.map((p) => p.amount)).forEach((share, i) => { targets[i]!.discount = share; });
  }

  const breakup = parts
    .filter((p) => !p.amount.isZero())
    .map((p) => {
      const taxable = p.amount.minus(p.discount);
      return { component: p.component, taxable, rate: p.gst, tax: money(taxable.mul(p.gst).div(100)) };
    });

  const taxable = sum(breakup.map((b) => b.taxable));
  const gst = sum(breakup.map((b) => b.tax));
  const cgst = input.interState ? ZERO : money(gst.div(2));
  const sgst = input.interState ? ZERO : gst.minus(cgst);
  const igst = input.interState ? gst : ZERO;
  const m2 = (v: Decimal) => v.toFixed(2);

  return {
    netWeightG: grams(net).toFixed(3),
    fineWeightG: fine.toFixed(3),
    wastageWeightG: wastageWeight.toFixed(3),
    metalAmount: m2(metal),
    wastageAmount: m2(wastage),
    makingAmount: m2(making),
    stoneAmount: m2(parts[3]!.amount),
    hallmarkAmount: m2(parts[4]!.amount),
    discountAmount: m2(discount),
    taxableAmount: m2(taxable),
    gstAmount: m2(gst),
    cgstAmount: m2(cgst),
    sgstAmount: m2(sgst),
    igstAmount: m2(igst),
    lineTotal: m2(taxable.plus(gst)),
    taxBreakup: breakup.map((b) => ({ component: b.component, taxable: m2(b.taxable), ratePercent: b.rate.toString(), tax: m2(b.tax) })),
  };
}
