/**
 * Which modules a tenant has switched off, read on every gated request.
 *
 * Cached per tenant for TTL_MS, like user access. The super admin's change
 * clears this instance's entry at once; other instances catch up within TTL_MS.
 */
import { asTenant } from '../../core/db/client.js';
import { ForbiddenError } from '../../core/errors/app-error.js';
import { gateRefusal, type ModuleGate, type TenantModuleState } from './module-catalog.js';

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; states: Map<string, TenantModuleState> }>();

export async function tenantModuleStates(tenantId: string): Promise<Map<string, TenantModuleState>> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.states;

  const rows = await asTenant(tenantId, (tx) => tx.query<{
    module_key: string; enabled: boolean; licence: TenantModuleState['licence'];
    trial_ends_at: string | null; expires_at: string | null; disabled_submodules: string[] | null;
  }>(`select module_key, enabled, licence, trial_ends_at, expires_at, disabled_submodules from tenant_module`));

  const states = new Map<string, TenantModuleState>(rows.map((r) => [r.module_key, {
    enabled: r.enabled, licence: r.licence, trialEndsAt: r.trial_ends_at,
    expiresAt: r.expires_at, disabled: r.disabled_submodules ?? [],
  }]));
  cache.set(tenantId, { at: Date.now(), states });
  return states;
}

/** Call after changing a tenant's modules on THIS instance. */
export function invalidateTenantModules(tenantId: string): void {
  cache.delete(tenantId);
}

/** Throws `module_disabled` when the super admin has switched this endpoint's module off. */
export async function assertModuleOpen(tenantId: string, gate: ModuleGate): Promise<void> {
  const refusal = gateRefusal(gate, await tenantModuleStates(tenantId));
  if (!refusal) return;
  throw new ForbiddenError(
    `${refusal.name} is switched off for this business. Please contact Swarnay support to turn it on.`,
    'module_disabled',
    { module: refusal.module, subModule: refusal.subModule },
  );
}
