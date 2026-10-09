import { describe, it, expect } from 'vitest';
import {
  gateRefusal, moduleGateFor, subModulesOf, type TenantModuleState,
} from '../src/modules/tenancy/module-catalog.js';

/**
 * Which module an endpoint belongs to, and when a tenant is refused it.
 *
 * Pure logic, no database: the middleware that uses it only adds a cached
 * lookup of the tenant's `tenant_module` rows.
 */
const on = (over: Partial<TenantModuleState> = {}): TenantModuleState =>
  ({ enabled: true, licence: 'included', trialEndsAt: null, expiresAt: null, disabled: [], ...over });

describe('moduleGateFor', () => {
  it('prefers the route module when it is a catalog key', () => {
    // The dashboard reads with a reports permission; Owner BI off must not take it down.
    expect(moduleGateFor('dashboard', 'reports.owner.view')).toEqual({ module: 'dashboard', subModule: null });
  });

  it('falls back to the permission prefix', () => {
    expect(moduleGateFor('purchase', 'pos.purchase.view')).toEqual({ module: 'pos', subModule: 'pos.purchase' });
    expect(moduleGateFor('inventory', 'stock.view')).toEqual({ module: 'stock', subModule: null });
  });

  it('matches a sub-module only when the permission names one', () => {
    expect(moduleGateFor('orders', 'orders.create')).toEqual({ module: 'orders', subModule: null });
    expect(moduleGateFor('stock', 'stock.transfer.create')).toEqual({ module: 'stock', subModule: 'stock.transfer' });
  });

  it('never gates required modules or routes outside the catalog', () => {
    expect(moduleGateFor('master', 'master.item.view')).toBeNull();
    expect(moduleGateFor('settings', 'settings.users.view')).toBeNull();
    expect(moduleGateFor('identity', undefined)).toBeNull();
  });

  it('records which sub-modules the API can refuse', () => {
    moduleGateFor('girvi', 'girvi.view');
    expect(subModulesOf('pos').find((s) => s.key === 'pos.purchase')?.enforced).toBe(true);
    expect(subModulesOf('orders').find((s) => s.key === 'orders.repair')?.enforced).toBe(false);
  });
});

describe('gateRefusal', () => {
  const girvi = { module: 'girvi', subModule: null };
  const purchase = { module: 'pos', subModule: 'pos.purchase' };

  it('lets through a module with no row — it is on by default', () => {
    expect(gateRefusal(girvi, new Map())).toBeNull();
  });

  it('refuses a module switched off', () => {
    const refusal = gateRefusal(girvi, new Map([['girvi', on({ enabled: false })]]));
    expect(refusal).toMatchObject({ module: 'girvi', subModule: null });
  });

  it('refuses a switched-off sub-module but not the rest of the module', () => {
    const states = new Map([['pos', on({ disabled: ['pos.purchase'] })]]);
    expect(gateRefusal(purchase, states)).toMatchObject({ module: 'pos', subModule: 'pos.purchase' });
    expect(gateRefusal({ module: 'pos', subModule: null }, states)).toBeNull();
  });

  it('does not refuse a lapsed licence — that is shown locked, not switched off', () => {
    expect(gateRefusal(girvi, new Map([['girvi', on({ licence: 'expired' })]]))).toBeNull();
  });
});
