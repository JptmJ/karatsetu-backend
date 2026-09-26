import type { Tx } from '../../core/db/client.js';
import { newId } from '../../core/util/id.js';
import { TENANT_ROLES } from '../platform/roles.js';

/**
 * Creates the system roles for the tenant on `tx`. Safe to re-run: existing roles
 * keep whatever permissions the tenant has since edited. Returns code → role id.
 */
export async function seedSystemRoles(tx: Tx): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const template of TENANT_ROLES) {
    const role = await tx.one<{ id: string; inserted: boolean }>(
      `insert into role (id, tenant_id, code, name, description, is_system, created_by, updated_by)
       values ($1, $2, $3, $4, $5, true, $6, $6)
       on conflict (tenant_id, code) where deleted_at is null
       do update set name = role.name
       returning id, (xmax = 0) as inserted`,
      [newId(), tx.context.tenantId, template.code, template.name, template.description, tx.context.userId],
    );
    ids.set(template.code, role.id);

    if (role.inserted) {
      for (const permission of template.permissions) {
        await tx.query(
          `insert into role_permission (id, tenant_id, role_id, permission, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $5) on conflict do nothing`,
          [newId(), tx.context.tenantId, role.id, permission, tx.context.userId],
        );
      }
    }
  }
  return ids;
}
