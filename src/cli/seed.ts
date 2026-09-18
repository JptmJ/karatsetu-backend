/**
 * `npm run db:seed` — a working demo tenant with realistic data.
 *
 * The names, karigars, categories and themes mirror the RatnaGrid frontend's
 * mock data, so the two line up while the UI is still being wired across.
 *
 *   npm run db:seed                 -- both demo tenants
 *   npm run db:seed -- --fresh      -- wipe demo data first
 */
import '../bootstrap.js';
import { closePool, checkConnection, pool } from '../core/db/pool.js';
import { asPlatform, asTenant } from '../core/db/client.js';
import { syncSchema } from '../core/db/schema/sync.js';
import { provisionTenant } from '../modules/tenancy/provisioning.service.js';
import { createOrder } from '../modules/orders/orders.service.js';
import { createSalesInvoice, postSalesInvoice } from '../modules/sales/sales.service.js';
import { createPurchaseInvoice, postPurchaseInvoice } from '../modules/purchase/purchase.service.js';
import { repo } from '../core/db/repository.js';
import { newId } from '../core/util/id.js';
import { logger } from '../core/util/logger.js';
import type { Tx } from '../core/db/client.js';

const has = (flag: string): boolean => process.argv.includes(`--${flag}`);
const today = () => new Date().toISOString().slice(0, 10);
const daysAway = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface TenantSeed {
  code: string; legalName: string; displayName: string;
  kind: 'retailer' | 'manufacturer' | 'both';
  stateCode: string; gstin: string;
  branches: Array<{ code: string; name: string; city: string; state: string; stateCode: string }>;
  theme: string;
}

const TENANTS: TenantSeed[] = [
  {
    code: 'aarohi', legalName: 'Aarohi Heritage Jewellers Pvt Ltd', displayName: 'Aarohi Heritage Jewellers',
    kind: 'retailer', stateCode: '27', gstin: '27AABCA1234K1ZP', theme: 'deep-forest',
    branches: [
      { code: 'ZB', name: 'Zaveri Bazaar Flagship', city: 'Mumbai', state: 'Maharashtra', stateCode: '27' },
      { code: 'BW', name: 'Bandra West Boutique', city: 'Mumbai', state: 'Maharashtra', stateCode: '27' },
      { code: 'CP', name: 'Connaught Place Vault & Lounge', city: 'New Delhi', state: 'Delhi', stateCode: '07' },
    ],
  },
  {
    code: 'tanishka', legalName: 'Tanishka Royal Gems LLP', displayName: 'Tanishka Royal Gems',
    kind: 'both', stateCode: '08', gstin: '08AACCT5678M1Z4', theme: 'royal-ruby',
    branches: [{ code: 'MIR', name: 'M.I. Road Showroom', city: 'Jaipur', state: 'Rajasthan', stateCode: '08' }],
  },
];

const CATEGORIES = [
  { code: 'RING', name: 'Rings', hsn: '7113' },
  { code: 'NECK', name: 'Necklaces / Chokers', hsn: '7113' },
  { code: 'BANG', name: 'Bangles / Kada', hsn: '7113' },
  { code: 'CHAIN', name: 'Chains', hsn: '7113' },
  { code: 'EARR', name: 'Earrings / Jhumkas', hsn: '7113' },
  { code: 'COIN', name: 'Coins & Bars', hsn: '7118' },
  { code: 'PUJA', name: 'Puja Articles & Utensils', hsn: '7114' },
];

const KARIGARS = [
  { code: 'KAR-1', name: 'Master Shyam Soni', speciality: 'Bridal Sets', workshop: 'Shyam Soni Works', ghat: '1.5', rate: '480' },
  { code: 'KAR-2', name: 'Farooq Zariwala', speciality: 'Kundan Meena', workshop: 'Zariwala Fine Mounts', ghat: '2.0', rate: '620' },
  { code: 'KAR-3', name: 'Ramesh Goldsmith', speciality: 'Chains & Bangles', workshop: 'Rajasthan Heritage Crafts', ghat: '1.2', rate: '390' },
];

const CUSTOMERS = [
  { code: 'C-001', name: 'Ananya Sharma', phone: '9820011223', city: 'Mumbai', state: 'Maharashtra', stateCode: '27' },
  { code: 'C-002', name: 'Vikramaditya Singhania', phone: '9820044556', city: 'Mumbai', state: 'Maharashtra', stateCode: '27' },
  { code: 'C-003', name: 'Meenakshi Sundaram', phone: '9840077889', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33' },
  { code: 'C-004', name: 'Ishita Mehta', phone: '9820099001', city: 'Mumbai', state: 'Maharashtra', stateCode: '27' },
  { code: 'C-005', name: 'Nirali Shah', phone: '9820033445', city: 'Surat', state: 'Gujarat', stateCode: '24' },
  { code: 'C-006', name: 'Kavya Trivedi', phone: '9898011223', city: 'Ahmedabad', state: 'Gujarat', stateCode: '24' },
  { code: 'C-007', name: 'Sanjay Deshmukh', phone: '9823011223', city: 'Pune', state: 'Maharashtra', stateCode: '27' },
  { code: 'C-008', name: 'Sunita Parekh', phone: '9820066778', city: 'Mumbai', state: 'Maharashtra', stateCode: '27' },
];

const SUPPLIERS = [
  { code: 'S-001', name: 'MMTC-PAMP India', city: 'New Delhi', stateCode: '07', gstin: '07AAACM1234F1Z5' },
  { code: 'S-002', name: 'Mumbai Bullion Traders', city: 'Mumbai', stateCode: '27', gstin: '27AABCU9603R1ZM' },
];

async function seedTenant(seed: TenantSeed, password: string) {
  const email = `owner@${seed.code}.test`;
  const { tenantId, branchId } = await provisionTenant({
    code: seed.code, legalName: seed.legalName, displayName: seed.displayName,
    kind: seed.kind, gstin: seed.gstin, stateCode: seed.stateCode,
    owner: { email, fullName: `${seed.displayName} Owner`, password },
    firstBranch: { code: seed.branches[0]!.code, name: seed.branches[0]!.name, kind: 'showroom' },
  });

  await asTenant(tenantId, async (tx) => {
    await tx.query(`update tenant_theme set preset_key = $1 where tenant_id = $2`, [seed.theme, tenantId]);
    await tx.query(
      `update branch set city = $2, state = $3, state_code = $4 where id = $1`,
      [branchId, seed.branches[0]!.city, seed.branches[0]!.state, seed.branches[0]!.stateCode]);

    // extra branches + their locations
    for (const b of seed.branches.slice(1)) {
      const id = newId();
      await repo(tx, 'branch').insert({
        id, code: b.code, name: b.name, kind: 'showroom', city: b.city,
        state: b.state, state_code: b.stateCode, gstin: seed.gstin, is_active: true,
      });
      for (const loc of [
        { code: 'COUNTER', name: 'Counter 1 (Bridal)', kind: 'counter', is_default: true },
        { code: 'VAULT', name: 'Vault A (High Security)', kind: 'vault', is_default: false },
        { code: 'WINDOW', name: 'Window Display', kind: 'window', is_default: false },
      ]) await repo(tx, 'stock_location').insert({ branch_id: id, ...loc, is_active: true });
    }

    const categories = new Map<string, string>();
    for (const [i, c] of CATEGORIES.entries()) {
      const row = await repo(tx, 'item_category').insert({ code: c.code, name: c.name, hsn_code: c.hsn, sort_order: i });
      categories.set(c.code, (row as { id: string }).id);
    }

    for (const k of KARIGARS) {
      await repo(tx, 'karigar').insert({
        code: k.code, name: k.name, workshop_name: k.workshop, speciality: k.speciality,
        engagement: 'external', standard_ghat_percent: k.ghat, labour_rate_per_gram: k.rate, is_active: true,
      });
    }

    const parties = new Map<string, string>();
    for (const c of CUSTOMERS) {
      const row = await repo(tx, 'party').insert({
        code: c.code, name: c.name, is_customer: true, party_type: 'individual',
        phone: c.phone, city: c.city, state: c.state, state_code: c.stateCode,
        kyc_status: 'verified', is_active: true,
      });
      parties.set(c.code, (row as { id: string }).id);
    }
    for (const s of SUPPLIERS) {
      const row = await repo(tx, 'party').insert({
        code: s.code, name: s.name, is_supplier: true, party_type: 'business',
        city: s.city, state_code: s.stateCode, gstin: s.gstin, credit_days: 30, is_active: true,
      });
      parties.set(s.code, (row as { id: string }).id);
    }

    const metals = await tx.query<{ id: string; code: string }>(`select id, code from metal`);
    const purities = await tx.query<{ id: string; code: string; metal_id: string }>(`select id, code, metal_id from purity`);
    const gold = metals.find((m) => m.code === 'GOLD')!;
    const silver = metals.find((m) => m.code === 'SILVER')!;
    const p22 = purities.find((p) => p.code === '22K')!;
    const p18 = purities.find((p) => p.code === '18K')!;
    const p999 = purities.find((p) => p.code === '999' && p.metal_id === silver.id)!;

    // Today's broadcast rates
    for (const [purity, sell, buy] of [[p22, '6860', '6640'], [p18, '5615', '5420'], [p999, '88', '84']] as const) {
      await repo(tx, 'metal_rate').insert({
        metal_id: purity.metal_id, purity_id: purity.id,
        rate_per_gram: sell, buying_rate_per_gram: buy, source: 'manual',
      });
    }

    const items = new Map<string, string>();
    const itemDefs = [
      { code: 'GOLD-22K-BULK', name: '22K Gold (bulk)', tracking: 'lot', nature: 'raw_metal', metal: gold.id, purity: p22.id, cat: null, making: '0' },
      { code: 'RING-22K', name: 'Gold Ring 22K', tracking: 'piece', nature: 'finished', metal: gold.id, purity: p22.id, cat: 'RING', making: '520' },
      { code: 'NECK-22K', name: 'Bridal Necklace Set 22K', tracking: 'piece', nature: 'finished', metal: gold.id, purity: p22.id, cat: 'NECK', making: '680' },
      { code: 'BANG-22K', name: 'Antique Kada 22K', tracking: 'piece', nature: 'finished', metal: gold.id, purity: p22.id, cat: 'BANG', making: '610' },
      { code: 'CHAIN-22K', name: 'Gents Gold Chain 22K', tracking: 'piece', nature: 'finished', metal: gold.id, purity: p22.id, cat: 'CHAIN', making: '450' },
      { code: 'EARR-18K', name: 'Diamond Accent Jhumkas 18K', tracking: 'piece', nature: 'finished', metal: gold.id, purity: p18.id, cat: 'EARR', making: '890' },
      { code: 'COIN-24K', name: 'Gold Coin 10g', tracking: 'piece', nature: 'finished', metal: gold.id, purity: purities.find((p) => p.code === '24K')!.id, cat: 'COIN', making: '150' },
      { code: 'PUJA-925', name: 'Silver Puja Thali 925', tracking: 'piece', nature: 'finished', metal: silver.id, purity: p999.id, cat: 'PUJA', making: '45' },
    ];
    for (const d of itemDefs) {
      const row = await repo(tx, 'item').insert({
        code: d.code, name: d.name, nature: d.nature, tracking: d.tracking,
        category_id: d.cat ? categories.get(d.cat) : null, metal_id: d.metal,
        default_purity_id: d.purity, hsn_code: '7113', default_making_rate: d.making,
        default_wastage_percent: d.tracking === 'piece' ? '8' : '0', uom: 'gram', is_active: true,
      });
      items.set(d.code, (row as { id: string }).id);
    }

    // a tag template so the print queue works
    await repo(tx, 'tag_template').insert({
      code: 'DUAL-WING', name: 'Dual-wing String Tag (85x15mm)', format: 'string_tag_dual_wing',
      width_mm: '85', height_mm: '15', barcode_type: 'code128',
      printer_model: 'Argox CP-2140', is_default: true,
      layout: JSON.stringify({ left: ['tag_number', 'gross_weight', 'net_weight'], right: ['purity', 'huid', 'barcode'] }),
    });

    // a scheme plan
    await repo(tx, 'scheme_plan').insert({
      code: 'SN-11P1', name: 'Swarna Nidhi 11+1', description: 'Pay 11 monthly installments, the 12th is on us.',
      metal_id: gold.id, accrual_basis: 'rupee', tenure_months: 11, installment_amount: '5000',
      bonus_installments: '1', max_missed_installments: '2', grace_period_days: 7,
      allow_partial_redemption: false, allow_cash_redemption: false, is_active: true,
    });

    logger.info({ tenant: seed.code }, 'masters seeded');
    return { parties, items, purities: { p22, p18, p999 }, gold, categories };
  });

  return { tenantId, branchId, email };
}

/** Buy bulk metal, tag a few pieces, raise orders, and bill one sale. */
async function seedTransactions(tenantId: string, branchId: string) {
  await asTenant(tenantId, async (tx: Tx) => {
    const id = async (sql: string, p: unknown[] = []) =>
      (await tx.one<{ id: string }>(sql, p)).id;

    const supplier = await id(`select id from party where code = 'S-002'`);
    const bulk = await id(`select id from item where code = 'GOLD-22K-BULK'`);
    const p22 = await id(`select id from purity where code = '22K'`);
    const vault = await id(`select id from stock_location where branch_id = $1 order by (kind='vault') desc limit 1`, [branchId]);
    const counter = await id(`select id from stock_location where branch_id = $1 order by (kind='counter') desc limit 1`, [branchId]);

    // 1. buy 500g of 22K
    const purchase = await createPurchaseInvoice(tx, {
      supplierId: supplier, branchId, docDate: today(), supplierInvoiceNumber: 'MBT/2026/4471',
      lines: [{ itemId: bulk, purityId: p22, locationId: vault, grossWeight: '500.000', ratePerGram: '6640' }],
    });
    await postPurchaseInvoice(tx, (purchase as { id: string }).id);

    // 2. tag finished pieces (raises stock through the tagging service)
    const { tagPiece } = await import('../modules/tagging/tagging.service.js');
    const pieces: string[] = [];
    const tagged = [
      { item: 'RING-22K', gross: '8.450', stone: '0.350', huid: 'X9A7K2', cost: '58000' },
      { item: 'NECK-22K', gross: '62.800', stone: '4.200', huid: 'B3M8P5', cost: '420000' },
      { item: 'BANG-22K', gross: '34.200', stone: '0', huid: 'K7Q2W9', cost: '232000' },
      { item: 'CHAIN-22K', gross: '22.600', stone: '0', huid: 'R4T6Y1', cost: '152000' },
    ];
    for (const [i, t] of tagged.entries()) {
      const itemId = await id(`select id from item where code = $1`, [t.item]);
      const piece = await tagPiece(tx, {
        itemId, purityId: p22, locationId: counter, tagNumber: `TAG-882${10 + i}`,
        grossWeight: t.gross, stoneWeight: t.stone,
        huid: t.huid, hallmarkCentre: 'BIS Mumbai AHC-1042',
        costValue: t.cost, origin: 'opening',
      });
      pieces.push(piece.id);
    }

    // 3. one order of each type, spread across their pipelines
    const c = async (code: string) => id(`select id from party where code = $1`, [code]);
    const ring = await id(`select id from item where code = 'RING-22K'`);

    await createOrder(tx, {
      orderType: 'booking', customerId: await c('C-004'), branchId,
      orderDate: today(), expectedDeliveryDate: daysAway(6), rateLockType: 'today',
      lockedRatePerGram: '6860', advanceAmount: '25000',
      lines: [{ title: '22K Diamond Accent Bangle', lineMode: 'booking', itemId: ring, purityId: p22,
        grossWeight: '18.500', ratePerGram: '6860', makingRate: '610', wastagePercent: '8' }],
      notes: 'Customer prefers evening pickup after final polishing check.',
    });

    await createOrder(tx, {
      orderType: 'repair', customerId: await c('C-005'), branchId,
      orderDate: today(), expectedDeliveryDate: daysAway(3),
      repairItemDescription: 'Antique 22K necklace with damaged rear clasp and slight chain deformation.',
      repairIssueDescription: 'Clasp broken, chain slightly bent near the third link.',
      repairIssueTypes: ['clasp', 'chain'],
      notes: 'Preserve original antique finish and avoid aggressive polishing.',
    });

    await createOrder(tx, {
      orderType: 'wedding', customerId: await c('C-006'), branchId,
      orderDate: today(), expectedDeliveryDate: daysAway(45),
      eventDate: daysAway(52), eventType: 'Wedding',
      advanceAmount: '250000',
      lines: [
        { title: 'Bridal Necklace Set', lineMode: 'custom', itemId: ring, purityId: p22, grossWeight: '92.500', ratePerGram: '6860', makingRate: '680', wastagePercent: '9' },
        { title: 'Matching Family Bangles', lineMode: 'custom', itemId: ring, purityId: p22, grossWeight: '48.000', ratePerGram: '6860', makingRate: '610', wastagePercent: '8' },
        { title: 'Groom Chain', lineMode: 'booking', itemId: ring, purityId: p22, grossWeight: '26.400', ratePerGram: '6860', makingRate: '450', wastagePercent: '7' },
      ],
      notes: 'Bridal set requires first priority and separate presentation packaging.',
    });

    await createOrder(tx, {
      orderType: 'custom', customerId: await c('C-007'), branchId,
      orderDate: today(), expectedDeliveryDate: daysAway(21),
      requirementDescription: 'Gents gold chain, 22K, byzantine link, approximately 40g.',
      sizeSpecifications: '22 inch, 6mm width', budgetMin: '250000', budgetMax: '320000',
      manufacturingRoute: 'external',
    });

    await createOrder(tx, {
      orderType: 'corporate', customerId: await c('C-003'), branchId,
      orderDate: today(), expectedDeliveryDate: daysAway(30),
      companyName: 'Aurum Hospitality Pvt Ltd', companyGstin: '27AAGCA7788Q1Z9',
      poReference: 'AHPL/PO/2026/0412', creditTerms: 'net_30',
      brandingNotes: 'Each box needs the client monogram on the outer sleeve only.',
      lines: [{ title: 'Executive Gold Coin Gift Box', lineMode: 'custom', itemId: ring, purityId: p22,
        quantity: '25', grossWeight: '10.000', ratePerGram: '6860', makingRate: '150' }],
    });

    // 4. bill one sale, settled by cash + UPI
    const invoice = await createSalesInvoice(tx, {
      customerId: await c('C-001'), branchId, docDate: today(), channel: 'counter',
      lines: [{ itemId: ring, purityId: p22, pieceId: pieces[0], locationId: counter,
        grossWeight: '8.450', stoneWeight: '0.350', ratePerGram: '6860', makingRate: '520', wastagePercent: '8' }],
      payments: [{ mode: 'cash', amount: '30000' }, { mode: 'upi', amount: '32000', reference: 'UPI99321' }],
    });
    await postSalesInvoice(tx, (invoice as { id: string }).id);

    // 5. an old-gold intake
    const { nextDocumentNumber } = await import('../modules/numbering/numbering.service.js');
    const { number: ogNumber } = await nextDocumentNumber(tx, 'old_gold', { branchId });
    const ogId = newId();
    await repo(tx, 'old_gold_intake').insert({
      id: ogId, voucher_number: ogNumber, voucher_date: today(), branch_id: branchId,
      customer_id: await c('C-008'), status: 'tested', settlement_type: 'exchange',
      rate_per_gram: '6640', total_gross_weight: '22.000', total_deduction_weight: '2.600',
      total_net_weight: '19.400', total_fine_weight: '15.170', gross_value: '100728.80',
      deduction_amount: '0', net_value: '100728.80',
    });
    await repo(tx, 'old_gold_item').insert({
      old_gold_intake_id: ogId, line_number: 1, description: 'Old 22K bangle pair, worn',
      metal_id: await id(`select id from metal where code='GOLD'`),
      gross_weight: '22.000', stone_weight: '1.800', dirt_weight: '0.500', solder_weight: '0.300',
      net_weight: '19.400', test_method: 'xrf', tested_purity_percent: '78.200',
      declared_purity_percent: '91.600', test_instrument: 'Bruker S1 TITAN XRF',
      tested_at: new Date(), fine_weight: '15.170', rate_per_gram: '6640', value: '100728.80',
    });

    logger.info({ tenantId }, 'transactions seeded');
  });
}

async function wipeDemoData(): Promise<void> {
  await asPlatform(async (tx) => {
    const codes = TENANTS.map((t) => t.code);
    const rows = await tx.query<{ id: string }>(`select id from tenant where code = any($1::text[])`, [codes]);
    if (!rows.length) return;
    const ids = rows.map((r) => r.id);
    // Child-first, so foreign keys never block the delete.
    const order = [
      'order_communication', 'order_acknowledgement', 'order_attachment', 'order_payment',
      'order_stage_event', 'order_line', 'retail_order', 'order_pipeline',
      'sales_payment', 'sales_return_line', 'sales_return', 'sales_invoice_line', 'sales_invoice',
      'purchase_return_line', 'purchase_return', 'purchase_invoice_line', 'purchase_invoice',
      'goods_receipt_line', 'goods_receipt', 'purchase_order_line', 'purchase_order',
      'girvi_repayment', 'girvi_accrual', 'girvi_collateral', 'girvi_loan',
      'scheme_redemption', 'scheme_installment', 'scheme_account', 'scheme_plan',
      'old_gold_item', 'old_gold_intake', 'melt_batch',
      'tag_print_job_item', 'tag_print_job', 'huid_assignment', 'tag_template',
      'metal_ledger_entry', 'ledger_entry', 'voucher',
      'karigar_ledger', 'karigar',
      'stock_movement', 'stock_balance', 'stock_piece',
      'metal_rate', 'item', 'item_category', 'purity', 'metal', 'party',
      'numbering_gap', 'numbering_series', 'config_value', 'dashboard_layout',
      'audit_log', 'refresh_token', 'user_role', 'role', 'app_user',
      'tenant_theme', 'stock_location', 'branch', 'account', 'tenant_module',
    ];
    for (const table of order) {
      await tx.query(`delete from ${table} where tenant_id = any($1::uuid[])`, [ids]).catch(() => undefined);
    }
    await tx.query(`delete from support_session where tenant_id = any($1::uuid[])`, [ids]).catch(() => undefined);
    await tx.query(`delete from feature_flag where tenant_id = any($1::uuid[])`, [ids]).catch(() => undefined);
    await tx.query(`delete from tenant where id = any($1::uuid[])`, [ids]);
    logger.warn({ tenants: codes }, 'demo data wiped');
  });
}

async function main(): Promise<void> {
  await checkConnection();
  await syncSchema(pool, 'safe');
  if (has('fresh')) await wipeDemoData();

  const password = 'demo12345';
  const created: Array<{ code: string; email: string }> = [];

  for (const seed of TENANTS) {
    const { tenantId, branchId, email } = await seedTenant(seed, password);
    await seedTransactions(tenantId, branchId);
    created.push({ code: seed.code, email });
  }

  console.log(`
Demo tenants ready.
${created.map((c) => `  ${c.code.padEnd(10)} ${c.email}   password: ${password}`).join('\n')}

  curl -s localhost:4000/api/auth/login -H 'content-type: application/json' \\
    -d '{"tenantCode":"${created[0]!.code}","email":"${created[0]!.email}","password":"${password}"}'

  Docs: http://localhost:4000/dev-docs
`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(closePool);
