import { Router } from 'express';
import { z } from 'zod';
import { handler, param, requirePermission, validate } from '../../core/http/middleware.js';
import { transaction } from '../../core/db/client.js';
import { cancelSalesInvoice, createSalesInvoice, postSalesInvoice } from './sales.service.js';

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a number');

const lineSchema = z.object({
  itemId: z.string().uuid(),
  purityId: z.string().uuid().nullish(),
  pieceId: z.string().uuid().nullish(),
  locationId: z.string().uuid().nullish(),
  description: z.string().optional(),
  quantity: decimalString.optional(),
  grossWeight: decimalString,
  stoneWeight: decimalString.optional(),
  ratePerGram: decimalString.optional(),
  makingBasis: z.enum(['per_gram', 'percent', 'flat']).optional(),
  makingRate: decimalString.optional(),
  wastagePercent: decimalString.optional(),
  stoneAmount: decimalString.optional(),
  discountAmount: decimalString.optional(),
  hallmarkCharge: decimalString.optional(),
  gstRate: decimalString.optional(),
  notes: z.string().optional(),
});

const paymentSchema = z.object({
  mode: z.enum(['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'credit', 'old_gold', 'scheme', 'advance']),
  amount: decimalString,
  reference: z.string().optional(),
  accountId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export const salesRouter = Router();

salesRouter.post(
  '/invoices',
  requirePermission('trade.sales.create'),
  validate({
    body: z.object({
      customerId: z.string().uuid(),
      branchId: z.string().uuid(),
      docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      channel: z.enum(['counter', 'wholesale', 'export', 'online']).optional(),
      salespersonId: z.string().uuid().optional(),
      otherCharges: decimalString.optional(),
      notes: z.string().optional(),
      lines: z.array(lineSchema).min(1),
      payments: z.array(paymentSchema).optional(),
    }),
  }),
  handler(async (req, res) => {
    res.status(201).json(await transaction((tx) => createSalesInvoice(tx, req.body)));
  }),
);

salesRouter.post(
  '/invoices/:id/post',
  requirePermission('trade.sales.post'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  handler(async (req, res) => {
    res.json(await transaction((tx) => postSalesInvoice(tx, param(req, 'id'))));
  }),
);

salesRouter.post(
  '/invoices/:id/cancel',
  requirePermission('trade.sales.cancel'),
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ reason: z.string().min(3).max(500) }),
  }),
  handler(async (req, res) => {
    res.json(await transaction((tx) => cancelSalesInvoice(tx, param(req, 'id'), req.body.reason)));
  }),
);

salesRouter.get(
  '/invoices/:id',
  requirePermission('trade.sales.view'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  handler(async (req, res) => {
    const result = await transaction(async (tx) => {
      const invoice = await tx.one(`select * from sales_invoice where id = $1`, [param(req, 'id')]);
      const lines = await tx.query(
        `select l.*, i.name as item_name, i.code as item_code,
                p.code as purity_code, sp.tag_number
           from sales_invoice_line l
           join item i on i.id = l.item_id
           left join purity p on p.id = l.purity_id
           left join stock_piece sp on sp.id = l.piece_id
          where l.sales_invoice_id = $1
          order by l.line_number`,
        [param(req, 'id')],
      );
      const payments = await tx.query(
        `select * from sales_payment where sales_invoice_id = $1 order by received_at`,
        [param(req, 'id')],
      );
      return { ...invoice, lines, payments };
    });
    res.json(result);
  }),
);

salesRouter.get(
  '/invoices',
  requirePermission('trade.sales.view'),
  validate({
    query: z.object({
      status: z.string().optional(),
      customerId: z.string().uuid().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  }),
  handler(async (req, res) => {
    const q = req.query as unknown as { status?: string; customerId?: string; from?: string; to?: string; limit: number; offset: number };
    const rows = await transaction(async (tx) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (q.status) { params.push(q.status); clauses.push(`si.status = $${params.length}`); }
      if (q.customerId) { params.push(q.customerId); clauses.push(`si.customer_id = $${params.length}`); }
      if (q.from) { params.push(q.from); clauses.push(`si.doc_date >= $${params.length}`); }
      if (q.to) { params.push(q.to); clauses.push(`si.doc_date <= $${params.length}`); }

      return tx.query(
        `select si.id, si.doc_number, si.doc_date, si.status, si.channel, si.total_amount,
                si.balance_amount, si.total_net_weight, p.name as customer_name, b.name as branch_name
           from sales_invoice si
           join party p on p.id = si.customer_id
           join branch b on b.id = si.branch_id
          ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
          order by si.doc_date desc, si.doc_number desc
          limit ${q.limit} offset ${q.offset}`,
        params,
      );
    });
    res.json({ rows, limit: q.limit, offset: q.offset });
  }),
);
