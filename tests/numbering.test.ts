import { describe, expect, it } from 'vitest';
import { financialYear, periodKey } from '../src/modules/numbering/numbering.service.js';
import { hasPermission } from '../src/modules/identity/permissions.js';

describe('Indian financial year', () => {
  it('runs April to March', () => {
    expect(financialYear(new Date('2026-04-01'))).toBe('2026-27');
    expect(financialYear(new Date('2026-03-31'))).toBe('2025-26');
    expect(financialYear(new Date('2026-01-15'))).toBe('2025-26');
    expect(financialYear(new Date('2026-12-31'))).toBe('2026-27');
  });

  it('produces a period key that changes only when the counter should reset', () => {
    const march = new Date('2026-03-31');
    const april = new Date('2026-04-01');
    expect(periodKey('financial_yearly', march)).not.toBe(periodKey('financial_yearly', april));
    expect(periodKey('never', march)).toBeNull();
    expect(periodKey('monthly', new Date('2026-09-14'))).toBe('2026-09');
  });
});

describe('permission matching', () => {
  it('honours exact grants', () => {
    expect(hasPermission(new Set(['trade.sales.create']), 'trade.sales.create')).toBe(true);
    expect(hasPermission(new Set(['trade.sales.create']), 'trade.sales.delete')).toBe(false);
  });

  it('honours wildcards at every level', () => {
    expect(hasPermission(new Set(['*']), 'anything.at.all')).toBe(true);
    expect(hasPermission(new Set(['trade.*']), 'trade.sales.create')).toBe(true);
    expect(hasPermission(new Set(['trade.sales.*']), 'trade.sales.post')).toBe(true);
    expect(hasPermission(new Set(['trade.sales.*']), 'trade.purchase.post')).toBe(false);
  });

  it('does not let a narrow grant widen', () => {
    expect(hasPermission(new Set(['stock.finished.view']), 'stock.finished.delete')).toBe(false);
    expect(hasPermission(new Set(['stock.finished.view']), 'stock.*')).toBe(false);
  });
});
