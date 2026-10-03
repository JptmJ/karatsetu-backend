/**
 * Masters that change prices: GST (versioned), price rules (validated), and
 * payment methods (per-branch). Every write is audited by defineCrud.
 */
import { z } from 'zod';
import { defineCrud } from './crud.js';
import { defineRoute } from '../core/http/route-registry.js';
import { transaction, type Tx } from '../core/db/client.js';
import { repo } from '../core/db/repository.js';
import { recordAudit } from '../core/audit.js';
import { param } from '../core/http/middleware.js';
import { ValidationError } from '../core/errors/app-error.js';
import { validateSlabs, type Slab } from '../modules/masters/pricing/engine.js';
import { boolParam, decimal, idParam, money, uuid } from './schemas.js';

const B = '/api/master';
const changelog = [{ date: '2026-09-27', kind: 'added' as const, note: 'Pricing masters.' }];
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-01.');
type Row = Record<string, unknown>;

async function tenantToday(tx: Tx): Promise<string> {
  const row = await tx.one<{ today: string }>(
    `select (now() at time zone timezone)::date::text as today from tenant where id = $1`, [tx.context.tenantId],
  );
  return row.today;
}

// ── GST & Tax — versioned, never edited in place ─────────────────────────

const GST_COMPONENTS = ['metal', 'making', 'stone', 'service', 'hallmark', 'other'] as const;

defineCrud({
  basePath: B, resource: 'gst-rates', table: 'hsn_gst_rate', module: 'master', label: 'GST rate',
  permission: 'master.tax', searchColumns: ['hsn_code', 'description'],
  defaultOrder: 'hsn_code, component, effective_from desc',
  listSelect: `*, (effective_from <= current_date and (effective_to is null or effective_to >= current_date)) as is_current`,
  filters: {
    hsn_code: z.string().optional(), component: z.enum(GST_COMPONENTS).optional(),
    code_type: z.enum(['hsn', 'sac']).optional(),
  },
  changelog,
  createSchema: z.object({
    hsn_code: z.string().regex(/^\d{4,8}$/, 'HSN and SAC codes are 4 to 8 digits.'),
    code_type: z.enum(['hsn', 'sac']).default('hsn'),
    description: z.string().max(200).optional(),
    component: z.enum(GST_COMPONENTS),
    gst_rate: decimal.describe('Total GST %, e.g. 3. CGST/SGST/IGST are derived from it.'),
    cess_rate: decimal.optional(),
    is_reverse_charge: z.boolean().default(false),
    effective_from: dateString,
    source_note: z.string().max(500).optional().describe('Notification number or CA confirmation.'),
  }),
  // The rate itself never changes in place — add a new version instead.
  updateSchema: z.object({ description: z.string().max(200).nullish(), source_note: z.string().max(500).nullish() }),
  hooks: {
    beforeCreate: async (tx, v) => {
      const open = await tx.maybeOne<{ id: string; eff: string }>(
        `select id, effective_from::text as eff from hsn_gst_rate
          where hsn_code = $1 and component = $2 and effective_to is null
          for update`,
        [v.hsn_code, v.component],
      );
      if (open) {
        const from = String(v.effective_from);
        if (from <= open.eff) throw new ValidationError(`The current version starts on ${open.eff}. A new version must start after that.`);
        if (from < (await tenantToday(tx))) throw new ValidationError('A new GST version can start today or later, not in the past.');
        await tx.query(
          `update hsn_gst_rate set effective_to = ($2::date - 1), updated_at = now(), updated_by = $3 where id = $1`,
          [open.id, from, tx.context.userId],
        );
      }
      return v;
    },
    beforeDelete: async (tx, row) => {
      const r = await tx.one<{ eff: string; hsn: string; comp: string }>(
        `select effective_from::text as eff, hsn_code as hsn, component as comp from hsn_gst_rate where id = $1`, [row.id],
      );
      if (r.eff <= (await tenantToday(tx))) {
        throw new ValidationError('This rate is already in force and may be on invoices. Add a new version instead of deleting it.');
      }
      // Deleting a future version re-opens the one before it.
      await tx.query(
        `update hsn_gst_rate set effective_to = null where hsn_code = $1 and component = $2 and effective_to = ($3::date - 1)`,
        [r.hsn, r.comp, r.eff],
      );
    },
  },
});

// ── Price rules — slabs validated on save ────────────────────────────────

const slab = z.object({ fromG: decimal, toG: decimal.nullable(), rate: decimal });
const ruleFields = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  applies_to: z.enum(['making', 'wastage', 'hallmark']).describe('Stones are priced from the value on each tag; discounts are given on the bill, on making and wastage.'),
  basis: z.enum(['per_gram', 'percent', 'flat', 'slab', 'hybrid']),
  rate: decimal.nullish(),
  flat_amount: decimal.nullish(),
  slabs: z.array(slab).max(50),
  slab_mode: z.enum(['whole', 'tiered']),
  minimum_amount: decimal.nullish(),
  metal_id: uuid.nullish(), purity_id: uuid.nullish(), item_category_id: uuid.nullish(),
  item_id: uuid.nullish(), branch_id: uuid.nullish(),
  priority: z.number().int().min(-100).max(100),
  effective_from: dateString,
  effective_to: dateString.nullish(),
  is_active: z.boolean(),
});

function checkRule(r: Row): void {
  if (r.basis === 'slab') validateSlabs((r.slabs as Slab[] | undefined) ?? []);
  else if (r.rate === null || r.rate === undefined) throw new ValidationError('Enter a rate for this rule.');
  if (r.basis === 'hybrid' && (r.flat_amount === null || r.flat_amount === undefined)) {
    throw new ValidationError('A hybrid rule needs both a percentage and a fixed amount.');
  }
}
/** jsonb must be sent as JSON text — node-pg turns JS arrays into Postgres arrays. */
const withJsonSlabs = (v: Row): Row => ('slabs' in v ? { ...v, slabs: JSON.stringify(v.slabs) } : v);

defineCrud({
  basePath: B, resource: 'price-rules', table: 'price_rule', module: 'master', label: 'price rule',
  permission: 'master.pricing', searchColumns: ['code', 'name'],
  defaultOrder: 'applies_to, priority desc, name',
  filters: {
    applies_to: z.enum(['making', 'wastage', 'stone', 'hallmark', 'discount']).optional(),
    is_active: boolParam.optional(), metal_id: uuid.optional(),
    item_category_id: uuid.optional(), branch_id: uuid.optional(),
  },
  changelog,
  createSchema: ruleFields.extend({
    slabs: z.array(slab).max(50).default([]),
    slab_mode: z.enum(['whole', 'tiered']).default('whole'),
    priority: z.number().int().min(-100).max(100).default(0),
    effective_from: dateString.optional(),
    is_active: z.boolean().default(true),
  }),
  updateSchema: ruleFields.omit({ code: true }).partial(),
  hooks: {
    beforeCreate: (_tx, v) => {
      checkRule(v);
      return withJsonSlabs({ ...v, code: String(v.code).trim().toUpperCase() });
    },
    beforeUpdate: (_tx, v, current) => {
      checkRule({ ...current, ...v });
      return withJsonSlabs(v);
    },
  },
});

// ── Payment methods — offered per branch ─────────────────────────────────

const PAYMENT_KINDS = ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'credit', 'old_gold', 'scheme', 'advance', 'emi', 'wallet'] as const;

async function checkLedger(tx: Tx, accountId: unknown): Promise<void> {
  if (!accountId) return;
  const acc = await tx.maybeOne<{ account_type: string }>(
    `select account_type from account where id = $1 and deleted_at is null`, [accountId],
  );
  if (!acc) throw new ValidationError('That ledger account does not exist.');
  if (acc.account_type !== 'asset') throw new ValidationError('Money must land in an asset ledger — Cash in Hand or a bank account.');
}

const paymentFields = z.object({
  name: z.string().min(1).max(80),
  account_id: uuid.nullish().describe('Ledger the money lands in.'),
  requires_reference: z.boolean(),
  charges_percent: decimal.nullish(),
  max_amount: money.nullish().describe('Per-tender limit. Empty = no limit.'),
  sort_order: z.number().int(),
  is_active: z.boolean(),
});

defineCrud({
  basePath: B, resource: 'payment-methods', table: 'payment_method', module: 'master', label: 'payment method',
  permission: 'master.payment', searchColumns: ['code', 'name'], defaultOrder: 'sort_order, name',
  listSelect: `*, coalesce((select array_agg(pb.branch_id) from payment_method_branch pb
                             where pb.payment_method_id = payment_method.id), '{}') as branch_ids`,
  filters: { kind: z.enum(PAYMENT_KINDS).optional(), is_active: boolParam.optional() },
  changelog,
  createSchema: paymentFields.extend({
    code: z.string().min(1).max(20),
    kind: z.enum(PAYMENT_KINDS).describe('How the system settles it. Cannot be changed later.'),
    requires_reference: z.boolean().default(false),
    sort_order: z.number().int().default(0),
    is_active: z.boolean().default(true),
  }),
  updateSchema: paymentFields.partial(),
  hooks: {
    beforeCreate: async (tx, v) => {
      await checkLedger(tx, v.account_id);
      return { ...v, code: String(v.code).trim().toUpperCase() };
    },
    beforeUpdate: async (tx, v) => {
      await checkLedger(tx, v.account_id);
      return v;
    },
  },
});

defineRoute({
  method: 'put', path: `${B}/payment-methods/:id/branches`, module: 'master', permission: 'master.payment.update',
  summary: 'Choose which branches offer this payment method',
  description: 'Send the full list. An empty list means every branch.',
  params: idParam,
  body: z.object({ branchIds: z.array(uuid).max(500) }),
  responses: [{ status: 204, description: 'Saved.' }],
  changelog,
  handler: async (req) => {
    await transaction(async (tx) => {
      const id = param(req, 'id');
      await repo(tx, 'payment_method').getById(id);
      const ids = [...new Set(req.body.branchIds as string[])];
      if (ids.length) {
        const found = await tx.query(`select id from branch where id = any($1::uuid[]) and deleted_at is null`, [ids]);
        if (found.length !== ids.length) throw new ValidationError('One of those branches does not exist.');
      }
      await tx.query(`delete from payment_method_branch where payment_method_id = $1`, [id]);
      await repo(tx, 'payment_method_branch').insertMany(ids.map((branch_id) => ({ payment_method_id: id, branch_id })));
      await recordAudit(tx, 'payment_method.branches', 'payment_method', id, { branchIds: ids });
    });
  },
});
