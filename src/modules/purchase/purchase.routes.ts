import { Router } from 'express';
import { z } from 'zod';
import { handler, param, requirePermission, validate } from '../../core/http/middleware.js';
import { transaction } from '../../core/db/client.js';
import { cancelPurchaseInvoice, createPurchaseInvoice, postPurchaseInvoice } from './purchase.service.js';

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a number');

const lineSchema = z.object({
  itemId: z.string().uuid(),
  purityId: z.string().uuid().nullish(),
  locationId: z.string().uuid().nullish(),
  description: z.string().optional(),
  quantity: decimalString.optional(),
  grossWeight: decimalString,
  stoneWeight: decimalString.optional(),
  ratePerGram: decimalString,
  makingBasis: z.enum(['per_gram', 'percent', 'flat']).optional(),
  makingRate: decimalString.optional(),
  wastagePercent: decimalString.optional(),
  stoneAmount: decimalString.optional(),
  discountAmount: decimalString.optional(),
  gstRate: decimalString.optional(),
  notes: z.string().optional(),
});

export const purchaseRouter = Router();

purchaseRouter.post(
  '/invoices',
  requirePermission('trade.purchase.create'),
  validate({
    body: z.object({
      supplierId: z.string().uuid(),
      branchId: z.string().uuid(),
      docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      supplierInvoiceNumber: z.string().optional(),
      supplierInvoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      goodsReceiptId: z.string().uuid().optional(),
      purchaseOrderId: z.string().uuid().optional(),
      raisesStock: z.boolean().optional(),
      otherCharges: decimalString.optional(),
      notes: z.string().optional(),
      lines: z.array(lineSchema).min(1),
    }),
  }),
  handler(async (req, res) => {
    res.status(201).json(await transaction((tx) => createPurchaseInvoice(tx, req.body)));
  }),
);

purchaseRouter.post(
  '/invoices/:id/post',
  requirePermission('trade.purchase.post'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  handler(async (req, res) => {
    res.json(await transaction((tx) => postPurchaseInvoice(tx, param(req, 'id'))));
  }),
);

purchaseRouter.post(
  '/invoices/:id/cancel',
  requirePermission('trade.purchase.cancel'),
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ reason: z.string().min(3).max(500) }),
  }),
  handler(async (req, res) => {
    res.json(await transaction((tx) => cancelPurchaseInvoice(tx, param(req, 'id'), req.body.reason)));
  }),
);

purchaseRouter.get(
  '/invoices/:id',
  requirePermission('trade.purchase.view'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  handler(async (req, res) => {
    const result = await transaction(async (tx) => {
      const invoice = await tx.one(`select * from purchase_invoice where id = $1`, [param(req, 'id')]);
      const lines = await tx.query(
        `select l.*, i.name as item_name, i.code as item_code, p.code as purity_code
           from purchase_invoice_line l
           join item i on i.id = l.item_id
           left join purity p on p.id = l.purity_id
          where l.purchase_invoice_id = $1
          order by l.line_number`,
        [param(req, 'id')],
      );
      return { ...invoice, lines };
    });
    res.json(result);
  }),
);

purchaseRouter.get(
  '/invoices',
  requirePermission('trade.purchase.view'),
  validate({
    query: z.object({
      status: z.string().optional(),
      supplierId: z.string().uuid().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  }),
  handler(async (req, res) => {
    const q = req.query as unknown as { status?: string; supplierId?: string; from?: string; to?: string; limit: number; offset: number };
    const rows = await transaction(async (tx) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (q.status) { params.push(q.status); clauses.push(`pi.status = $${params.length}`); }
      if (q.supplierId) { params.push(q.supplierId); clauses.push(`pi.supplier_id = $${params.length}`); }
      if (q.from) { params.push(q.from); clauses.push(`pi.doc_date >= $${params.length}`); }
      if (q.to) { params.push(q.to); clauses.push(`pi.doc_date <= $${params.length}`); }

      return tx.query(
        `select pi.id, pi.doc_number, pi.doc_date, pi.status, pi.total_amount,
                pi.total_net_weight, p.name as supplier_name, b.name as branch_name
           from purchase_invoice pi
           join party p on p.id = pi.supplier_id
           join branch b on b.id = pi.branch_id
          ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
          order by pi.doc_date desc, pi.doc_number desc
          limit ${q.limit} offset ${q.offset}`,
        params,
      );
    });
    res.json({ rows, limit: q.limit, offset: q.offset });
  }),
);
