/**
 * Money and metal weight arithmetic.
 *
 * `pg` hands back `numeric` columns as strings on purpose — turning them into
 * JavaScript numbers would silently round. We keep them as strings end to end
 * and do the maths in BigInt over a fixed number of decimal places.
 */
const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

export type Decimal = string;

export function toUnits(value: Decimal | number): bigint {
  const text = typeof value === 'number' ? value.toString() : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Not a number: "${value}"`);
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const padded = (fraction + '0'.repeat(SCALE)).slice(0, SCALE);
  const units = BigInt(whole) * FACTOR + BigInt(padded || '0');
  return negative ? -units : units;
}

export function fromUnits(units: bigint): Decimal {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / FACTOR;
  const fraction = (abs % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export const add = (a: Decimal, b: Decimal): Decimal => fromUnits(toUnits(a) + toUnits(b));
export const sub = (a: Decimal, b: Decimal): Decimal => fromUnits(toUnits(a) - toUnits(b));
export const mul = (a: Decimal, b: Decimal): Decimal => fromUnits((toUnits(a) * toUnits(b)) / FACTOR);

export function div(a: Decimal, b: Decimal): Decimal {
  const divisor = toUnits(b);
  if (divisor === 0n) throw new Error('Division by zero');
  return fromUnits((toUnits(a) * FACTOR) / divisor);
}

export const sum = (values: Decimal[]): Decimal =>
  fromUnits(values.reduce((acc, v) => acc + toUnits(v), 0n));

export const isZero = (a: Decimal): boolean => toUnits(a) === 0n;
export const compare = (a: Decimal, b: Decimal): -1 | 0 | 1 => {
  const [x, y] = [toUnits(a), toUnits(b)];
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Half-up rounding, the convention every Indian invoice uses. */
export function round(value: Decimal, decimals = 2): Decimal {
  const factor = 10n ** BigInt(SCALE - decimals);
  const units = toUnits(value);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const rounded = ((abs + factor / 2n) / factor) * factor;
  return fromUnits(negative ? -rounded : rounded);
}

/** 22K at 91.6% fineness on 10g = 9.16g of pure gold. */
export const fineWeight = (grossWeight: Decimal, purityPercent: Decimal): Decimal =>
  div(mul(grossWeight, purityPercent), '100');
