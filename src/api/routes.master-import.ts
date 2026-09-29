/**
 * Bulk import for masters: a shop moving from other software brings thousands
 * of customers, items and karigars at once.
 *
 * The app reads the spreadsheet in the browser and sends it in chunks of up to
 * 1,000 rows. Each chunk is checked row by row with the same rules as the
 * single-record forms; good rows are saved in one statement, bad rows come back
 * with their spreadsheet row number and the reason. Rows are matched on `code`,
 * so sending the same file twice updates rather than duplicates, and a blank
 * cell never wipes a value already saved.
 */
import { z, type ZodType } from 'zod';
import { defineRoute } from '../core/http/route-registry.js';
import { transaction, type Tx } from '../core/db/client.js';
import { recordAudit } from '../core/audit.js';
import { param, requirePermission } from '../core/http/middleware.js';
import { getTable } from '../core/db/schema/registry.js';
import { quoteIdent } from '../core/db/schema/sql.js';
import { newId } from '../core/util/id.js';
import { reserveDocumentNumbers } from '../modules/numbering/numbering.service.js';
import { customerOrSupplier, karigarCreate, partyShape, withGstState } from './routes.master.js';
import { decimal, errorEnvelope } from './schemas.js';

type Row = Record<string, unknown>;

/** Spreadsheet cells arrive as text; these read "yes", "1", "12.5" the way a person typed them. */
const flag = z.preprocess((v) => (typeof v === 'string' ? ['yes', 'y', 'true', '1'].includes(v.trim().toLowerCase()) : v), z.boolean());
const list = z.preprocess((v) => (typeof v === 'string' ? v.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : v), z.array(z.string()).max(50));
const num = (s: ZodType) => z.preprocess((v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.replace(/,/g, '').trim() : v), s);

interface ImportKind {
  table: string;
  permission: string;
  schema: ZodType;
  /** Series that numbers rows sent without a code. */
  codeSeries?: string;
  /** Turns a checked row into table columns, or returns why it cannot be saved. */
  prepare?: (row: Row, lookups: Lookups) => Row | string;
}

interface Lookups { categories: Map<string, string>; metals: Map<string, string>; purities: Map<string, string> }

const KINDS: Record<string, ImportKind> = {
  customers: {
    table: 'party', permission: 'master.customer.create', codeSeries: 'party',
    schema: partyShape.extend({
      is_customer: flag.default(true), is_supplier: flag.default(false),
      credit_limit: num(decimal).optional(), credit_days: num(z.coerce.number().int().min(0)).optional(),
    }).refine(...customerOrSupplier),
  },
  karigars: {
    table: 'karigar', permission: 'master.karigar.create', codeSeries: 'karigar',
    schema: karigarCreate.extend({
      standard_ghat_percent: num(decimal).optional(), labour_rate_per_gram: num(decimal).optional(),
    }),
  },
  categories: {
    table: 'item_category', permission: 'master.item.create',
    schema: z.object({
      code: z.string().trim().min(1).max(30), name: z.string().trim().min(1),
      hsn_code: z.string().regex(/^\d{4,8}$/, 'HSN codes are 4 to 8 digits.').optional(),
      sub_categories: list.optional(), applicable_metals: list.optional(),
    }),
    prepare: (row) => ({
      ...row,
      code: String(row.code).toUpperCase(),
      ...(row.sub_categories ? { sub_categories: JSON.stringify(row.sub_categories) } : {}),
      ...(row.applicable_metals ? { applicable_metals: JSON.stringify((row.applicable_metals as string[]).map((m) => m.toUpperCase())) } : {}),
    }),
  },
  items: {
    table: 'item', permission: 'master.item.create',
    schema: z.object({
      code: z.string().trim().min(1).max(40), name: z.string().trim().min(1),
      category_code: z.string().trim().optional(), metal_code: z.string().trim().optional(), purity_code: z.string().trim().optional(),
      hsn_code: z.string().optional(),
      nature: z.enum(['raw_metal', 'finished', 'stone', 'consumable', 'service']).optional(),
      tracking: z.enum(['lot', 'piece']).optional(),
      uom: z.enum(['gram', 'piece', 'carat', 'millilitre']).optional(),
      default_making_rate: num(decimal).optional(), default_wastage_percent: num(decimal).optional(),
    }),
    prepare: (row, lk) => {
      const { category_code, metal_code, purity_code, ...rest } = row as Row & Record<'category_code' | 'metal_code' | 'purity_code', string | undefined>;
      const out: Row = { ...rest };
      if (category_code) {
        out.category_id = lk.categories.get(category_code.toUpperCase());
        if (!out.category_id) return `Category "${category_code}" does not exist. Import categories first.`;
      }
      if (metal_code) {
        out.metal_id = lk.metals.get(metal_code.toUpperCase());
        if (!out.metal_id) return `Metal "${metal_code}" does not exist.`;
      }
      if (purity_code) {
        if (!metal_code) return 'Give metal_code with purity_code.';
        out.default_purity_id = lk.purities.get(`${metal_code.toUpperCase()}|${purity_code.toUpperCase()}`);
        if (!out.default_purity_id) return `Purity "${purity_code}" does not exist for ${metal_code}.`;
      }
      return out;
    },
  },
};

async function loadLookups(tx: Tx): Promise<Lookups> {
  const [categories, metals, purities] = await Promise.all([
    tx.query<{ code: string; id: string }>(`select upper(code) as code, id from item_category`),
    tx.query<{ code: string; id: string }>(`select upper(code) as code, id from metal`),
    tx.query<{ code: string; id: string }>(`select upper(m.code) || '|' || upper(p.code) as code, p.id from purity p join metal m on m.id = p.metal_id`),
  ]);
  const toMap = (rows: { code: string; id: string }[]) => new Map(rows.map((r) => [r.code, r.id]));
  return { categories: toMap(categories), metals: toMap(metals), purities: toMap(purities) };
}

/** One insert for the whole chunk; an existing code is updated, keeping any value the file leaves blank. */
async function upsert(tx: Tx, table: string, rows: Row[]): Promise<{ inserted: number; updated: number }> {
  const def = getTable(table)!;
  const system = new Set(['id', 'tenant_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at']);
  const columns = [...new Set(rows.flatMap(Object.keys))].filter((c) => c in def.columns && !system.has(c));
  const all = ['id', 'tenant_id', 'created_by', 'updated_by', ...columns];
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const values = [newId(), tx.context.tenantId, tx.context.userId, tx.context.userId, ...columns.map((c) => row[c] ?? null)];
    return `(${values.map((v) => { params.push(v); return `$${params.length}`; }).join(', ')})`;
  });
  const t = quoteIdent(table);
  const updates = columns.filter((c) => c !== 'code')
    .map((c) => `${quoteIdent(c)} = coalesce(excluded.${quoteIdent(c)}, ${t}.${quoteIdent(c)})`)
    .concat(['updated_at = now()', 'updated_by = excluded.updated_by'], def.softDelete ? ['deleted_at = null'] : []);
  const result = await tx.query<{ inserted: boolean }>(
    `insert into ${t} (${all.map(quoteIdent).join(', ')}) values ${tuples.join(', ')}
     on conflict (tenant_id, code) do update set ${updates.join(', ')}
     returning (xmax = 0) as inserted`,
    params,
  );
  const inserted = result.filter((r) => r.inserted).length;
  return { inserted, updated: result.length - inserted };
}

defineRoute({
  method: 'post', path: '/api/master/import/:kind', module: 'master',
  summary: 'Import masters in bulk',
  description:
    'kind: customers, karigars, categories or items. Up to 1,000 rows a call; send a big file as several calls, passing `firstRow` so errors name the spreadsheet row. Matched on `code`: an existing code is updated and a blank cell keeps the saved value. Customers and karigars without a code get the next one. Items name their category, metal and purity by code (import categories first). Needs the create permission of that master.',
  params: z.object({ kind: z.enum(['customers', 'karigars', 'categories', 'items']) }),
  body: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
    firstRow: z.number().int().min(1).default(2).describe('Spreadsheet row of rows[0] — 2 when row 1 holds the headings.'),
  }),
  middleware: [(req, res, next) => requirePermission(KINDS[param(req, 'kind')]!.permission)(req, res, next)],
  responses: [
    { status: 200, description: 'What happened to each row.', schema: z.object({
      received: z.number(), inserted: z.number(), updated: z.number(),
      failed: z.array(z.object({ row: z.number(), message: z.string() })).describe('Rows not saved, with the spreadsheet row number.'),
    }) },
    { status: 403, description: 'Missing the create permission for that master.', schema: errorEnvelope },
  ],
  changelog: [{ date: '2026-09-29', kind: 'added', note: 'Bulk import for customers, karigars, categories and items.' }],
  handler: async (req) => transaction(async (tx) => {
    const kind = KINDS[param(req, 'kind')]!;
    const { rows, firstRow } = req.body as { rows: Row[]; firstRow: number };
    const failed: { row: number; message: string }[] = [];
    const lookups = kind.prepare ? await loadLookups(tx) : ({} as Lookups);

    const good: { row: number; values: Row }[] = [];
    rows.forEach((raw, i) => {
      const row = firstRow + i;
      // Blank cells mean "not given".
      const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '' && v !== null && v !== undefined));
      const parsed = kind.schema.safeParse(cleaned);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        failed.push({ row, message: `${issue.path.join('.') || 'row'}: ${issue.message}` });
        return;
      }
      const prepared = kind.prepare ? kind.prepare(parsed.data as Row, lookups) : withGstState(parsed.data as Row);
      if (typeof prepared === 'string') failed.push({ row, message: prepared });
      else good.push({ row, values: prepared });
    });

    // The same code twice in one file: the later row wins, the earlier one is reported.
    const seen = new Map<string, number>();
    for (let i = good.length - 1; i >= 0; i--) {
      const code = good[i]!.values.code as string | undefined;
      if (!code) continue;
      const key = code.toUpperCase();
      if (seen.has(key)) {
        failed.push({ row: good[i]!.row, message: `code ${code} appears again on row ${seen.get(key)}; that row was used.` });
        good.splice(i, 1);
      } else seen.set(key, good[i]!.row);
    }

    const uncoded = good.filter((g) => !g.values.code);
    if (uncoded.length) {
      const { numbers } = await reserveDocumentNumbers(tx, kind.codeSeries!, uncoded.length);
      uncoded.forEach((g, i) => { g.values.code = numbers[i]; });
    }

    const result = good.length ? await upsert(tx, kind.table, good.map((g) => g.values)) : { inserted: 0, updated: 0 };
    await recordAudit(tx, `${kind.table}.import`, kind.table, tx.context.userId ?? 'import',
      { received: rows.length, ...result, failed: failed.length, firstRow });
    return { received: rows.length, ...result, failed: failed.sort((a, b) => a.row - b.row) };
  }),
});
