/**
 * Setting up a new tenant.
 *
 * A tenant with no chart of accounts, no numbering series and no purities
 * cannot do anything at all — the first invoice would fail on four different
 * missing rows. So provisioning creates a working starting point, and the
 * tenant edits it from there.
 */
import type { Tx } from '../../core/db/client.js';
import { asPlatform, asTenant } from '../../core/db/client.js';
import { newId } from '../../core/util/id.js';
import { logger } from '../../core/util/logger.js';
import { DEFAULT_ACCOUNTS } from '../accounts/accounts.schema.js';
import { DEFAULT_SERIES } from '../numbering/numbering.service.js';
import { SYSTEM_ROLES } from '../identity/permissions.js';
import { hashPassword } from '../identity/auth.service.js';
import { MODULE_CATALOG, type TenantKind } from './module-catalog.js';

export interface ProvisionInput {
  code: string;
  legalName: string;
  displayName?: string;
  kind: TenantKind;
  gstin?: string;
  stateCode?: string;
  owner: { email: string; fullName: string; password: string };
  firstBranch?: { code: string; name: string; kind?: 'showroom' | 'factory' | 'warehouse' | 'office' };
}

export async function provisionTenant(input: ProvisionInput): Promise<{
  tenantId: string; branchId: string; ownerUserId: string;
}> {
  // The tenant row itself has to be created outside any tenant scope —
  // there is no tenant to scope to yet.
  const tenantId = await asPlatform(async (tx) => {
    const existing = await tx.maybeOne<{ id: string }>(
      `select id from tenant where lower(code) = lower($1)`, [input.code],
    );
    if (existing) throw new Error(`A tenant with code "${input.code}" already exists.`);

    const id = newId();
    await tx.query(
      `insert into tenant (id, code, legal_name, display_name, kind, status, gstin, activated_at)
       values ($1, $2, $3, $4, $5, 'active', $6, now())`,
      [id, input.code, input.legalName, input.displayName ?? input.legalName, input.kind, input.gstin ?? null],
    );
    return id;
  });

  // Everything else is ordinary tenant-scoped work.
  const result = await asTenant(tenantId, async (tx) => {
    await enableModules(tx, input.kind);
    const branchId = await createFirstBranch(tx, input);
    await createAccounts(tx);
    await createNumberingSeries(tx, branchId);
    await createMetalsAndPurities(tx);
    const ownerUserId = await createOwner(tx, input, branchId);
    return { branchId, ownerUserId };
  });

  logger.info({ tenantId, code: input.code, kind: input.kind }, 'Tenant provisioned');
  return { tenantId, ...result };
}

async function enableModules(tx: Tx, kind: TenantKind): Promise<void> {
  const applicable = MODULE_CATALOG.filter(
    (m) => m.appliesTo === 'both' || kind === 'both' || m.appliesTo === kind,
  );
  // Trials get a real deadline so the lock behaviour can actually be exercised.
  const trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  for (const module of applicable) {
    await tx.query(
      `insert into tenant_module (id, tenant_id, module_key, enabled, licence, trial_ends_at, purchased_at)
       values ($1, $2, $3, true, $4, $5, $6)`,
      [
        newId(), tx.context.tenantId, module.key, module.defaultLicence,
        module.defaultLicence === 'trial' ? trialEnds : null,
        module.defaultLicence === 'purchased' ? new Date() : null,
      ],
    );
  }

  await tx.query(
    `insert into tenant_theme (id, tenant_id, preset_key, css_variables, is_active)
     values ($1, $2, 'deep-forest', '{}'::jsonb, true)`,
    [newId(), tx.context.tenantId],
  );
}

async function createFirstBranch(tx: Tx, input: ProvisionInput): Promise<string> {
  const branchId = newId();
  const branch = input.firstBranch ?? { code: 'MAIN', name: 'Main Branch' };

  await tx.query(
    `insert into branch (id, tenant_id, code, name, kind, gstin, state_code, is_active)
     values ($1, $2, $3, $4, $5, $6, $7, true)`,
    [
      branchId, tx.context.tenantId, branch.code, branch.name,
      branch.kind ?? (input.kind === 'manufacturer' ? 'factory' : 'showroom'),
      input.gstin ?? null, input.stateCode ?? null,
    ],
  );

  // Every branch needs somewhere for stock to sit, or the first purchase fails.
  const locations =
    input.kind === 'manufacturer'
      ? [
          { code: 'VAULT', name: 'Vault', kind: 'vault', is_default: true },
          { code: 'FLOOR', name: 'Production Floor', kind: 'floor', is_default: false },
        ]
      : [
          { code: 'COUNTER', name: 'Counter', kind: 'counter', is_default: true },
          { code: 'VAULT', name: 'Vault', kind: 'vault', is_default: false },
          { code: 'WINDOW', name: 'Display Window', kind: 'window', is_default: false },
        ];

  for (const location of locations) {
    await tx.query(
      `insert into stock_location (id, tenant_id, branch_id, code, name, kind, is_default, is_active)
       values ($1, $2, $3, $4, $5, $6, $7, true)`,
      [newId(), tx.context.tenantId, branchId, location.code, location.name, location.kind, location.is_default],
    );
  }

  return branchId;
}

async function createAccounts(tx: Tx): Promise<void> {
  for (const account of DEFAULT_ACCOUNTS) {
    await tx.query(
      `insert into account (id, tenant_id, code, name, account_type, is_control, control_for, tracks_metal, is_system)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
      [
        newId(), tx.context.tenantId, account.code, account.name, account.account_type,
        'is_control' in account ? account.is_control : false,
        'control_for' in account ? account.control_for : null,
        'tracks_metal' in account ? account.tracks_metal : false,
      ],
    );
  }
}

async function createNumberingSeries(tx: Tx, branchId: string): Promise<void> {
  for (const series of DEFAULT_SERIES) {
    await tx.query(
      `insert into numbering_series
         (id, tenant_id, doc_type, branch_id, name, prefix, padding, reset_period, next_number, is_active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 1, true)`,
      [
        newId(), tx.context.tenantId, series.doc_type, branchId, series.name, series.prefix,
        'padding' in series ? series.padding : 5,
        'reset_period' in series ? series.reset_period : 'financial_yearly',
      ],
    );
  }
}

/** The purities an Indian jeweller actually deals in, as a starting point. */
async function createMetalsAndPurities(tx: Tx): Promise<void> {
  const metals = [
    {
      code: 'GOLD', name: 'Gold', hsn: '7113', sort: 1,
      purities: [
        { code: '24K', name: '24 Karat (999)', fineness: '99.900', karat: '24', sort: 1 },
        { code: '22K', name: '22 Karat (916)', fineness: '91.600', karat: '22', sort: 2 },
        { code: '20K', name: '20 Karat', fineness: '83.300', karat: '20', sort: 3 },
        { code: '18K', name: '18 Karat (750)', fineness: '75.000', karat: '18', sort: 4 },
        { code: '14K', name: '14 Karat (585)', fineness: '58.500', karat: '14', sort: 5 },
      ],
    },
    {
      code: 'SILVER', name: 'Silver', hsn: '7114', sort: 2,
      purities: [
        { code: '999', name: 'Fine Silver (999)', fineness: '99.900', karat: null, sort: 1 },
        { code: '925', name: 'Sterling Silver (925)', fineness: '92.500', karat: null, sort: 2 },
      ],
    },
    {
      code: 'PLATINUM', name: 'Platinum', hsn: '7110', sort: 3,
      purities: [{ code: 'PT950', name: 'Platinum 950', fineness: '95.000', karat: null, sort: 1 }],
    },
  ];

  for (const metal of metals) {
    const metalId = newId();
    await tx.query(
      `insert into metal (id, tenant_id, code, name, hsn_code, sort_order, is_active)
       values ($1, $2, $3, $4, $5, $6, true)`,
      [metalId, tx.context.tenantId, metal.code, metal.name, metal.hsn, metal.sort],
    );

    for (const purity of metal.purities) {
      await tx.query(
        `insert into purity (id, tenant_id, metal_id, code, name, fineness_percent, karat, sort_order, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [newId(), tx.context.tenantId, metalId, purity.code, purity.name, purity.fineness, purity.karat, purity.sort],
      );
    }
  }
}

async function createOwner(tx: Tx, input: ProvisionInput, branchId: string): Promise<string> {
  const roleIds = new Map<string, string>();
  for (const role of SYSTEM_ROLES) {
    const roleId = newId();
    await tx.query(
      `insert into role (id, tenant_id, code, name, description, is_system, permissions)
       values ($1, $2, $3, $4, $5, true, $6::jsonb)`,
      [roleId, tx.context.tenantId, role.code, role.name, role.description, JSON.stringify(role.permissions)],
    );
    roleIds.set(role.code, roleId);
  }

  const userId = newId();
  await tx.query(
    `insert into app_user (id, tenant_id, email, full_name, password_hash, default_branch_id, is_active)
     values ($1, $2, $3, $4, $5, $6, true)`,
    [userId, tx.context.tenantId, input.owner.email.toLowerCase(), input.owner.fullName,
     await hashPassword(input.owner.password), branchId],
  );

  await tx.query(
    `insert into user_role (id, tenant_id, user_id, role_id) values ($1, $2, $3, $4)`,
    [newId(), tx.context.tenantId, userId, roleIds.get('owner')],
  );

  return userId;
}
