import type { Tx } from '../db/client.js';

/**
 * Today in the shop's own time zone. Documents are dated by the shop's day:
 * a bill made at 1 a.m. in India is today's bill, though it is still yesterday in UTC.
 */
export async function businessDate(tx: Tx): Promise<string> {
  const row = await tx.one<{ d: string }>(`select (now() at time zone timezone)::date::text as d from tenant where id = $1`, [tx.context.tenantId]);
  return row.d;
}
