/**
 * Role TEMPLATES. Every tenant gets these seeded as editable `role` rows
 * (is_system = true). Access is decided by the tenant's rows, not by this file.
 */

/**
 * There is exactly one super admin, created by `npm run seed:superadmin` and
 * never through the API. No second operator, no support tier — if that changes,
 * it should be a deliberate decision rather than a form someone found.
 */
export const SUPER_ADMIN = {
  code: 'super_admin',
  name: 'Super Admin',
  description: 'The single platform operator. Creates tenants, branches and all users.',
  permissions: ['*'],
} as const;

export type PlatformRoleCode = typeof SUPER_ADMIN.code;

/**
 * Roles inside a jewellery business. Fixed, and assigned only by the super
 * admin. There is no rank ladder any more because nobody here hands out roles.
 */
export const TENANT_ROLES = [
  {
    code: 'owner',
    name: 'Owner',
    description: 'Full access to the business, including staff, roles and settings.',
    isBranchAdmin: true,
    permissions: ['*'],
  },
  {
    code: 'admin',
    name: 'Branch Admin',
    description:
      'Runs a branch — billing, orders, stock, old gold, rates and reports. Cannot add or change staff; that is the super admin’s job.',
    /** At most one per branch, or one covering every branch. */
    isBranchAdmin: true,
    permissions: [
      'orders.*', 'stock.*', 'tagging.*', 'pos.*', 'oldgold.*',
      'schemes.*', 'girvi.*', 'master.*', 'reports.*', 'accounts.*',
      'settings.config.view', 'settings.config.update',
      'settings.theme.view', 'settings.theme.update',
      'settings.numbering.view', 'settings.numbering.update',
      /*
       * Read-only on staff: an admin should be able to see who works here and
       * what each person can do. `settings.users.create` and `.update` are
       * deliberately absent, and the endpoints behind them no longer exist —
       * staff are the super admin's to manage.
       */
      'settings.users.view', 'settings.users.manage', 'settings.roles.view',
    ],
  },
  {
    code: 'sales',
    name: 'Sales Executive',
    description: 'Bills customers, books orders and takes old gold in. Cannot change prices or masters.',
    isBranchAdmin: false,
    permissions: [
      'pos.view', 'pos.create',
      'orders.view', 'orders.create', 'orders.update',
      'stock.view', 'tagging.view',
      'oldgold.view', 'oldgold.create',
      'schemes.accounts.view', 'schemes.collection.view', 'schemes.collection.create',
      'master.customer.view', 'master.customer.create', 'master.rates.view', 'master.item.view',
      'reports.owner.view',
    ],
  },
  {
    code: 'cashier',
    name: 'Cashier',
    description: 'Takes payment and closes bills. Cannot give discounts above the approval limit.',
    isBranchAdmin: false,
    permissions: [
      'pos.view', 'pos.create', 'orders.view', 'stock.view',
      'oldgold.view', 'schemes.collection.view', 'schemes.collection.create',
      'master.customer.view', 'master.customer.create', 'master.rates.view',
    ],
  },
  {
    code: 'accountant',
    name: 'Accountant',
    description: 'Books, ledgers, GST and reports. Read-only on operations.',
    isBranchAdmin: false,
    permissions: [
      'accounts.*', 'reports.*',
      'pos.view', 'orders.view', 'stock.view',
      'girvi.view', 'schemes.accounts.view', 'schemes.collection.view',
      'master.customer.view', 'master.rates.view',
      'settings.config.view',
    ],
  },
  {
    code: 'storekeeper',
    name: 'Store Keeper',
    description: 'Receives goods, tags pieces, moves stock and counts it. Cannot adjust stock or post a count.',
    isBranchAdmin: false,
    permissions: [
      'stock.view', 'stock.opening.create', 'stock.transfer.create', 'stock.transfer.post', 'stock.transfer.cancel',
      'stock.count.create', 'tagging.*',
      'pos.purchase.view', 'pos.purchase.create',
      'master.item.view', 'master.purity.view', 'master.branch.view', 'master.rates.view',
    ],
  },
] as const;

export type TenantRoleCode = (typeof TENANT_ROLES)[number]['code'];
export const TENANT_ROLE_CODES = TENANT_ROLES.map((r) => r.code);

export const tenantRole = (code: string) => TENANT_ROLES.find((r) => r.code === code);

/** The permissions a tenant user's token carries. */
export function permissionsFor(roleCode: string): string[] {
  return [...(tenantRole(roleCode)?.permissions ?? [])];
}

export const ADMIN_ROLE: TenantRoleCode = 'admin';
export const isAdminRole = (code: string): boolean => code === ADMIN_ROLE;
