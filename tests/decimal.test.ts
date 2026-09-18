import { describe, expect, it } from 'vitest';
import { add, compare, div, fineWeight, mul, round, sub, sum } from '../src/core/util/decimal.js';

describe('decimal arithmetic', () => {
  it('does not lose precision the way floats do', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in plain JavaScript.
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(sub('1000000.05', '0.05')).toBe('1000000');
  });

  it('multiplies and divides money safely', () => {
    expect(mul('6500', '9.16')).toBe('59540');
    expect(div('59540', '9.16')).toBe('6500');
  });

  it('rounds half up, the way an invoice does', () => {
    expect(round('2240.505', 2)).toBe('2240.51');
    expect(round('2240.504', 2)).toBe('2240.5');
    expect(round('76940.5', 0)).toBe('76941');
  });

  it('handles negatives', () => {
    expect(sub('100', '250')).toBe('-150');
    expect(round('-2240.505', 2)).toBe('-2240.51');
    expect(compare('-5', '-10')).toBe(1);
  });

  it('converts gross weight to fine weight by purity', () => {
    expect(fineWeight('10', '91.6')).toBe('9.16');
    expect(fineWeight('100', '99.9')).toBe('99.9');
  });

  it('sums a column of figures exactly', () => {
    const lines = Array.from({ length: 100 }, () => '0.07');
    expect(sum(lines)).toBe('7');
  });

  it('refuses input that is not a number', () => {
    expect(() => add('abc', '1')).toThrow();
    expect(() => div('1', '0')).toThrow('Division by zero');
  });
});
