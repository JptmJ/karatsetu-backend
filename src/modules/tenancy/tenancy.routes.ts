import { Router } from 'express';
import { handler } from '../../core/http/middleware.js';
import { transaction } from '../../core/db/client.js';
import { catalogFor, type LicenceState, type TenantKind, type TenantModuleState } from './module-catalog.js';

export const tenancyRouter = Router();

/**
 * Everything the module dock needs in one call: the tenant, its theme, and the
 * modules it holds with their licence state. The frontend renders whatever this
 * returns, so switching a module off is a config change, not a deploy.
 */
tenancyRouter.get(
  '/modules',
  handler(async (req, res) => {
    const result = await transaction(async (tx) => {
      const tenant = await tx.one<{ kind: TenantKind; display_name: string; code: string; status: string }>(
        `select kind, display_name, code, status from tenant where id = $1`,
        [tx.context.tenantId],
      );

      const rows = await tx.query<{
        module_key: string; enabled: boolean; licence: LicenceState;
        trial_ends_at: string | null; expires_at: string | null; disabled_submodules: string[];
      }>(
        `select module_key, enabled, licence, trial_ends_at, expires_at, disabled_submodules
           from tenant_module`,
      );

      const states = new Map<string, TenantModuleState>(
        rows.map((r) => [
          r.module_key,
          {
            enabled: r.enabled,
            licence: r.licence,
            trialEndsAt: r.trial_ends_at,
            expiresAt: r.expires_at,
            disabled: r.disabled_submodules ?? [],
          },
        ]),
      );

      const theme = await tx.maybeOne<{ preset_key: string; css_variables: Record<string, string>; logo_url: string | null }>(
        `select preset_key, css_variables, logo_url from tenant_theme
          where branch_id is null and is_active = true limit 1`,
      );

      return {
        tenant: {
          code: tenant.code,
          name: tenant.display_name,
          kind: tenant.kind,
          status: tenant.status,
        },
        theme: theme ?? { preset_key: 'deep-forest', css_variables: {}, logo_url: null },
        modules: catalogFor(tenant.kind, states),
      };
    });

    res.json(result);
  }),
);
