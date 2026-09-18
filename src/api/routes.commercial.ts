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

/* ------------------------------------------------------- old gold */

defineRoute({
  method: 'post', path: '/api/oldgold/intakes', module: 'oldgold',
  summary: 'Create an old-gold appraisal voucher',
  description:
    'Records what the customer brought in, item by item, with XRF readings and the deductions that turn gross weight into actual metal. Fine weight and value are computed server-side from the buying rate.',
  permission: 'oldgold.create',
  body: z.object({
    customerId: uuid, branchId: uuid, voucherDate: isoDate,
    settlementType: z.enum(['exchange', 'buyback']).optional().describe('Can be decided later, at settlement.'),
    ratePerGram: money.describe('The buying rate applied to this voucher.'),
    deductionAmount: money.optional().describe('Handling or refining charge withheld.'),
    notes: z.string().optional(),
    items: z.array(z.object({
      description: z.string().min(1), metalId: uuid, itemCategoryId: uuid.nullish(),
      grossWeight: weight, stoneWeight: weight.optional(), dirtWeight: weight.optional(), solderWeight: weight.optional(),
      testMethod: z.enum(['xrf', 'touchstone', 'fire_assay', 'declared', 'visual']).default('xrf'),
      testedPurityPercent: decimal.describe('What the machine read, as a percentage.'),
      declaredPurityPercent: decimal.optional().describe('What the customer said it was.'),
      testInstrument: z.string().optional(), photoStorageKey: z.string().optional(), notes: z.string().optional(),
    })).min(1),
  }),
  responses: [
    { status: 201, description: 'Voucher with totals and net payable.', schema: record },
    { status: 422, description: 'Deductions exceed gross weight, or purity out of range.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Intake with XRF logging and dirt/stone deductions.' }],
  handler: async (req, res) => {
    const row = await transaction(async (tx) => {
      const b = req.body;
      const { number } = await nextDocumentNumber(tx, 'old_gold', { branchId: b.branchId, date: new Date(b.voucherDate) });
      const id = newId();

      type IntakeItem = {
        description: string; metalId: string; itemCategoryId?: string | null;
        grossWeight: string; stoneWeight?: string; dirtWeight?: string; solderWeight?: string;
        testMethod: string; testedPurityPercent: string; declaredPurityPercent?: string;
        testInstrument?: string; photoStorageKey?: string; notes?: string;
      };
      const priced = (b.items as IntakeItem[]).map((item) => {
        const deductions = sum([item.stoneWeight ?? '0', item.dirtWeight ?? '0', item.solderWeight ?? '0']);
        const net = sub(item.grossWeight, deductions);
        const fine = div(mul(net, item.testedPurityPercent), '100');
        return { ...item, net, fine, value: mul(fine, b.ratePerGram as string) };
      });

      const totalGross = sum(priced.map((p) => p.grossWeight));
      const totalNet = sum(priced.map((p) => p.net));
      const totalFine = sum(priced.map((p) => p.fine));
      const grossValue = sum(priced.map((p) => p.value));
      const deduction = b.deductionAmount ?? '0';

      const intake = await repo(tx, 'old_gold_intake').insert({
        id, voucher_number: number, voucher_date: b.voucherDate, branch_id: b.branchId,
        customer_id: b.customerId, status: 'tested', settlement_type: b.settlementType ?? null,
        tested_by: tx.context.userId, rate_per_gram: b.ratePerGram,
        total_gross_weight: totalGross, total_deduction_weight: sub(totalGross, totalNet),
        total_net_weight: totalNet, total_fine_weight: totalFine,
        gross_value: grossValue, deduction_amount: deduction, net_value: sub(grossValue, deduction),
        notes: b.notes ?? null,
      });

      await repo(tx, 'old_gold_item').insertMany(priced.map((p, i) => ({
        old_gold_intake_id: id, line_number: i + 1, description: p.description,
        metal_id: p.metalId, item_category_id: p.itemCategoryId ?? null,
        gross_weight: p.grossWeight, stone_weight: p.stoneWeight ?? '0',
        dirt_weight: p.dirtWeight ?? '0', solder_weight: p.solderWeight ?? '0', net_weight: p.net,
        test_method: p.testMethod, tested_purity_percent: p.testedPurityPercent,
        declared_purity_percent: p.declaredPurityPercent ?? null, test_instrument: p.testInstrument ?? null,
        tested_at: new Date(), fine_weight: p.fine, rate_per_gram: b.ratePerGram, value: p.value,
        photo_storage_key: p.photoStorageKey ?? null, notes: p.notes ?? null,
      })));

      return intake;
    });
    res.status(201).json(row);
  },
});

defineRoute({
  method: 'get', path: '/api/oldgold/intakes', module: 'oldgold',
  summary: 'List appraisal vouchers',
  permission: 'oldgold.view',
  query: z.object({
    status: z.enum(['draft', 'tested', 'approved', 'settled', 'returned', 'cancelled']).optional(),
    settlementType: z.enum(['exchange', 'buyback']).optional(),
    customerId: uuid.optional(), branchId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional(),
  }).merge(pagination),
  responses: [{ status: 200, description: 'Vouchers.', schema: listOf(record) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    for (const [key, col] of [['status', 'g.status'], ['settlementType', 'g.settlement_type'],
      ['customerId', 'g.customer_id'], ['branchId', 'g.branch_id']] as const) {
      if (q[key]) { params.push(q[key]); clauses.push(`${col} = $${params.length}`); }
    }
    if (q.from) { params.push(q.from); clauses.push(`g.voucher_date >= $${params.length}`); }
    if (q.to) { params.push(q.to); clauses.push(`g.voucher_date <= $${params.length}`); }
    return { rows: await tx.query(
      `select g.*, p.name as customer_name from old_gold_intake g join party p on p.id = g.customer_id
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
        order by g.voucher_date desc limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params) };
  }),
});

defineRoute({
  method: 'post', path: '/api/oldgold/intakes/:id/settle', module: 'oldgold',
  summary: 'Settle a voucher — exchange credit or cash buyback',
  description:
    'The branch point. `exchange` links the credit to an invoice or order; `buyback` records a cash payout. Same intake, opposite accounting.',
  permission: 'oldgold.update', params: idParam,
  body: z.object({
    settlementType: z.enum(['exchange', 'buyback']),
    appliedToInvoiceId: uuid.optional().describe('For exchange.'),
    appliedToOrderId: uuid.optional().describe('For exchange.'),
    payoutMode: z.enum(['cash', 'bank_transfer', 'upi', 'cheque']).optional().describe('For buyback.'),
    payoutReference: z.string().optional(),
  }),
  responses: [
    { status: 200, description: 'Settled.', schema: record },
    { status: 422, description: 'Already settled, or the wrong fields for the chosen settlement type.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Shared intake, branched settlement.' }],
  handler: async (req) => transaction(async (tx) => {
    const id = param(req, 'id');
    const b = req.body;
    if (b.settlementType === 'exchange' && !b.appliedToInvoiceId && !b.appliedToOrderId) {
      const { BusinessRuleError } = await import('../core/errors/app-error.js');
      throw new BusinessRuleError('An exchange needs an invoice or order to apply the credit to.', 'exchange_target_missing');
    }
    return tx.one(
      `update old_gold_intake
          set status = 'settled', settlement_type = $2, applied_to_invoice_id = $3, applied_to_order_id = $4,
              payout_mode = $5, payout_reference = $6, settled_at = now(), updated_at = now(), updated_by = $7
        where id = $1 and status <> 'settled' returning *`,
      [id, b.settlementType, b.appliedToInvoiceId ?? null, b.appliedToOrderId ?? null,
       b.payoutMode ?? null, b.payoutReference ?? null, tx.context.userId]);
  }),
});

defineCrud({
  basePath: '/api/oldgold', resource: 'melt-batches', table: 'melt_batch', module: 'oldgold', label: 'melt batch',
  permission: 'oldgold.melt', searchColumns: ['batch_number'], defaultOrder: 'batch_date desc',
  filters: { status: z.enum(['open', 'sent', 'melted', 'received', 'closed']).optional() },
  changelog: [{ date: TODAY, kind: 'added', note: 'Melt batch tracking closes metal reconciliation.' }],
  createSchema: z.object({
    batch_number: z.string().min(1), batch_date: isoDate, branch_id: uuid, metal_id: uuid,
    refiner_id: uuid.optional(), notes: z.string().optional(),
  }),
  updateSchema: z.object({
    status: z.enum(['open', 'sent', 'melted', 'received', 'closed']).optional(),
    output_weight: weight.optional(), output_purity_percent: decimal.optional(),
    refining_charge: money.optional(), assay_certificate_number: z.string().optional(),
  }),
});

/* --------------------------------------------------------- schemes */

defineCrud({
  basePath: '/api/schemes', resource: 'plans', table: 'scheme_plan', module: 'schemes', label: 'scheme plan',
  permission: 'schemes.plans', searchColumns: ['code', 'name'], defaultOrder: 'name',
  filters: { is_active: z.coerce.boolean().optional() },
  changelog: [{ date: TODAY, kind: 'added', note: 'Swarna Nidhi plan builder.' }],
  createSchema: z.object({
    code: z.string().min(1).max(30), name: z.string().min(1), description: z.string().optional(), metal_id: uuid,
    accrual_basis: z.enum(['rupee', 'weight']).default('rupee')
      .describe('weight accrues grams at each payment’s rate — the customer is owed metal, not money.'),
    tenure_months: z.number().int().min(1), installment_amount: money.optional(),
    is_flexible_amount: z.boolean().default(false),
    bonus_installments: decimal.optional().describe('The classic "pay 11, get 12" is 1.'),
    bonus_percent: decimal.optional(), max_missed_installments: z.number().int().default(2),
    making_charge_discount_percent: decimal.optional(),
    allow_partial_redemption: z.boolean().default(false), allow_cash_redemption: z.boolean().default(false),
    grace_period_days: z.number().int().default(7), terms_and_conditions: z.string().optional(),
  }),
  updateSchema: z.object({ name: z.string().optional(), is_active: z.boolean().optional(),
    bonus_installments: decimal.optional(), terms_and_conditions: z.string().optional() }),
});

defineRoute({
  method: 'post', path: '/api/schemes/accounts', module: 'schemes',
  summary: 'Enroll a customer and generate the installment schedule',
  description:
    'Creates the account and writes every installment row up front, so “what is due this month” is a simple query rather than a calculation.',
  permission: 'schemes.accounts.create',
  body: z.object({
    schemePlanId: uuid, customerId: uuid, branchId: uuid, enrolledOn: isoDate,
    installmentAmount: money, dueDay: z.number().int().min(1).max(28).default(1),
    nomineeName: z.string().optional(), nomineeRelationship: z.string().optional(), nomineePhone: phone.optional(),
  }),
  responses: [
    { status: 201, description: 'Account with its full schedule.', schema: z.object({ account: record, installments: z.number() }) },
    { status: 404, description: 'Plan or customer not found.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Enrollment generates the whole schedule up front.' }],
  handler: async (req, res) => {
    const out = await transaction(async (tx) => {
      const b = req.body;
      const plan = await tx.one<{ tenure_months: number; code: string }>(
        `select tenure_months, code from scheme_plan where id = $1 and deleted_at is null`, [b.schemePlanId]);
      const { number } = await nextDocumentNumber(tx, 'scheme_account', { branchId: b.branchId });

      const start = new Date(b.enrolledOn);
      const maturity = new Date(start); maturity.setMonth(maturity.getMonth() + plan.tenure_months);
      const id = newId();

      const account = await repo(tx, 'scheme_account').insert({
        id, account_number: number, scheme_plan_id: b.schemePlanId, customer_id: b.customerId,
        branch_id: b.branchId, enrolled_on: b.enrolledOn, maturity_date: maturity.toISOString().slice(0, 10),
        due_day: b.dueDay, installment_amount: b.installmentAmount, installments_due: plan.tenure_months,
        nominee_name: b.nomineeName ?? null, nominee_relationship: b.nomineeRelationship ?? null,
        nominee_phone: b.nomineePhone ?? null,
      });

      const rows = Array.from({ length: plan.tenure_months }, (_, i) => {
        const due = new Date(start); due.setMonth(due.getMonth() + i); due.setDate(b.dueDay);
        return {
          scheme_account_id: id, installment_number: i + 1,
          due_date: due.toISOString().slice(0, 10), amount_due: b.installmentAmount, status: 'due',
        };
      });
      await repo(tx, 'scheme_installment').insertMany(rows);
      return { account, installments: rows.length };
    });
    res.status(201).json(out);
  },
});

defineRoute({
  method: 'post', path: '/api/schemes/installments/:id/collect', module: 'schemes',
  summary: 'Collect an installment',
  description:
    'Records the payment and, for weight-basis plans, the grams it bought at today’s rate — which is what the customer is actually owed.',
  permission: 'schemes.collection.create', params: idParam,
  body: z.object({
    amountPaid: money, paidOn: isoDate,
    paymentMode: z.enum(['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'auto_debit']),
    paymentReference: z.string().optional(), ratePerGram: money.optional(),
  }),
  responses: [
    { status: 200, description: 'Collected; account totals updated.', schema: record },
    { status: 422, description: 'Already paid.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const id = param(req, 'id');
    const b = req.body;
    const weightAccrued = b.ratePerGram && compare(b.ratePerGram, '0') > 0 ? div(b.amountPaid, b.ratePerGram) : '0';
    const row = await tx.one<{ scheme_account_id: string }>(
      `update scheme_installment
          set status = 'paid', amount_paid = $2, paid_on = $3, payment_mode = $4,
              payment_reference = $5, rate_per_gram = $6, weight_accrued = $7,
              collected_by = $8, updated_at = now()
        where id = $1 and status <> 'paid' returning *`,
      [id, b.amountPaid, b.paidOn, b.paymentMode, b.paymentReference ?? null,
       b.ratePerGram ?? null, weightAccrued, tx.context.userId]);

    await tx.query(
      `update scheme_account
          set installments_paid = installments_paid + 1, total_paid = total_paid + $2,
              total_weight_accrued = total_weight_accrued + $3,
              redeemable_amount = redeemable_amount + $2, redeemable_weight = redeemable_weight + $3,
              updated_at = now()
        where id = $1`, [row.scheme_account_id, b.amountPaid, weightAccrued]);
    return row;
  }),
});

defineRoute({
  method: 'get', path: '/api/schemes/accounts', module: 'schemes',
  summary: 'List scheme accounts',
  permission: 'schemes.accounts.view',
  query: z.object({
    status: z.enum(['active', 'matured', 'redeemed', 'defaulted', 'cancelled', 'closed']).optional(),
    customerId: uuid.optional(), branchId: uuid.optional(), search: z.string().optional(),
  }).merge(pagination),
  responses: [{ status: 200, description: 'Accounts with progress.', schema: listOf(record) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    for (const [key, col] of [['status', 'a.status'], ['customerId', 'a.customer_id'], ['branchId', 'a.branch_id']] as const) {
      if (q[key]) { params.push(q[key]); clauses.push(`${col} = $${params.length}`); }
    }
    if (q.search) { params.push(`%${q.search}%`); clauses.push(`(a.account_number ilike $${params.length} or p.name ilike $${params.length})`); }
    return { rows: await tx.query(
      `select a.*, p.name as customer_name, p.phone as customer_phone, s.name as plan_name, s.accrual_basis
         from scheme_account a join party p on p.id = a.customer_id join scheme_plan s on s.id = a.scheme_plan_id
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
        order by a.enrolled_on desc limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params) };
  }),
});

defineRoute({
  method: 'get', path: '/api/schemes/due', module: 'schemes',
  summary: 'Installments due or missed',
  description: 'Drives the "Scheme collections due today" dashboard alert and the reminder run.',
  permission: 'schemes.collection.view',
  query: z.object({ onDate: isoDate.optional(), includeMissed: z.coerce.boolean().default(true), branchId: uuid.optional() }),
  responses: [{ status: 200, description: 'Due list.', schema: z.object({ rows: z.array(record), totalDue: money }) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<{ onDate?: string; includeMissed: boolean; branchId?: string }>(req);
    const onDate = q.onDate ?? new Date().toISOString().slice(0, 10);
    const params: unknown[] = [onDate];
    let branch = '';
    if (q.branchId) { params.push(q.branchId); branch = ` and a.branch_id = $${params.length}`; }
    const rows = await tx.query<{ amount_due: string }>(
      `select i.*, a.account_number, p.name as customer_name, p.phone as customer_phone, s.name as plan_name
         from scheme_installment i join scheme_account a on a.id = i.scheme_account_id
         join party p on p.id = a.customer_id join scheme_plan s on s.id = a.scheme_plan_id
        where i.status ${q.includeMissed ? "in ('due','missed')" : "= 'due'"}
          and i.due_date <= $1 and a.status = 'active'${branch}
        order by i.due_date`, params);
    return { rows, totalDue: sum(rows.map((r) => r.amount_due)) };
  }),
});

/* ----------------------------------------------------------- girvi */

defineRoute({
  method: 'post', path: '/api/girvi/loans', module: 'girvi',
  summary: 'Sanction a Girvi loan',
  description:
    'Appraises the collateral, caps the principal at the configured LTV (75% by default), and records the vault packet the items are sealed into.',
  permission: 'girvi.create',
  body: z.object({
    branchId: uuid, customerId: uuid.optional().describe('Omit for a walk-in; the borrower fields are then required.'),
    borrowerName: z.string().min(1), borrowerPhone: phone,
    borrowerAddress: z.string().optional(),
    borrowerIdType: z.enum(['aadhaar', 'pan', 'voter', 'driving_licence', 'passport']).optional(),
    borrowerIdNumber: z.string().optional(),
    sanctionedOn: isoDate, dueDate: isoDate,
    ltvPercent: decimal.default('75').describe('Regulatory cap is 75%.'),
    principalAmount: money, interestRateMonthly: decimal,
    processingFee: money.optional(), disbursalMode: z.enum(['cash', 'bank_transfer', 'upi', 'cheque']).optional(),
    vaultPacketNumber: z.string().optional(), vaultLocationId: uuid.optional(),
    collateral: z.array(z.object({
      description: z.string().min(1), metalId: uuid, purityId: uuid.nullish(),
      quantity: z.number().int().default(1), grossWeight: weight, stoneWeight: weight.optional(),
      testedPurityPercent: decimal, testMethod: z.enum(['xrf', 'touchstone', 'declared']).default('xrf'),
      ratePerGram: money.describe('Buying rate used for appraisal.'),
      conditionNotes: z.string().optional(), photoStorageKey: z.string().optional(),
    })).min(1),
  }),
  responses: [
    { status: 201, description: 'Loan sanctioned.', schema: record },
    { status: 422, description: 'Principal exceeds the LTV cap.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Sanction with LTV cap and vault custody.' }],
  handler: async (req, res) => {
    const row = await transaction(async (tx) => {
      const b = req.body;
      const { BusinessRuleError } = await import('../core/errors/app-error.js');
      const { number } = await nextDocumentNumber(tx, 'girvi_loan', { branchId: b.branchId, date: new Date(b.sanctionedOn) });

      type Collateral = {
        description: string; metalId: string; purityId?: string | null; quantity?: number;
        grossWeight: string; stoneWeight?: string; testedPurityPercent: string;
        testMethod: string; ratePerGram: string; conditionNotes?: string; photoStorageKey?: string;
      };
      const priced = (b.collateral as Collateral[]).map((c) => {
        const net = sub(c.grossWeight, c.stoneWeight ?? '0');
        const fine = div(mul(net, c.testedPurityPercent), '100');
        return { ...c, net, fine, value: mul(fine, c.ratePerGram) };
      });
      const appraised = sum(priced.map((p) => p.value));
      const maxEligible = div(mul(appraised, b.ltvPercent), '100');
      if (compare(b.principalAmount, maxEligible) > 0) {
        throw new BusinessRuleError(
          `Principal ₹${b.principalAmount} exceeds the ${b.ltvPercent}% LTV cap of ₹${maxEligible} on appraised value ₹${appraised}.`,
          'ltv_exceeded', { appraised, maxEligible, requested: b.principalAmount });
      }

      const id = newId();
      const loan = await repo(tx, 'girvi_loan').insert({
        id, loan_number: number, status: 'sanctioned', branch_id: b.branchId, customer_id: b.customerId ?? null,
        borrower_name: b.borrowerName, borrower_phone: b.borrowerPhone, borrower_address: b.borrowerAddress ?? null,
        borrower_id_type: b.borrowerIdType ?? null, borrower_id_number: b.borrowerIdNumber ?? null,
        sanctioned_on: b.sanctionedOn, due_date: b.dueDate,
        total_gross_weight: sum(priced.map((p) => p.grossWeight)),
        total_net_weight: sum(priced.map((p) => p.net)), total_fine_weight: sum(priced.map((p) => p.fine)),
        appraised_value: appraised, ltv_percent: b.ltvPercent, max_eligible_amount: maxEligible,
        principal_amount: b.principalAmount, interest_rate_monthly: b.interestRateMonthly,
        processing_fee: b.processingFee ?? '0',
        disbursed_amount: sub(b.principalAmount, b.processingFee ?? '0'),
        disbursal_mode: b.disbursalMode ?? null, outstanding_amount: b.principalAmount,
        vault_packet_number: b.vaultPacketNumber ?? null, vault_location_id: b.vaultLocationId ?? null,
        packet_sealed_at: b.vaultPacketNumber ? new Date() : null,
      });

      await repo(tx, 'girvi_collateral').insertMany(priced.map((p, i) => ({
        girvi_loan_id: id, line_number: i + 1, description: p.description, metal_id: p.metalId,
        purity_id: p.purityId ?? null, quantity: p.quantity ?? 1, gross_weight: p.grossWeight,
        stone_weight: p.stoneWeight ?? '0', net_weight: p.net, fine_weight: p.fine,
        tested_purity_percent: p.testedPurityPercent, test_method: p.testMethod,
        appraised_value: p.value, condition_notes: p.conditionNotes ?? null,
        photo_storage_key: p.photoStorageKey ?? null,
      })));
      return loan;
    });
    res.status(201).json(row);
  },
});

defineRoute({
  method: 'get', path: '/api/girvi/loans', module: 'girvi',
  summary: 'List Girvi loans',
  permission: 'girvi.view',
  query: z.object({
    status: z.enum(['draft', 'sanctioned', 'active', 'overdue', 'redeemed', 'defaulted', 'auctioned', 'cancelled']).optional(),
    branchId: uuid.optional(), search: z.string().optional().describe('Matches loan number, borrower or vault packet.'),
  }).merge(pagination),
  responses: [{ status: 200, description: 'Loans.', schema: listOf(record) }],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const q = queryOf<Record<string, string | number | undefined>>(req);
    const clauses: string[] = []; const params: unknown[] = [];
    if (q.status) { params.push(q.status); clauses.push(`l.status = $${params.length}`); }
    if (q.branchId) { params.push(q.branchId); clauses.push(`l.branch_id = $${params.length}`); }
    if (q.search) { params.push(`%${q.search}%`); const p = `$${params.length}`;
      clauses.push(`(l.loan_number ilike ${p} or l.borrower_name ilike ${p} or l.vault_packet_number ilike ${p})`); }
    return { rows: await tx.query(
      `select l.*, b.name as branch_name from girvi_loan l join branch b on b.id = l.branch_id
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
        order by l.sanctioned_on desc nulls last limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params) };
  }),
});

defineRoute({
  method: 'post', path: '/api/girvi/loans/:id/repayments', module: 'girvi',
  summary: 'Record a repayment',
  description: 'Interest is cleared before principal. The balance after the payment is stored so a receipt reprints exactly.',
  permission: 'girvi.update', params: idParam,
  body: z.object({
    amount: money, paidOn: isoDate,
    mode: z.enum(['cash', 'card', 'upi', 'bank_transfer', 'cheque']).default('cash'),
    reference: z.string().optional(), penaltyComponent: money.optional(),
  }),
  responses: [
    { status: 200, description: 'Recorded.', schema: record },
    { status: 422, description: 'Loan already closed.', schema: errorEnvelope },
  ],
  changelog: seed,
  handler: async (req) => transaction(async (tx) => {
    const id = param(req, 'id');
    const b = req.body;
    const loan = await tx.one<{ interest_accrued: string; interest_paid: string; outstanding_amount: string }>(
      `select interest_accrued, interest_paid, outstanding_amount from girvi_loan where id = $1 for update`, [id]);

    const penalty = b.penaltyComponent ?? '0';
    const interestOutstanding = sub(loan.interest_accrued, loan.interest_paid);
    const afterPenalty = sub(b.amount, penalty);
    // Interest first, then whatever is left reduces the principal.
    const toInterest = compare(afterPenalty, interestOutstanding) > 0 ? interestOutstanding : afterPenalty;
    const toPrincipal = sub(afterPenalty, toInterest);
    const outstandingAfter = sub(loan.outstanding_amount, toPrincipal);

    const { number } = await nextDocumentNumber(tx, 'girvi_receipt');
    const receipt = await repo(tx, 'girvi_repayment').insert({
      girvi_loan_id: id, receipt_number: number, paid_on: b.paidOn, amount: b.amount,
      interest_component: toInterest, principal_component: toPrincipal, penalty_component: penalty,
      mode: b.mode, reference: b.reference ?? null, collected_by: tx.context.userId,
      outstanding_after: outstandingAfter,
    });

    await tx.query(
      `update girvi_loan
          set interest_paid = interest_paid + $2, principal_repaid = principal_repaid + $3,
              outstanding_amount = $4,
              status = case when $4 <= 0.01 then 'redeemed' else 'active' end,
              redeemed_at = case when $4 <= 0.01 then now() else redeemed_at end,
              updated_at = now()
        where id = $1`, [id, toInterest, toPrincipal, outstandingAfter]);
    return receipt;
  }),
});

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

/* -------------------------------------------------------- platform */

defineRoute({
  method: 'get', path: '/api/platform/tenants', module: 'platform',
  summary: 'Tenant directory',
  description: 'Platform operators only. Crosses tenant boundaries deliberately.',
  permission: 'platform.tenants.view',
  query: z.object({ status: z.enum(['trial', 'active', 'suspended', 'closed']).optional() }).merge(pagination),
  responses: [
    { status: 200, description: 'Tenants with module counts.', schema: listOf(record) },
    { status: 403, description: 'Not a platform operator.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'SaaS admin tenant directory.' }],
  handler: async (req) => {
    const { asPlatform } = await import('../core/db/client.js');
    return asPlatform(async (tx) => {
      const q = queryOf<Record<string, string | number | undefined>>(req);
      const params: unknown[] = []; let where = '';
      if (q.status) { params.push(q.status); where = `where t.status = $${params.length}`; }
      return { rows: await tx.query(
        `select t.id, t.code, t.display_name, t.kind, t.status, t.created_at, t.activated_at,
                (select count(*) from tenant_module tm where tm.tenant_id = t.id and tm.enabled) as modules_enabled,
                (select count(*) from app_user u where u.tenant_id = t.id and u.deleted_at is null) as user_count
           from tenant t ${where} order by t.created_at desc
          limit ${Number(q.limit ?? 50)} offset ${Number(q.offset ?? 0)}`, params) };
    });
  },
});

defineRoute({
  method: 'put', path: '/api/platform/tenants/:id/modules/:moduleKey', module: 'platform',
  summary: 'Change a tenant’s module entitlement',
  description: 'Grant, revoke, or move a module between included / purchased / trial. This is the licensing controller.',
  permission: 'platform.entitlement.update',
  params: z.object({ id: uuid, moduleKey: z.string().min(1) }),
  body: z.object({
    enabled: z.boolean().optional(),
    licence: z.enum(['included', 'purchased', 'trial', 'expired']).optional(),
    trialEndsAt: z.string().datetime().nullish(), expiresAt: z.string().datetime().nullish(),
    disabledSubmodules: z.array(z.string()).optional(),
  }),
  responses: [
    { status: 200, description: 'Entitlement updated.', schema: record },
    { status: 403, description: 'Not a platform operator.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Module entitlement controller.' }],
  handler: async (req) => {
    const { asPlatform } = await import('../core/db/client.js');
    return asPlatform(async (tx) => {
      const b = req.body;
      return tx.one(
        `insert into tenant_module (id, tenant_id, module_key, enabled, licence, trial_ends_at, expires_at, disabled_submodules)
         values (gen_random_uuid(), $1, $2, coalesce($3, true), coalesce($4,'included'), $5, $6, coalesce($7,'[]'::jsonb))
         on conflict (tenant_id, module_key) do update
           set enabled = coalesce($3, tenant_module.enabled),
               licence = coalesce($4, tenant_module.licence),
               trial_ends_at = $5, expires_at = $6,
               disabled_submodules = coalesce($7, tenant_module.disabled_submodules),
               updated_at = now()
         returning *`,
        [param(req, 'id'), param(req, 'moduleKey'), b.enabled ?? null, b.licence ?? null,
         b.trialEndsAt ?? null, b.expiresAt ?? null,
         b.disabledSubmodules ? JSON.stringify(b.disabledSubmodules) : null]);
    });
  },
});

defineRoute({
  method: 'post', path: '/api/platform/support-sessions', module: 'platform',
  summary: 'Start a support impersonation session',
  description:
    'Time-boxed access into one tenant for support. Read-only unless `canWrite` is set. Every action during the window is tagged with the session id, so “support looked at my data” is always answerable with exactly what and when.',
  permission: 'platform.support.create',
  body: z.object({
    tenantId: uuid, reason: z.string().min(5).max(500),
    durationMinutes: z.number().int().min(5).max(480).default(120),
    canWrite: z.boolean().default(false).describe('Write access is a deliberate escalation.'),
  }),
  responses: [
    { status: 201, description: 'Session opened.', schema: z.object({ session: record, endsAt: z.string() }) },
    { status: 403, description: 'Not a platform operator.', schema: errorEnvelope },
  ],
  changelog: [{ date: TODAY, kind: 'added', note: 'Support impersonation with a hard time limit.' }],
  handler: async (req, res) => {
    const { asPlatform } = await import('../core/db/client.js');
    const out = await asPlatform(async (tx) => {
      const endsAt = new Date(Date.now() + req.body.durationMinutes * 60_000);
      const session = await tx.one(
        `insert into support_session (id, tenant_id, operator_user_id, reason, ends_at, can_write, ip_address)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6) returning *`,
        [req.body.tenantId, tx.context.userId, req.body.reason, endsAt, req.body.canWrite, req.ip ?? null]);
      return { session, endsAt: endsAt.toISOString() };
    });
    res.status(201).json(out);
  },
});

defineRoute({
  method: 'get', path: '/api/platform/feature-flags', module: 'platform',
  summary: 'Feature flags in effect',
  description: 'Global defaults, overridden per tenant where a tenant row exists.',
  permission: 'platform.flags.view',
  responses: [{ status: 200, description: 'Flags.', schema: z.object({ flags: z.array(record) }) }],
  changelog: seed,
  handler: async () => {
    const { asPlatform } = await import('../core/db/client.js');
    return asPlatform(async (tx) => ({
      flags: await tx.query(`select * from feature_flag order by flag_key, tenant_id nulls first`),
    }));
  },
});
