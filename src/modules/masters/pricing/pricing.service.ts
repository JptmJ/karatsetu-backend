/**
 * Pricing with the database: finds the rate, rules and GST that apply to a
 * line, runs the pure engine, and returns every source row it used. That
 * snapshot is what documents copy onto their lines — the reason an old
 * invoice can always be explained, even after rates and rules change.
 */
import { Decimal } from 'decimal.js';
import type { Tx } from '../../../core/db/client.js';
import { priceLine, PricingError, type PriceLineResult, type RuleSnapshot } from './engine.js';

export interface PriceRequest {
  metalId: string;
  purityId: string;
  itemId?: string | null;
  categoryId?: string | null;
  hsnCode?: string | null;
  quantity: number;
  grossWeightG: string;
  stoneWeightG?: string;
  otherWeightG?: string;
  stoneAmount?: string;
  hallmarkAmount?: string;
  discount?: { amount: string; on: 'making' | 'total' } | null;
  customerStateCode?: string | null;
  /** Typed at the counter. Posting endpoints must check an override permission before passing these. */
  override?: { ratePerGram?: string; making?: RuleSnapshot };
}

type GstKey = 'metal' | 'making' | 'stone' | 'hallmark';

export interface PricedLine extends PriceLineResult {
  warnings: string[];
  snapshot: {
    hsnCode: string;
    ratePerGram: string;
    rateId: string | null;
    rateEffectiveFrom: string | null;
    rateDerivedFromPure: boolean;
    rateOverridden: boolean;
    making: RuleSnapshot | null;
    wastage: RuleSnapshot | null;
    makingGstTreatment: 'composite' | 'separate';
    gstRateIds: Record<GstKey, string | null>;
  };
}

/** Reads a setting with branch override. Swap for your config helper if one exists. */
async function readSetting<T>(tx: Tx, key: string, fallback: T): Promise<T> {
  const row = await tx.maybeOne<{ v: T }>(
    `select value->'v' as v from config_value
      where config_key = $1 and (branch_id = $2::uuid or branch_id is null)
      order by branch_id nulls last limit 1`,
    [key, tx.context.branchId],
  );
  return row?.v ?? fallback;
}

const RATE_SQL = `
  select id, rate_per_gram::text as rate, effective_from::text as effective_from,
         (effective_from at time zone $4)::date::text as effective_date
    from metal_rate
   where metal_id = $1 and purity_id is not distinct from $2::uuid
     and effective_from <= now() and (branch_id = $3::uuid or branch_id is null)
   order by effective_from desc, branch_id nulls last
   limit 1`;

const RULE_SQL = `
  select id, basis, rate::text as rate, flat_amount::text as flat_amount, slabs, slab_mode,
         minimum_amount::text as minimum_amount
    from price_rule
   where applies_to = $1 and is_active and deleted_at is null
     and effective_from <= $2::date and (effective_to is null or effective_to >= $2::date)
     and (item_id is null or item_id = $3::uuid)
     and (item_category_id is null or item_category_id = $4::uuid)
     and (purity_id is null or purity_id = $5::uuid)
     and (metal_id is null or metal_id = $6::uuid)
     and (branch_id is null or branch_id = $7::uuid)
   order by ((item_id is not null)::int * 16 + (item_category_id is not null)::int * 8
           + (purity_id is not null)::int * 4 + (metal_id is not null)::int * 2
           + (branch_id is not null)::int) desc,
            priority desc, effective_from desc
   limit 1`;

const GST_SQL = `
  select id, gst_rate::text as rate from hsn_gst_rate
   where hsn_code = $1 and component = $2
     and effective_from <= $3::date and (effective_to is null or effective_to >= $3::date)
   order by effective_from desc limit 1`;

export async function priceRequest(tx: Tx, req: PriceRequest): Promise<PricedLine> {
  const branchId = tx.context.branchId;
  if (!branchId) throw new PricingError('Select a branch before pricing.');
  const warnings: string[] = [];

  const place = await tx.one<{ today: string; timezone: string; state_code: string | null }>(
    `select (now() at time zone t.timezone)::date::text as today, t.timezone, b.state_code
       from branch b join tenant t on t.id = b.tenant_id
      where b.id = $1`,
    [branchId],
  );

  // What is being priced
  const purity = await tx.maybeOne<{ metal_id: string; code: string; fineness: string }>(
    `select metal_id, code, fineness_percent::text as fineness from purity where id = $1`, [req.purityId],
  );
  if (!purity || purity.metal_id !== req.metalId) throw new PricingError('That purity does not belong to the selected metal.');

  const item = req.itemId
    ? await tx.maybeOne<{ hsn_code: string | null; category_id: string | null; category_hsn: string | null;
        default_making_rate: string | null; default_wastage_percent: string | null }>(
        `select i.hsn_code, i.category_id, c.hsn_code as category_hsn,
                i.default_making_rate::text as default_making_rate,
                i.default_wastage_percent::text as default_wastage_percent
           from item i left join item_category c on c.id = i.category_id
          where i.id = $1 and i.deleted_at is null`,
        [req.itemId],
      )
    : null;
  const categoryId = req.categoryId ?? item?.category_id ?? null;
  const categoryHsn = !item?.category_hsn && categoryId
    ? (await tx.maybeOne<{ hsn_code: string | null }>(`select hsn_code from item_category where id = $1`, [categoryId]))?.hsn_code ?? null
    : null;
  const hsnCode = req.hsnCode ?? item?.hsn_code ?? item?.category_hsn ?? categoryHsn;
  if (!hsnCode) throw new PricingError('No HSN code for this item. Set one on the item or its category in Masters.');

  // Rate: override → this purity → pure rate × fineness
  let rate: { value: string; id: string | null; effectiveFrom: string | null; derived: boolean; overridden: boolean };
  if (req.override?.ratePerGram) {
    rate = { value: req.override.ratePerGram, id: null, effectiveFrom: null, derived: false, overridden: true };
  } else {
    type RateRow = { id: string; rate: string; effective_from: string; effective_date: string };
    const own = await tx.maybeOne<RateRow>(RATE_SQL, [req.metalId, req.purityId, branchId, place.timezone]);
    const pure = own ? null : await tx.maybeOne<RateRow>(RATE_SQL, [req.metalId, null, branchId, place.timezone]);
    const found = own ?? pure;
    if (!found) throw new PricingError(`No rate has been set for ${purity.code}. Enter today's rate in Masters → Rates.`);
    const value = own
      ? own.rate
      : new Decimal(pure!.rate).mul(purity.fineness).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    rate = { value, id: found.id, effectiveFrom: found.effective_from, derived: !own, overridden: false };
    if (found.effective_date < place.today) {
      warnings.push(`The ${purity.code} rate was last set on ${found.effective_date}. Update today's rate before billing.`);
    }
  }

  // Rules: override → most specific price_rule → item default
  const ruleParams = (appliesTo: string) =>
    [appliesTo, place.today, req.itemId ?? null, categoryId, req.purityId, req.metalId, branchId];
  const toRule = (row: Record<string, unknown> | null): RuleSnapshot | null => row && ({
    id: row.id as string, basis: row.basis as RuleSnapshot['basis'], rate: row.rate as string | null,
    flatAmount: row.flat_amount as string | null, slabs: row.slabs as RuleSnapshot['slabs'],
    slabMode: row.slab_mode as 'whole' | 'tiered', minimumAmount: row.minimum_amount as string | null,
  });

  let making = req.override?.making ?? toRule(await tx.maybeOne(RULE_SQL, ruleParams('making')));
  if (!making && item?.default_making_rate) making = { id: null, basis: 'per_gram', rate: item.default_making_rate };
  if (!making) warnings.push('No making charge rule matched this item — making is ₹0. Check Masters → Price Rules.');

  let wastage = toRule(await tx.maybeOne(RULE_SQL, ruleParams('wastage')));
  if (!wastage && item?.default_wastage_percent) wastage = { id: null, basis: 'percent', rate: item.default_wastage_percent };

  // GST
  const treatmentSetting = await readSetting<string>(tx, 'pricing.making_gst_treatment', 'composite');
  const treatment: 'composite' | 'separate' = treatmentSetting === 'separate' ? 'separate' : 'composite';
  const makingOn = (await readSetting<string>(tx, 'pricing.making_weight_basis', 'net')) === 'gross' ? 'gross' : 'net';
  const gstFor = (code: string, component: string) =>
    tx.maybeOne<{ id: string; rate: string }>(GST_SQL, [code, component, place.today]);

  const metalGst = await gstFor(hsnCode, 'metal');
  if (!metalGst) throw new PricingError(`No GST rate for HSN ${hsnCode} on ${place.today}. Add it in Masters → GST & Tax.`);

  let makingGst = metalGst;
  if (treatment === 'separate') {
    const sac = await readSetting<string>(tx, 'pricing.separate_making_sac', '9988');
    const found = await gstFor(sac, 'making');
    if (!found) throw new PricingError(`Making is billed separately, but there is no GST rate for SAC ${sac}. Add it in Masters → GST & Tax.`);
    makingGst = found;
  }
  const stoneGst = (await gstFor(hsnCode, 'stone')) ?? metalGst;
  const hallmarkGst = (await gstFor(hsnCode, 'hallmark')) ?? metalGst;

  const interState = Boolean(place.state_code && req.customerStateCode && place.state_code !== req.customerStateCode);

  const result = priceLine({
    quantity: req.quantity,
    grossWeightG: req.grossWeightG,
    stoneWeightG: req.stoneWeightG,
    otherWeightG: req.otherWeightG,
    finenessPercent: purity.fineness,
    ratePerGram: rate.value,
    making,
    makingOn,
    wastage,
    stoneAmount: req.stoneAmount,
    hallmarkAmount: req.hallmarkAmount,
    discount: req.discount,
    gstPercent: { metal: metalGst.rate, making: makingGst.rate, stone: stoneGst.rate, hallmark: hallmarkGst.rate },
    interState,
  });

  return {
    ...result,
    warnings,
    snapshot: {
      hsnCode,
      ratePerGram: rate.value,
      rateId: rate.id,
      rateEffectiveFrom: rate.effectiveFrom,
      rateDerivedFromPure: rate.derived,
      rateOverridden: rate.overridden,
      making,
      wastage,
      makingGstTreatment: treatment,
      gstRateIds: { metal: metalGst.id, making: makingGst.id, stone: stoneGst.id, hallmark: hallmarkGst.id },
    },
  };
}
