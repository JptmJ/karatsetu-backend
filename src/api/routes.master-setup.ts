/** Bill numbers and print formats — how documents are numbered and what they look like on paper. */
import { z } from 'zod';
import { defineRoute } from '../core/http/route-registry.js';
import { transaction, type Tx } from '../core/db/client.js';
import { repo } from '../core/db/repository.js';
import { recordAudit } from '../core/audit.js';
import { param } from '../core/http/middleware.js';
import { ValidationError } from '../core/errors/app-error.js';
import { formatSeriesNumber, nextCounter, periodKey, type SeriesRow } from '../modules/numbering/numbering.service.js';
import { DOCUMENT_TYPES, HEADER_STYLES, PAPER_SIZES } from '../modules/masters/masters.schema.js';
import { errorEnvelope, idParam, uuid } from './schemas.js';

const changelog = [{ date: '2026-09-29', kind: 'added' as const, note: 'Initial endpoint.' }];

/* -------------------------------------------------------- bill numbers */

type FyFormat = 'YY-YY' | 'YYYY' | 'none';
const FY_TOKEN: Record<FyFormat, string | null> = { 'YY-YY': '{FYS}', YYYY: '{FYY}', none: null };

/** Reads the stored template back into the parts the screen edits. Older templates ("INV/{FY}/") read as closely as they can. */
function describeTemplate(prefix: string) {
  const fy: FyFormat = /\{FYY\}|\{YYYY\}/.test(prefix) ? 'YYYY' : /\{FYS\}|\{FY\}|\{YY\}/.test(prefix) ? 'YY-YY' : 'none';
  const text = prefix.replace(/\{[A-Z]+\}/g, ' ').split(/[\s/-]+/).filter(Boolean).join('-');
  return { prefix: text, financialYearFormat: fy, hasBranch: prefix.includes('{BRANCH}') };
}

/** INV + per-branch + YY-YY → "INV-{BRANCH}-{FYS}-", which prints INV-ZB-26-27-00042. */
function buildTemplate(prefix: string, perBranch: boolean, fy: FyFormat): string {
  const parts = [prefix.trim().toUpperCase(), perBranch ? '{BRANCH}' : '', FY_TOKEN[fy] ?? ''].filter(Boolean);
  return parts.length ? `${parts.join('-')}-` : '';
}

type Series = SeriesRow & { name: string; is_active: boolean };

async function describeSeries(tx: Tx, shared: Series, branchRows: Series[]) {
  const branch = await tx.maybeOne<{ code: string }>(`select code from branch where id = $1`, [tx.context.branchId]);
  const now = new Date();
  const perBranch = branchRows.some((r) => r.is_active);
  const current = (perBranch && branchRows.find((r) => r.branch_id === tx.context.branchId && r.is_active)) || shared;
  const parts = describeTemplate(shared.prefix);
  return {
    id: shared.id,
    docType: shared.doc_type,
    name: shared.name,
    prefix: parts.prefix,
    digitPadding: shared.padding,
    lastNumber: Number(nextCounter(current, now) - 1n),
    financialYearReset: shared.reset_period !== 'never',
    financialYearFormat: parts.financialYearFormat,
    branchScope: perBranch || parts.hasBranch ? 'per_branch' as const : 'shared' as const,
    nextNumberPreview: formatSeriesNumber(current, nextCounter(current, now), now, branch?.code ?? null),
  };
}

async function loadSeries(tx: Tx, docType?: string): Promise<Map<string, { shared: Series; branchRows: Series[] }>> {
  const rows = await tx.query<Series>(
    `select * from numbering_series where ($1::text is null or doc_type = $1) order by doc_type, branch_id nulls first`,
    [docType ?? null],
  );
  const byType = new Map<string, { shared: Series; branchRows: Series[] }>();
  for (const row of rows) {
    if (row.branch_id === null) byType.set(row.doc_type, { shared: row, branchRows: [] });
    else byType.get(row.doc_type)?.branchRows.push(row);
  }
  return byType;
}

const seriesView = z.object({
  id: uuid, docType: z.string(), name: z.string(), prefix: z.string(), digitPadding: z.number(),
  lastNumber: z.number().describe('The last number handed out in the current period. 0 = none yet.'),
  financialYearReset: z.boolean().describe('Counter starts again at 1 each April.'),
  financialYearFormat: z.enum(['YY-YY', 'YYYY', 'none']),
  branchScope: z.enum(['shared', 'per_branch']),
  nextNumberPreview: z.string().describe('Exactly what the next document at your branch will get.'),
});

defineRoute({
  method: 'get', path: '/api/master/numbering', module: 'master',
  summary: 'Bill number series',
  description: 'One entry per document type. The preview is worked out by the same code that numbers real documents.',
  permission: 'settings.numbering.view',
  responses: [{ status: 200, description: 'Series.', schema: z.object({ rows: z.array(seriesView) }) }],
  changelog,
  handler: async () => transaction(async (tx) => ({
    rows: await Promise.all([...(await loadSeries(tx)).values()].map((s) => describeSeries(tx, s.shared, s.branchRows))),
  })),
});

defineRoute({
  method: 'patch', path: '/api/master/numbering/:id', module: 'master',
  summary: 'Change a bill number series',
  description:
    'Shared: one counter for all branches. Per branch: each branch counts on its own and its code is part of the number, so two branches can never produce the same number. `lastNumber` can only move forward (e.g. to continue from old software); going back would reissue numbers.',
  permission: 'settings.numbering.update',
  params: idParam,
  body: z.object({
    name: z.string().min(1).max(80).optional(),
    prefix: z.string().trim().regex(/^[A-Za-z0-9]{0,12}$/, 'Use up to 12 letters or digits.'),
    digitPadding: z.number().int().min(1).max(10),
    lastNumber: z.number().int().min(0).optional(),
    financialYearReset: z.boolean(),
    financialYearFormat: z.enum(['YY-YY', 'YYYY', 'none']),
    branchScope: z.enum(['shared', 'per_branch']),
  }),
  responses: [
    { status: 200, description: 'Saved; the series as it now stands.', schema: seriesView },
    { status: 400, description: 'The last number would go backwards, or a yearly restart without the year in the number.', schema: errorEnvelope },
  ],
  changelog,
  handler: async (req) => transaction(async (tx) => {
    const b = req.body;
    const shared = await tx.one<Series>(`select * from numbering_series where id = $1 and branch_id is null for update`, [param(req, 'id')]);
    const perBranch = b.branchScope === 'per_branch';
    if (b.financialYearReset && b.financialYearFormat === 'none') {
      throw new ValidationError('A series that restarts every April must show the year, or next year would repeat this year’s numbers.');
    }
    const format = {
      prefix: buildTemplate(b.prefix, perBranch, b.financialYearFormat),
      suffix: '',
      padding: b.digitPadding,
      reset_period: (!b.financialYearReset ? 'never' : shared.reset_period === 'never' ? 'financial_yearly' : shared.reset_period) as SeriesRow['reset_period'],
    };

    const values: Record<string, unknown> = { ...format, ...(b.name ? { name: b.name } : {}) };
    if (b.lastNumber !== undefined) {
      const issued = nextCounter(shared, new Date()) - 1n;
      if (BigInt(b.lastNumber) < issued) {
        throw new ValidationError(`Numbers up to ${issued} have already been used. The last number cannot go back.`);
      }
      values.next_number = String(b.lastNumber + 1);
    }
    if (b.lastNumber !== undefined || format.reset_period !== shared.reset_period) {
      // The counter belongs to this period, so the change is not undone by an immediate "new year" reset.
      values.current_period = periodKey(format.reset_period, new Date());
    }
    await repo(tx, 'numbering_series').update(shared.id, values);

    // Per branch: every active branch gets its own counter in the same format.
    await tx.query(`update numbering_series set prefix = $2, suffix = '', padding = $3, reset_period = $4, is_active = $5
                     where doc_type = $1 and branch_id is not null`,
      [shared.doc_type, format.prefix, format.padding, format.reset_period, perBranch]);
    if (perBranch) {
      await tx.query(
        `insert into numbering_series (id, tenant_id, doc_type, branch_id, name, prefix, padding, reset_period, created_by, updated_by)
         select gen_random_uuid(), $1, $2, b.id, $3, $4, $5, $6, $7, $7 from branch b
          where b.is_active and b.deleted_at is null
            and not exists (select 1 from numbering_series s where s.doc_type = $2 and s.branch_id = b.id)`,
        [tx.context.tenantId, shared.doc_type, shared.name, format.prefix, format.padding, format.reset_period, tx.context.userId]);
    }
    await recordAudit(tx, 'numbering_series.update', 'numbering_series', shared.id, b);

    const { shared: updated, branchRows } = (await loadSeries(tx, shared.doc_type)).get(shared.doc_type)!;
    return describeSeries(tx, updated, branchRows);
  }),
});

/* ------------------------------------------------------- print formats */

const TOGGLES = [
  'showWeightBreakdown', 'showGstSplit', 'showHuidList', 'showQrCode',
  'showBankDetails', 'showTermsAndConditions', 'showCashierSignature', 'showCustomerSignature',
] as const;
type Toggles = Record<(typeof TOGGLES)[number], boolean>;
const on = (...keys: (typeof TOGGLES)[number][]): Toggles =>
  Object.fromEntries(TOGGLES.map((k) => [k, keys.includes(k)])) as Toggles;

/** What a new business starts with. Each can then be changed on the Print Formats screen. */
const DEFAULT_FORMATS = [
  { code: 'invoice-a4', doc_type: 'invoice', title: 'Standard Tax Invoice (A4)', paper_size: 'A4', header_style: 'logo_top', numbering_doc_type: 'sales_invoice',
    field_toggles: on(...TOGGLES),
    terms: '1. Goods once sold can be exchanged within 7 days against new jewellery.\n2. Weight measured on a certified class-II balance.\n3. HUID hallmarking verified per BIS standards.\n4. Subject to local jurisdiction.' },
  { code: 'invoice-thermal', doc_type: 'invoice', title: 'Speed Billing Thermal Receipt (80mm Roll)', paper_size: 'Thermal_80mm', header_style: 'minimal', numbering_doc_type: 'sales_invoice',
    field_toggles: on('showWeightBreakdown', 'showGstSplit', 'showHuidList', 'showQrCode'),
    terms: 'Thank you for shopping with us. Exchange with bill within 7 days.' },
  { code: 'advance-receipt', doc_type: 'advance_receipt', title: 'Advance Booking & Rate Lock Receipt', paper_size: 'A4', header_style: 'logo_top', numbering_doc_type: 'retail_order',
    field_toggles: on('showWeightBreakdown', 'showQrCode', 'showBankDetails', 'showTermsAndConditions', 'showCashierSignature', 'showCustomerSignature'),
    terms: '1. Rate lock applies strictly to the specified gold weight.\n2. Advance is non-refundable upon cancellation; a store credit voucher will be provided.' },
  { code: 'old-gold-voucher', doc_type: 'old_gold_voucher', title: 'Old Gold Exchange & Valuation Voucher', paper_size: 'A4', header_style: 'logo_top', numbering_doc_type: 'old_gold',
    field_toggles: on('showWeightBreakdown', 'showQrCode', 'showTermsAndConditions', 'showCashierSignature', 'showCustomerSignature'),
    terms: '1. Customer affirms sole legal ownership of the surrendered ornaments.\n2. Purity tested per XRF reading.\n3. Valuation valid for exchange credit today.' },
  { code: 'scheme-receipt', doc_type: 'scheme_receipt', title: 'Gold Savings Instalment Receipt', paper_size: 'Thermal_80mm', header_style: 'minimal', numbering_doc_type: 'scheme_account',
    field_toggles: on('showQrCode', 'showCashierSignature'),
    terms: 'On-time instalments qualify for the plan bonus.' },
  { code: 'girvi-ticket', doc_type: 'girvi_pawn_ticket', title: 'Gold Loan Pledge Ticket', paper_size: 'A4', header_style: 'letterhead_preprinted', numbering_doc_type: 'girvi_loan',
    field_toggles: on('showWeightBreakdown', 'showQrCode', 'showBankDetails', 'showTermsAndConditions', 'showCashierSignature', 'showCustomerSignature'),
    terms: '1. Pledged ornaments sealed in a tamper-evident vault packet.\n2. Monthly interest payable on the due date.\n3. Notice will be sent 30 days before auction in case of default.' },
] as const;

const formatView = z.object({
  id: uuid, code: z.string(), doc_type: z.enum(DOCUMENT_TYPES), title: z.string(),
  paper_size: z.enum(PAPER_SIZES), header_style: z.enum(HEADER_STYLES), numbering_doc_type: z.string().nullable(),
  field_toggles: z.record(z.string(), z.boolean()), terms: z.string(), updated_at: z.string(),
});

defineRoute({
  method: 'get', path: '/api/master/document-formats', module: 'master',
  summary: 'Print formats',
  description: 'A business that has none yet gets the six standard formats on first call.',
  permission: 'master.documents.view',
  responses: [{ status: 200, description: 'Formats.', schema: z.object({ rows: z.array(formatView) }) }],
  changelog,
  handler: async () => transaction(async (tx) => {
    const list = () => tx.query(`select * from document_format order by doc_type, code`);
    let rows = await list();
    if (rows.length === 0) {
      await repo(tx, 'document_format').insertMany(DEFAULT_FORMATS.map((f) => ({ ...f, field_toggles: JSON.stringify(f.field_toggles) })));
      rows = await list();
    }
    return { rows };
  }),
});

defineRoute({
  method: 'patch', path: '/api/master/document-formats/:id', module: 'master',
  summary: 'Change a print format',
  description: 'Send only what changed. `field_toggles` is merged, so one switch can be sent on its own.',
  permission: 'master.documents.update',
  params: idParam,
  body: z.object({
    title: z.string().min(1).max(120).optional(),
    paper_size: z.enum(PAPER_SIZES).optional(),
    header_style: z.enum(HEADER_STYLES).optional(),
    field_toggles: z.object(Object.fromEntries(TOGGLES.map((k) => [k, z.boolean().optional()]))).strict().optional(),
    terms: z.string().max(4000).optional(),
  }),
  responses: [{ status: 200, description: 'Saved.', schema: formatView }, { status: 404, description: 'Not found.', schema: errorEnvelope }],
  changelog,
  handler: async (req) => transaction(async (tx) => {
    const id = param(req, 'id');
    const { field_toggles, ...rest } = req.body as { field_toggles?: Record<string, boolean> } & Record<string, unknown>;
    const values: Record<string, unknown> = { ...rest };
    if (field_toggles) {
      const current = await repo<{ field_toggles: Record<string, boolean> }>(tx, 'document_format').getById(id);
      values.field_toggles = JSON.stringify({ ...current.field_toggles, ...field_toggles });
    }
    const saved = await repo(tx, 'document_format').update(id, values);
    await recordAudit(tx, 'document_format.update', 'document_format', id, req.body);
    return saved;
  }),
});

