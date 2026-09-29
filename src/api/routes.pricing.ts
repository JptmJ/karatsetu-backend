import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { defineRoute } from '../core/http/route-registry.js';
import { transaction } from '../core/db/client.js';
import { decimal, errorEnvelope, record, uuid } from './schemas.js';
import { priceRequest, type PricedLine } from '../modules/masters/pricing/pricing.service.js';

const rule = z.object({
  id: z.null().default(null),
  basis: z.enum(['per_gram', 'percent', 'flat', 'slab', 'hybrid']),
  rate: decimal.nullable(),
  flatAmount: decimal.nullish(),
  slabs: z.array(z.object({ fromG: decimal, toG: decimal.nullable(), rate: decimal })).optional(),
  slabMode: z.enum(['whole', 'tiered']).optional(),
  minimumAmount: decimal.nullish(),
});

const line = z.object({
  metalId: uuid, purityId: uuid, itemId: uuid.nullish(), categoryId: uuid.nullish(), hsnCode: z.string().nullish(),
  quantity: z.number().int().min(1).default(1),
  grossWeightG: decimal, stoneWeightG: decimal.optional(), otherWeightG: decimal.optional(),
  stoneAmount: decimal.optional(), hallmarkAmount: decimal.optional(),
  discount: z.object({ amount: decimal, on: z.enum(['making', 'total']) }).nullish(),
  override: z.object({ ratePerGram: decimal.optional(), making: rule.optional() }).optional(),
});

defineRoute({
  method: 'post', path: '/api/pricing/preview', module: 'pos', permission: 'pos.view',
  summary: 'Price lines exactly as billing will — nothing is saved',
  description:
    'For live totals while a bill or order is being built. Posting a document always re-prices on the server; the client\'s numbers are never trusted.',
  body: z.object({ customerStateCode: z.string().max(2).nullish(), lines: z.array(line).min(1).max(100) }),
  responses: [
    { status: 200, description: 'Priced.', schema: z.object({ lines: z.array(record), totals: record }) },
    { status: 400, description: 'Something the user must fix — missing rate, missing GST, bad slab, too much discount.', schema: errorEnvelope },
  ],
  changelog: [{ date: '2026-09-27', kind: 'added', note: 'Pricing preview backed by the shared pricing engine.' }],
  handler: async (req) => transaction(async (tx) => {
    const lines: PricedLine[] = [];
    for (const l of req.body.lines) {
      lines.push(await priceRequest(tx, { ...l, customerStateCode: req.body.customerStateCode ?? null }));
    }
    const add = (k: 'taxableAmount' | 'gstAmount' | 'lineTotal') =>
      lines.reduce((acc, l) => acc.plus(l[k]), new Decimal(0));
    const total = add('lineTotal');
    const rounded = total.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return {
      lines,
      totals: {
        taxableAmount: add('taxableAmount').toFixed(2),
        gstAmount: add('gstAmount').toFixed(2),
        beforeRoundOff: total.toFixed(2),
        roundOff: rounded.minus(total).toFixed(2),
        grandTotal: rounded.toFixed(2),
      },
    };
  }),
});
