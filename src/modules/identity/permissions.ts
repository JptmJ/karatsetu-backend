/**
 * Permission strings are dotted paths: `module.submodule.action`.
 * A role holding `trade.*` covers everything under trade; `*` covers everything.
 */
export const ACTIONS = ['view', 'create', 'update', 'delete', 'post', 'cancel', 'approve'] as const;
export type Action = (typeof ACTIONS)[number];

export function hasPermission(held: Set<string>, needed: string): boolean {
  if (held.has('*') || held.has(needed)) return true;

  const parts = needed.split('.');
  for (let i = parts.length; i > 0; i--) {
    if (held.has(`${parts.slice(0, i - 1).concat('*').join('.')}`)) return true;
  }
  return false;
}

/** The roles every new tenant starts with. */
export const SYSTEM_ROLES = [
  {
    code: 'owner',
    name: 'Owner',
    description: 'Full access to everything, including settings, users and licensing.',
    permissions: ['*'],
  },
  {
    code: 'manager',
    name: 'Store Manager',
    description: 'Runs day-to-day operations at a branch. Cannot change global settings or licensing.',
    permissions: [
      'orders.*', 'stock.*', 'tagging.*', 'pos.*', 'oldgold.*',
      'schemes.*', 'girvi.*', 'master.*', 'reports.*', 'accounts.*.view',
      'settings.config.view', 'settings.theme.view',
    ],
  },
  {
    code: 'sales',
    name: 'Floor Executive',
    description: 'Bills customers and looks up stock. Cannot change prices, masters or licensing.',
    permissions: [
      'pos.view', 'pos.create',
      'stock.view', 'tagging.view',
      'master.customer.view', 'master.customer.create', 'master.rates.view',
      'orders.view', 'orders.create',
      'oldgold.view', 'oldgold.create',
      'schemes.accounts.view', 'schemes.collection.*',
      'reports.owner.view',
    ],
  },
  {
    code: 'accountant',
    name: 'Accountant',
    description: 'Books, ledgers and reports. Read-only on operations.',
    permissions: ['accounts.*', 'reports.*', 'pos.*.view', 'stock.*.view', 'girvi.view', 'schemes.*.view'],
  },
  {
    code: 'storekeeper',
    name: 'Store Keeper',
    description: 'Receives goods, tags pieces and moves stock between locations.',
    permissions: ['stock.*', 'tagging.*', 'pos.purchase.view', 'pos.purchase.create', 'master.*.view'],
  },
  {
    code: 'support',
    name: 'Support Engineer',
    description: 'Platform operator. Can open a time-boxed support session into a tenant.',
    permissions: ['platform.*', 'reports.*', 'settings.config.view'],
  },
] as const;
