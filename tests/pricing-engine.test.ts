import { describe, expect, it } from 'vitest';
import { priceLine, validateSlabs, PricingError, type PriceLineInput } from '../src/modules/masters/pricing/engine.js';

const GST3 = { metal: '3', making: '3', stone: '3', hallmark: '3' };
// 22K ring: 10 g gross, 0.5 g stones, ₹6,500/g, making ₹450/g on net
const ring: PriceLineInput = {
  quantity: 1, grossWeightG: '10', stoneWeightG: '0.5', finenessPercent: '91.6',
  ratePerGram: '6500', making: { id: 'm1', basis: 'per_gram', rate: '450' },
  gstPercent: GST3, interState: false,
};
const flat12 = { ...ring, grossWeightG: '12.3', stoneWeightG: '0' };
const slabs = [{ fromG: 0, toG: 10, rate: 500 }, { fromG: 10, toG: null, rate: 400 }];

describe('priceLine', () => {
  it('prices a 22K ring: per-gram making, 3% composite GST, intra-state', () => {
    const r = priceLine(ring);
    expect(r.netWeightG).toBe('9.500');
    expect(r.fineWeightG).toBe('8.702');
    expect(r.metalAmount).toBe('61750.00');
    expect(r.makingAmount).toBe('4275.00');
    expect(r.taxableAmount).toBe('66025.00');
    expect(r.gstAmount).toBe('1980.75');
    expect(r.cgstAmount).toBe('990.38');
    expect(r.sgstAmount).toBe('990.37');
    expect(r.igstAmount).toBe('0.00');
    expect(r.lineTotal).toBe('68005.75');
  });

  it('charges IGST in full for an inter-state customer', () => {
    const r = priceLine({ ...ring, interState: true });
    expect(r.igstAmount).toBe('1980.75');
    expect(r.cgstAmount).toBe('0.00');
  });

  it('taxes making at its own rate when billed separately', () => {
    const r = priceLine({ ...ring, gstPercent: { ...GST3, making: '5' } });
    expect(r.gstAmount).toBe('2066.25');   // 1,852.50 + 213.75
    expect(r.cgstAmount).toBe('1033.13');
    expect(r.sgstAmount).toBe('1033.12');
  });

  it('percent making is a % of metal value', () => {
    expect(priceLine({ ...ring, making: { id: 'm', basis: 'percent', rate: '12' } }).makingAmount).toBe('7410.00');
  });

  it('hybrid making is flat per piece plus a % of metal value', () => {
    const r = priceLine({ ...ring, making: { id: 'm', basis: 'hybrid', rate: '8', flatAmount: '1000' } });
    expect(r.makingAmount).toBe('5940.00');
  });

  it('whole slab: the matched slab rate applies to all the weight', () => {
    const r = priceLine({ ...flat12, making: { id: 'm', basis: 'slab', rate: null, slabs, slabMode: 'whole' } });
    expect(r.makingAmount).toBe('4920.00');
  });

  it('tiered slab: each portion at its own rate', () => {
    const r = priceLine({ ...flat12, making: { id: 'm', basis: 'slab', rate: null, slabs, slabMode: 'tiered' } });
    expect(r.makingAmount).toBe('5920.00');
  });

  it('applies the minimum making charge', () => {
    const r = priceLine({ ...ring, grossWeightG: '2', stoneWeightG: '0',
      making: { id: 'm', basis: 'per_gram', rate: '450', minimumAmount: '1500' } });
    expect(r.makingAmount).toBe('1500.00');
  });

  it('percent wastage adds weight, valued at the metal rate', () => {
    const r = priceLine({ ...ring, wastage: { id: 'w', basis: 'percent', rate: '5' } });
    expect(r.wastageWeightG).toBe('0.475');
    expect(r.wastageAmount).toBe('3087.50');
  });

  it('a making-only discount reduces making before GST', () => {
    const r = priceLine({ ...ring, discount: { amount: '500', on: 'making' } });
    expect(r.discountAmount).toBe('500.00');
    expect(r.taxableAmount).toBe('65525.00');
    expect(r.gstAmount).toBe('1965.75');
  });

  it('a whole-line discount is shared across components, to the paisa', () => {
    const r = priceLine({ ...ring, discount: { amount: '1000', on: 'total' } });
    expect(r.taxableAmount).toBe('65025.00');
    expect(r.gstAmount).toBe('1950.75');
  });

  it('refuses impossible input with a message the user can act on', () => {
    expect(() => priceLine({ ...ring, stoneWeightG: '11' })).toThrow(PricingError);
    expect(() => priceLine({ ...ring, quantity: 0 })).toThrow(PricingError);
    expect(() => priceLine({ ...ring, discount: { amount: '5000', on: 'making' } })).toThrow(/more than the making charge/);
    expect(() => priceLine({ ...flat12, making: { id: 'm', basis: 'slab', rate: null,
      slabs: [{ fromG: 0, toG: 10, rate: 500 }] } })).toThrow(/No slab covers/);
  });
});

describe('validateSlabs', () => {
  it('rejects gaps, a non-zero start, and an open slab in the middle', () => {
    expect(() => validateSlabs([{ fromG: 0, toG: 10, rate: 1 }, { fromG: 12, toG: null, rate: 1 }])).toThrow(/Gap or overlap/);
    expect(() => validateSlabs([{ fromG: 1, toG: null, rate: 1 }])).toThrow(/start at 0/);
    expect(() => validateSlabs([{ fromG: 0, toG: null, rate: 1 }, { fromG: 5, toG: 9, rate: 1 }])).toThrow();
  });
});
