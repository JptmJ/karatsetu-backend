import { describe, expect, it } from 'vitest';
import { priceLine, totalDocument, type PricingSettings } from '../src/modules/pricing/pricing.service.js';

const settings: PricingSettings = {
  makingBasis: 'per_gram',
  makingOnGross: true,
  wastageBasis: 'percent',
  currencyDecimals: 2,
  weightDecimals: 3,
  gstEnabled: true,
  gstMetalRate: '3',
  lineRounding: 'none',
  invoiceRounding: 'nearest_1',
};

describe('pricing a jewellery line', () => {
  it('works the worked example from the service comment', () => {
    const line = priceLine(
      {
        grossWeight: '10',
        stoneWeight: '1',
        purityPercent: '91.6',
        ratePerGram: '6500',
        makingRate: '450',
        wastagePercent: '8',
        stoneAmount: '8000',
      },
      settings,
    );

    expect(line.netWeight).toBe('9');
    expect(line.fineWeight).toBe('8.244');
    expect(line.metalAmount).toBe('58500');
    expect(line.wastageWeight).toBe('0.72');
    expect(line.wastageAmount).toBe('4680');
    expect(line.makingAmount).toBe('4500'); // on gross weight, per config
    expect(line.taxableAmount).toBe('75680');
    expect(line.lineTotal).toBe('77950.4');
  });

  it('charges making on net weight when the tenant configures it that way', () => {
    const onNet = priceLine(
      { grossWeight: '10', stoneWeight: '1', purityPercent: '91.6', ratePerGram: '6500', makingRate: '450' },
      { ...settings, makingOnGross: false },
    );
    expect(onNet.makingAmount).toBe('4050'); // 9g not 10g
  });

  it('splits GST into CGST and SGST inside the state, IGST outside it', () => {
    const inputs = { grossWeight: '10', purityPercent: '91.6', ratePerGram: '6500' } as const;

    const local = priceLine({ ...inputs, interState: false }, settings);
    expect(local.cgstAmount).toBe('975');
    expect(local.sgstAmount).toBe('975');
    expect(local.igstAmount).toBe('0');

    const outside = priceLine({ ...inputs, interState: true }, settings);
    expect(outside.igstAmount).toBe('1950');
    expect(outside.cgstAmount).toBe('0');
  });

  it('never loses a paisa when halving an odd tax amount', () => {
    // 3% of 74700 is 2241, which halves cleanly; 3% of 74701 does not.
    const line = priceLine({ grossWeight: '1', purityPercent: '100', ratePerGram: '74701' }, settings);
    const halves = Number(line.cgstAmount) + Number(line.sgstAmount);
    expect(halves).toBeCloseTo(Number(line.taxableAmount) * 0.03, 6);
  });

  it('zero-rates an exempt line', () => {
    const line = priceLine(
      { grossWeight: '10', purityPercent: '91.6', ratePerGram: '6500', taxExempt: true },
      settings,
    );
    expect(line.gstRate).toBe('0');
    expect(line.lineTotal).toBe(line.taxableAmount);
  });

  it('supports percent and flat making charges', () => {
    const base = { grossWeight: '10', purityPercent: '91.6', ratePerGram: '6500' } as const;
    expect(priceLine({ ...base, makingBasis: 'percent', makingRate: '12' }, settings).makingAmount).toBe('7800');
    expect(priceLine({ ...base, makingBasis: 'flat', makingRate: '2500' }, settings).makingAmount).toBe('2500');
  });

  it('rounds the invoice total and records the difference', () => {
    const lines = [priceLine({ grossWeight: '3.333', purityPercent: '91.6', ratePerGram: '6501' }, settings)];
    const totals = totalDocument(lines, settings);
    expect(Number(totals.totalAmount) % 1).toBe(0);
    const beforeRounding =
      Number(totals.taxableAmount) + Number(totals.cgstAmount) + Number(totals.sgstAmount);
    expect(Number(totals.roundOff)).toBeCloseTo(Number(totals.totalAmount) - beforeRounding, 6);
  });

  it('counts wastage as metal value, not as making', () => {
    const lines = [
      priceLine(
        { grossWeight: '10', purityPercent: '91.6', ratePerGram: '6500', makingRate: '450', wastagePercent: '8' },
        settings,
      ),
    ];
    const totals = totalDocument(lines, settings);
    expect(totals.metalAmount).toBe('70200'); // 65000 metal + 5200 wastage
    expect(totals.makingAmount).toBe('4500');
  });
});
