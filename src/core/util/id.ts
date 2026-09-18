import { randomUUID } from 'node:crypto';

/**
 * UUID v7: the first 48 bits are a millisecond timestamp, so ids sort roughly
 * by creation time. That keeps B-tree inserts at the right edge of the index
 * instead of scattering them, which matters once a table has millions of rows.
 */
export function newId(): string {
  const bytes = Buffer.alloc(16);
  const now = BigInt(Date.now());
  bytes.writeUIntBE(Number(now >> 16n), 0, 4);
  bytes.writeUInt16BE(Number(now & 0xffffn), 4);
  const random = Buffer.from(randomUUID().replace(/-/g, ''), 'hex');
  random.copy(bytes, 6, 6, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
