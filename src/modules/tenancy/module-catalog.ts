/**
 * The module registry, matching the frontend exactly.
 *
 * Keys, names, groups and licence states are taken from the RatnaGrid UI, so
 * `GET /api/tenancy/modules` can drive the module dock directly without the
 * frontend translating anything.
 */
export type TenantKind = 'manufacturer' | 'retailer' | 'both';
export type ModuleGroup = 'core' | 'operations' | 'commercial' | 'finance';

/**
 * How a tenant holds a module.
 *   included  — part of the base plan
 *   purchased — bought as an add-on
 *   trial     — time-limited evaluation, `trial_ends_at` applies
 *   expired   — was trial or purchased, now lapsed: visible but locked
 */
export const LICENCE_STATES = ['included', 'purchased', 'trial', 'expired'] as const;
export type LicenceState = (typeof LICENCE_STATES)[number];

export interface SubModuleSpec {
  key: string;
  name: string;
  appliesTo: TenantKind;
  status: 'live' | 'planned';
}

export interface ModuleSpec {
  key: string;
  order: number;
  group: ModuleGroup;
  /** Full name as shown on the module card. */
  name: string;
  /** Short name as shown in the nav dock. */
  shortName: string;
  description: string;
  /** Status line on the module card. */
  statusLabel: string;
  appliesTo: TenantKind;
  defaultLicence: LicenceState;
  subModules: SubModuleSpec[];
}

const sub = (key: string, name: string, appliesTo: TenantKind = 'both', status: SubModuleSpec['status'] = 'planned'): SubModuleSpec =>
  ({ key, name, appliesTo, status });

export const MODULE_CATALOG: ModuleSpec[] = [
  {
    key: 'dashboard', order: 1, group: 'core',
    name: 'Business Dashboard', shortName: 'Dashboard',
    description: 'Owner cockpit with configurable widgets, alerts and live business health.',
    statusLabel: 'Live Business Health',
    appliesTo: 'both', defaultLicence: 'included',
    subModules: [
      sub('dashboard.widgets', 'Widget Layout', 'both', 'live'),
      sub('dashboard.alerts', 'Actionable Alerts', 'both', 'live'),
    ],
  },
  {
    key: 'orders', order: 2, group: 'operations',
    name: 'Custom Orders & Karigar', shortName: 'Custom Orders',
    description: 'Bespoke jewellery intake, rate locks, CAD approvals, SLA tracking & artisan routing.',
    statusLabel: 'Karigar Assigned',
    appliesTo: 'both', defaultLicence: 'included',
    subModules: [
      sub('orders.booking', 'Booking', 'both', 'live'),
      sub('orders.custom', 'Custom / Made-to-Order', 'both', 'live'),
      sub('orders.repair', 'Repair & Alteration', 'both', 'live'),
      sub('orders.wedding', 'Bulk / Wedding', 'both', 'live'),
      sub('orders.corporate', 'Corporate / Bulk Gifting', 'both', 'live'),
      sub('orders.karigar', 'Karigar Routing', 'both', 'live'),
    ],
  },
  {
    key: 'stock', order: 3, group: 'operations',
    name: 'High-Value Stock & HUID', shortName: 'HUID Stock',
    description: 'Vault, counter & window inventory with piece-level weights & BIS tracking.',
    statusLabel: 'Zero untagged precious metal',
    appliesTo: 'both', defaultLicence: 'included',
    subModules: [
      sub('stock.pieces', 'Piece Register', 'both', 'live'),
      sub('stock.locations', 'Counter / Vault / Window', 'both', 'live'),
      sub('stock.transfer', 'Stock Transfer', 'both'),
      sub('stock.verification', 'Stock Verification', 'both'),
      sub('stock.raw', 'Raw Material Stock', 'manufacturer'),
    ],
  },
  {
    key: 'tagging', order: 4, group: 'operations',
    name: 'Tagging & Barcoding', shortName: 'Tagging',
    description: 'Dual-wing jewellery string tags, QR labels, thermal printer queues & BIS mapping.',
    statusLabel: 'HUID Barcode Queue',
    appliesTo: 'both', defaultLicence: 'included',
    subModules: [
      sub('tagging.generate', 'Tag Generation & HUID', 'both', 'live'),
      sub('tagging.templates', 'Tag Templates', 'both', 'live'),
      sub('tagging.queue', 'Print Queue', 'both', 'live'),
    ],
  },
  {
    key: 'pos', order: 5, group: 'operations',
    name: 'Point of Sale & Billing', shortName: 'POS & Billing',
    description: 'Speed billing, metal-rate calculations, Old Gold offsets, GST 3% tax invoices.',
    statusLabel: 'Speed Billing Active',
    appliesTo: 'both', defaultLicence: 'purchased',
    subModules: [
      sub('pos.counter', 'Counter Billing', 'both', 'live'),
      sub('pos.wholesale', 'Wholesale / B2B', 'both', 'live'),
      sub('pos.return', 'Customer Return', 'both', 'live'),
      sub('pos.einvoice', 'GST e-Invoice / IRN', 'both'),
      sub('pos.purchase', 'Purchase & GRN', 'both', 'live'),
    ],
  },
  {
    key: 'oldgold', order: 6, group: 'commercial',
    name: 'Old Gold Exchange & Melt', shortName: 'Old Gold',
    description: 'Spectrometer XRF test logging, dirt/stone deductions, buybacks & melt batches.',
    statusLabel: 'XRF Valuation Desk',
    appliesTo: 'both', defaultLicence: 'included',
    subModules: [
      sub('oldgold.intake', 'Intake & XRF Testing', 'both', 'live'),
      sub('oldgold.exchange', 'Exchange Credit', 'both', 'live'),
      sub('oldgold.buyback', 'Cash Buyback', 'both', 'live'),
      sub('oldgold.melt', 'Melt Batches', 'both', 'live'),
    ],
  },
  {
    key: 'schemes', order: 7, group: 'commercial',
    name: 'Swarna Nidhi (Chit Schemes)', shortName: 'Swarna Nidhi',
    description: 'Monthly gold savings plans, installment collection, bonus months & maturity redemption.',
    statusLabel: 'Accumulated Deposits',
    appliesTo: 'retailer', defaultLicence: 'purchased',
    subModules: [
      sub('schemes.plans', 'Scheme Plans', 'retailer', 'live'),
      sub('schemes.accounts', 'Enrollment', 'retailer', 'live'),
      sub('schemes.collection', 'Installment Collection', 'retailer', 'live'),
      sub('schemes.maturity', 'Maturity & Redemption', 'retailer', 'live'),
      sub('schemes.liability', 'Liability Dashboard', 'retailer'),
    ],
  },
  {
    key: 'girvi', order: 8, group: 'finance',
    name: 'Mortgage / Girvi (Pawn Loans)', shortName: 'Girvi',
    description: 'Gold collateral appraisal, 75% LTV, monthly interest accrual & release receipts.',
    statusLabel: 'Vault Custody Packets',
    appliesTo: 'retailer', defaultLicence: 'trial',
    subModules: [
      sub('girvi.sanction', 'Appraisal & Sanction', 'retailer', 'live'),
      sub('girvi.interest', 'Interest Accrual', 'retailer', 'live'),
      sub('girvi.repayment', 'Repayment', 'retailer', 'live'),
      sub('girvi.release', 'Release / Auction', 'retailer', 'live'),
    ],
  },
  {
    key: 'accounts', order: 9, group: 'finance',
    name: 'Dual-Metal & Cash Ledgers', shortName: 'Ledgers',
    description: 'Simultaneous Rupee (₹) & fine gold (grams) balancing, Karigar loss ghat ledger.',
    statusLabel: 'Dual-Metal Balances',
    appliesTo: 'both', defaultLicence: 'purchased',
    subModules: [
      sub('accounts.metal', 'Precious Metal Ledger', 'both', 'live'),
      sub('accounts.cash', 'Cash & Bank Book', 'both', 'live'),
      sub('accounts.ghat', 'Karigar Loss & Ghat Ledger', 'both', 'live'),
      sub('accounts.gst', 'GSTR-3B Tax Liability', 'both'),
      sub('accounts.ageing', 'Receivables & Payables', 'both'),
    ],
  },
  {
    key: 'master', order: 10, group: 'finance',
    name: 'Master Data & Rate Hub', shortName: 'Rate Hub',
    description: 'Live daily rate broadcasting, purity definitions, Karigars & PAN KYC compliance.',
    statusLabel: 'Live Rate Broadcast',
    appliesTo: 'both', defaultLicence: 'included',
    subModules: [
      sub('master.rates', 'Live Metal Rates', 'both', 'live'),
      sub('master.purity', 'Purity & Metal', 'both', 'live'),
      sub('master.customer', 'Customer CRM & PAN', 'both', 'live'),
      sub('master.karigar', 'Karigar Goldsmith Master', 'both', 'live'),
      sub('master.branch', 'Branch Master', 'both', 'live'),
      sub('master.item', 'Item & Category', 'both', 'live'),
    ],
  },
  {
    key: 'reports', order: 11, group: 'core',
    name: 'Executive & Owner BI', shortName: 'Owner BI',
    description: 'Mobile owner metrics, fast/slow turnover, purity split & exposure monitoring.',
    statusLabel: 'Live Business Health',
    appliesTo: 'both', defaultLicence: 'included',
    subModules: [
      sub('reports.sales', 'Sales Reports', 'both'),
      sub('reports.stock', 'Stock Reports', 'both'),
      sub('reports.financial', 'Financial Reports', 'both'),
      sub('reports.builder', 'Custom Report Builder', 'both'),
    ],
  },
  {
    key: 'settings', order: 12, group: 'core',
    name: 'Settings & Theme Studio', shortName: 'Theme Studio',
    description: 'CSS theme variables, luxury presets, approval workflows & branch parameters.',
    statusLabel: 'Theme & Tax Config',
    appliesTo: 'both', defaultLicence: 'included',
    subModules: [
      sub('settings.config', 'Config Engine', 'both', 'live'),
      sub('settings.theme', 'Theme Studio', 'both', 'live'),
      sub('settings.rbac', 'Roles & Permissions', 'both', 'live'),
      sub('settings.numbering', 'Numbering Schemes', 'both', 'live'),
      sub('settings.workflow', 'Approval Workflows', 'both'),
    ],
  },
  {
    key: 'platform', order: 13, group: 'core',
    name: 'Platform Operator & SaaS Admin', shortName: 'SaaS Admin',
    description: 'Multi-tenant subscription manager, module provisioning, feature flags & support mode.',
    statusLabel: 'Tenant & License Manager',
    appliesTo: 'both', defaultLicence: 'included',
    subModules: [
      sub('platform.tenants', 'Tenant Directory', 'both', 'live'),
      sub('platform.entitlement', 'Module Entitlement', 'both', 'live'),
      sub('platform.flags', 'Feature Flags', 'both', 'live'),
      sub('platform.support', 'Support Impersonation', 'both', 'live'),
    ],
  },
];

export const MODULE_KEYS = MODULE_CATALOG.map((m) => m.key);

export interface TenantModuleState {
  enabled: boolean;
  licence: LicenceState;
  trialEndsAt: string | null;
  expiresAt: string | null;
  disabled: string[];
}

/** A module a tenant holds but can no longer use is shown, and locked. */
export function isLocked(state: TenantModuleState, now = new Date()): boolean {
  if (state.licence === 'expired') return true;
  const deadline = state.licence === 'trial' ? state.trialEndsAt : state.expiresAt;
  return deadline !== null && new Date(deadline) < now;
}

/** Exactly what the module dock should render for one tenant. */
export function catalogFor(
  kind: TenantKind,
  states: Map<string, TenantModuleState>,
  now = new Date(),
) {
  const matches = (appliesTo: TenantKind) => appliesTo === 'both' || kind === 'both' || appliesTo === kind;

  return MODULE_CATALOG.filter((module) => {
    if (!matches(module.appliesTo)) return false;
    const state = states.get(module.key);
    return state ? state.enabled : true;
  }).map((module) => {
    const state = states.get(module.key);
    const licence = state?.licence ?? module.defaultLicence;
    const locked = state ? isLocked(state, now) : false;
    const disabled = new Set(state?.disabled ?? []);

    return {
      key: module.key,
      order: module.order,
      group: module.group,
      name: module.name,
      shortName: module.shortName,
      description: module.description,
      statusLabel: module.statusLabel,
      licence: locked ? ('expired' as LicenceState) : licence,
      locked,
      trialEndsAt: state?.trialEndsAt ?? null,
      expiresAt: state?.expiresAt ?? null,
      subModules: module.subModules.filter((s) => matches(s.appliesTo) && !disabled.has(s.key)),
    };
  });
}
