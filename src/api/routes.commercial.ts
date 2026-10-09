/** Old Gold, Swarna Nidhi schemes, Girvi, Ledgers and SaaS admin. */
import { z } from 'zod';
import { defineRoute, queryOf } from '../core/http/route-registry.js';
import { defineCrud } from './crud.js';
import { transaction } from '../core/db/client.js';
import { repo } from '../core/db/repository.js';
import { param } from '../core/http/middleware.js';
import { newId } from '../core/util/id.js';
import { add, compare, div, mul, sub, sum } from '../core/util/decimal.js';
import { nextDocumentNumber } from '../modules/numbering/numbering.service.js';
import { decimal, errorEnvelope, idParam, isoDate, listOf, money, ok, pagination, phone, record, uuid, weight } from './schemas.js';

const TODAY = '2026-09-18';
const seed = [{ date: TODAY, kind: 'added' as const, note: 'Initial endpoint.' }];

/* Old gold lives in routes.oldgold.ts. */

/* -------------------------------------------------------- ledgers */

defineRoute({
  method: 'get', path: '/api/accounts/metal-ledger', module: 'accounts',
  summary: 'The precious metal ledger, in fine grams',
  description: 'The gram side of the dual ledger. Weights are fine (pure) so purities are comparable.',
  permission: 'accounts.metal.view',
  query: z.object({ accountId: uuid.optional(), partyId: uuid.optional(), metalId: uuid.optional(),
    from: isoDate.optional(), to: isoDate.optional() }).merge(pagination),
  responses: [{ status: 200, description: 'Metal entries with a running balance.', schema: z.object({ rows: z.array(record), balance: weight }) }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Dual-ledger metal side.' }],
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    for (const [key, col] of [['accountId', 'm.account_id'], ['partyId', 'm.party_id'], ['metalId', 'm.metal_id']] as const) {
      if (q[key]) { params.push(q[key]); clauses.push(`${col} = $${params.length}`); }
    }
    if (q.from) { params.push(q.from); clauses.push(`m.entry_date >= $${params.length}`); }
    if (q.to) { params.push(q.to); clauses.push(`m.entry_date <= $${params.length}`); }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const rows = await tx.query<{ weight_in: string; weight_out: string }>(
      `select m.*, a.name as account_name, p.name as party_name, mt.code as metal_code, pu.code as purity_code, v.voucher_number
         from metal_ledger_entry m join account a on a.id = m.account_id
         join metal mt on mt.id = m.metal_id join voucher v on v.id = m.voucher_id
         left join party p on p.id = m.party_id left join purity pu on pu.id = m.purity_id
        ${where} order by m.entry_date desc, m.created_at desc
        limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params);
    return { rows, balance: sub(sum(rows.map((r) => r.weight_in)), sum(rows.map((r) => r.weight_out))) };
  }),
});

defineRoute({
  method: 'get', path: '/api/accounts/trial-balance', module: 'accounts',
  summary: 'Trial balance',
  description: 'Debits and credits per account. If these do not match, something is badly wrong — they always should.',
  permission: 'accounts.cash.view',
  query: z.object({ from: isoDate.optional(), to: isoDate.optional(), branchId: uuid.optional() }),
  responses: [{ status: 200, description: 'Per-account totals plus the grand totals.', schema: z.object({
    rows: z.array(record), totalDebit: money, totalCredit: money, balanced: z.boolean() }) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<{ from?: string; to?: string; branchId?: string }>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    if (q.from) { params.push(q.from); clauses.push(`le.entry_date >= $${params.length}`); }
    if (q.to) { params.push(q.to); clauses.push(`le.entry_date <= $${params.length}`); }
    if (q.branchId) { params.push(q.branchId); clauses.push(`le.branch_id = $${params.length}`); }
    const rows = await tx.query<{ debit: string; credit: string }>(
      `select a.code, a.name, a.account_type, sum(le.debit)::text debit, sum(le.credit)::text credit
         from ledger_entry le join account a on a.id = le.account_id
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
        group by a.code, a.name, a.account_type having sum(le.debit) + sum(le.credit) > 0
        order by a.code`, params);
    const totalDebit = sum(rows.map((r) => r.debit));
    const totalCredit = sum(rows.map((r) => r.credit));
    return { rows, totalDebit, totalCredit, balanced: compare(totalDebit, totalCredit) === 0 };
  }),
});

defineRoute({
  method: 'get', path: '/api/accounts/karigar-ledger', module: 'accounts',
  summary: 'Karigar metal and ghat ledger',
  description:
    'Metal issued to each goldsmith, what came back, and the ghat (loss). Loss above the agreed allowance is recoverable and is what this screen exists to surface.',
  permission: 'accounts.ghat.view',
  query: z.object({ karigarId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() }).merge(pagination),
  responses: [{ status: 200, description: 'Karigar entries with balances.', schema: z.object({ rows: z.array(record), metalBalance: weight }) }],
  changelog: [{ date: TODAY, kind: 'added', note: 'Ghat ledger.' }],
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    if (q.karigarId) { params.push(q.karigarId); clauses.push(`kl.karigar_id = $${params.length}`); }
    if (q.from) { params.push(q.from); clauses.push(`kl.entry_date >= $${params.length}`); }
    if (q.to) { params.push(q.to); clauses.push(`kl.entry_date <= $${params.length}`); }
    const rows = await tx.query<{ weight_in: string; weight_out: string }>(
      `select kl.*, k.name as karigar_name, k.standard_ghat_percent, o.order_number
         from karigar_ledger kl join karigar k on k.id = kl.karigar_id
         left join retail_order o on o.id = kl.retail_order_id
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
        order by kl.entry_date desc limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params);
    return { rows, metalBalance: sub(sum(rows.map((r) => r.weight_out)), sum(rows.map((r) => r.weight_in))) };
  }),
});
