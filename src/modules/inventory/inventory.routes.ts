import { Router } from 'express';
import { z } from 'zod';
import { handler, requirePermission, validate } from '../../core/http/middleware.js';
import { transaction } from '../../core/db/client.js';
import { rebuildBalances } from './stock.service.js';

export const inventoryRouter = Router();

/** Current stock, item by item, with the branch and location it sits at. */
inventoryRouter.get(
  '/balances',
  requirePermission('stock.finished.view'),
  validate({
    query: z.object({
      branchId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      itemId: z.string().uuid().optional(),
      /** Hide rows that have netted to zero. */
      nonZeroOnly: z.coerce.boolean().default(true),
    }),
  }),
  handler(async (req, res) => {
    const q = req.query as unknown as { branchId?: string; locationId?: string; itemId?: string; nonZeroOnly: boolean };
    const rows = await transaction(async (tx) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (q.branchId) { params.push(q.branchId); clauses.push(`l.branch_id = $${params.length}`); }
      if (q.locationId) { params.push(q.locationId); clauses.push(`sb.location_id = $${params.length}`); }
      if (q.itemId) { params.push(q.itemId); clauses.push(`sb.item_id = $${params.length}`); }
      if (q.nonZeroOnly) clauses.push(`(sb.quantity <> 0 or sb.net_weight <> 0)`);

      return tx.query(
        `select sb.item_id, i.code as item_code, i.name as item_name, i.tracking,
                sb.purity_id, p.code as purity_code,
                sb.location_id, l.name as location_name, l.branch_id, b.name as branch_name,
                sb.quantity, sb.gross_weight, sb.net_weight, sb.fine_weight,
                sb.value, sb.average_rate, sb.last_movement_at
           from stock_balance sb
           join item i on i.id = sb.item_id
           join stock_location l on l.id = sb.location_id
           join branch b on b.id = l.branch_id
           left join purity p on p.id = sb.purity_id
          ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
          order by b.name, l.name, i.name`,
        params,
      );
    });
    res.json({ rows });
  }),
);

/** The journal behind a balance — what moved, when, and because of what. */
inventoryRouter.get(
  '/movements',
  requirePermission('stock.finished.view'),
  validate({
    query: z.object({
      itemId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      sourceType: z.string().optional(),
      sourceId: z.string().uuid().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
  }),
  handler(async (req, res) => {
    const q = req.query as unknown as Record<string, string | number | undefined>;
    const rows = await transaction(async (tx) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      for (const [key, column] of [
        ['itemId', 'sm.item_id'], ['locationId', 'sm.location_id'],
        ['sourceType', 'sm.source_type'], ['sourceId', 'sm.source_id'],
      ] as const) {
        if (q[key]) { params.push(q[key]); clauses.push(`${column} = $${params.length}`); }
      }
      if (q.from) { params.push(q.from); clauses.push(`sm.moved_at >= $${params.length}`); }
      if (q.to) { params.push(q.to); clauses.push(`sm.moved_at <= $${params.length}`); }

      return tx.query(
        `select sm.*, i.code as item_code, i.name as item_name, l.name as location_name
           from stock_movement sm
           join item i on i.id = sm.item_id
           join stock_location l on l.id = sm.location_id
          ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
          order by sm.moved_at desc, sm.created_at desc
          limit ${Number(q.limit ?? 100)}`,
        params,
      );
    });
    res.json({ rows });
  }),
);

/**
 * Recomputes every balance from the movement journal. Nothing should ever need
 * this, which is exactly why it exists.
 */
inventoryRouter.post(
  '/balances/rebuild',
  requirePermission('stock.verification.approve'),
  handler(async (_req, res) => {
    const rebuilt = await transaction(rebuildBalances);
    res.json({ ok: true, rebuilt });
  }),
);
