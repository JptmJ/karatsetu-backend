/**
 * RatnaGrid API client — GENERATED, DO NOT EDIT BY HAND.
 *
 * Regenerate with `npm run gen:client` in the backend, then copy this file
 * into the frontend. Every type here comes from the schema that validates the
 * real request, so a mismatch between this file and the server is impossible.
 *
 * Generated 2026-09-20T10:47:34.332Z from 122 endpoints.
 */

export interface ApiError {
  code: "validation_error" | "unauthorized" | "forbidden" | "module_locked" | "not_found" | "duplicate" | "in_use" | "conflict" | "busy" | "check_failed" | "business_rule" | "insufficient_stock" | "rate_missing" | "numbering_series_missing" | "already_posted" | "backdating_not_allowed" | "invalid_stage_move" | "internal_error" | (string & {});
  message: string;
  details?: unknown;
  requestId?: string;
}

/** Thrown by every client method when the server returns a non-2xx response. */
export class RatnaGridApiError extends Error {
  constructor(readonly status: number, readonly error: ApiError) {
    super(error.message);
    this.name = 'RatnaGridApiError';
  }
  /** Field-level messages from a 400, ready to drop onto a form. */
  get fieldErrors(): Array<{ field: string; message: string }> {
    return Array.isArray(this.error.details) ? (this.error.details as Array<{ field: string; message: string }>) : [];
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** Called before each request. Return null when signed out. */
  getToken?: () => string | null | undefined;
  /** Sent as X-Branch-Id, so the server knows which branch you are acting at. */
  getBranchId?: () => string | null | undefined;
  /** Called on a 401 so the app can refresh the token or sign the user out. */
  onUnauthorized?: () => void;
  fetch?: typeof globalThis.fetch;
}

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;

  async function request<T>(
    method: string,
    path: string,
    init: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(path, options.baseUrl);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const token = options.getToken?.();
    if (token) headers.authorization = `Bearer ${token}`;
    const branchId = options.getBranchId?.();
    if (branchId) headers['x-branch-id'] = branchId;

    const response = await doFetch(url.toString(), {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (response.status === 204) return undefined as T;

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) options.onUnauthorized?.();
      throw new RatnaGridApiError(
        response.status,
        (payload as { error?: ApiError })?.error ?? { code: 'internal_error', message: response.statusText },
      );
    }
    return payload as T;
  }

  return {
    request,
    /**
     * Sign in and receive tokens
     *
     * Returns a short-lived access token plus a long-lived refresh token. Send the access token as `Authorization: Bearer <token>` on every other call. The same message is returned for a wrong email and a wrong password, so the response cannot be used to discover which accounts exist.
     * `POST /api/auth/login`
     */
    postAuthLogin(body: {
      /** The tenant slug, e.g. "aarohi". */
      tenantCode: string;
      email: string;
      password: string;
    }): Promise<{
      accessToken: string;
      refreshToken: string;
      user: {
        id: string;
        email: string;
        fullName: string;
        branchId: string | null;
      };
      tenant: {
        id: string;
        code: string;
        name: string;
        kind: string;
      };
      roles: Array<string>;
      permissions: Array<string>;
    }> {
      return request<{
      accessToken: string;
      refreshToken: string;
      user: {
        id: string;
        email: string;
        fullName: string;
        branchId: string | null;
      };
      tenant: {
        id: string;
        code: string;
        name: string;
        kind: string;
      };
      roles: Array<string>;
      permissions: Array<string>;
    }>('POST', "/api/auth/login", { body });
    },
    /**
     * Exchange a refresh token for a new access token
     *
     * `POST /api/auth/refresh`
     */
    postAuthRefresh(body: {
      refreshToken: string;
    }): Promise<{
      accessToken: string;
    }> {
      return request<{
      accessToken: string;
    }>('POST', "/api/auth/refresh", { body });
    },
    /**
     * Revoke a refresh token
     *
     * `POST /api/auth/logout`
     */
    postAuthLogout(body: {
      refreshToken: string;
    }): Promise<void> {
      return request<void>('POST', "/api/auth/logout", { body });
    },
    /**
     * Modules, licences and theme for the signed-in tenant
     *
     * Everything the module dock needs in one call. `locked: true` means the tenant holds the module but the licence has lapsed — show it, disabled, with a renew prompt. Modules the tenant should not see at all are simply absent.
     * `GET /api/tenancy/modules`
     */
    getTenancyModules(): Promise<{
      tenant: {
        code: string;
        name: string;
        kind: string;
        status: string;
      };
      theme: {
        preset_key: string;
        css_variables: Record<string, unknown>;
        logo_url: unknown;
      };
      modules: Array<{
        key: string;
        order: number;
        group: string;
        name: string;
        shortName: string;
        description: string;
        statusLabel: string;
        licence: "included" | "purchased" | "trial" | "expired";
        locked: boolean;
        trialEndsAt: unknown;
        expiresAt: unknown;
        subModules: Array<{
          key: string;
          name: string;
          status: string;
        }>;
      }>;
    }> {
      return request<{
      tenant: {
        code: string;
        name: string;
        kind: string;
        status: string;
      };
      theme: {
        preset_key: string;
        css_variables: Record<string, unknown>;
        logo_url: unknown;
      };
      modules: Array<{
        key: string;
        order: number;
        group: string;
        name: string;
        shortName: string;
        description: string;
        statusLabel: string;
        licence: "included" | "purchased" | "trial" | "expired";
        locked: boolean;
        trialEndsAt: unknown;
        expiresAt: unknown;
        subModules: Array<{
          key: string;
          name: string;
          status: string;
        }>;
      }>;
    }>('GET', "/api/tenancy/modules");
    },
    /**
     * The full module catalog, independent of any tenant
     *
     * Every module the platform offers. Used by the SaaS admin screen when provisioning.
     * `GET /api/tenancy/catalog`
     * Requires `platform.tenants.view`.
     */
    getTenancyCatalog(): Promise<{
      modules: Array<Record<string, unknown>>;
    }> {
      return request<{
      modules: Array<Record<string, unknown>>;
    }>('GET', "/api/tenancy/catalog");
    },
    /**
     * All settings with their effective values
     *
     * Each entry carries `value` (what applies now) and `source` (whether that came from a branch override, a tenant override, or the built-in default). Grouped by `group` so the settings screen can render tabs directly.
     * `GET /api/settings/config`
     * Requires `settings.config.view`.
     */
    getSettingsConfig(): Promise<{
      groups: Record<string, unknown>;
    }> {
      return request<{
      groups: Record<string, unknown>;
    }>('GET', "/api/settings/config");
    },
    /**
     * Change one setting
     *
     * Validated against the setting’s declared type. Settings marked `sensitive` change how past numbers are interpreted — warn before saving those.
     * `PUT /api/settings/config/:key`
     * Requires `settings.config.update`.
     */
    putSettingsConfigByKey(params: { key: string }, body: {
      /** Must match the setting’s declared type. */
      value: unknown;
      /** Only for branch-scoped settings. */
      branchId?: string | null;
      reason?: string;
    }): Promise<{
      ok: boolean;
      key: string;
    }> {
      return request<{
      ok: boolean;
      key: string;
    }>('PUT', `/api/settings/config/${encodeURIComponent(params.key)}`, { body });
    },
    /**
     * The active theme
     *
     * `GET /api/settings/theme`
     * Requires `settings.theme.view`.
     */
    getSettingsTheme(): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', "/api/settings/theme");
    },
    /**
     * Change the theme
     *
     * Preset keys match the frontend theme ids exactly.
     * `PUT /api/settings/theme`
     * Requires `settings.theme.update`.
     */
    putSettingsTheme(body: {
      preset_key: "deep-forest" | "royal-ruby" | "sapphire-platinum" | "obsidian-luxury" | "rose-gold" | "custom";
      /** CSS custom properties layered over the preset. */
      css_variables?: Record<string, unknown>;
      logo_url?: string | null;
      /** Null sets the tenant default. */
      branch_id?: string | null;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PUT', "/api/settings/theme", { body });
    },
    /**
     * The owner cockpit figures
     *
     * One call returns every headline metric the dashboard shows. Computed live; cache it on the client for a minute rather than polling.
     * `GET /api/dashboard/summary`
     * Requires `reports.owner.view`.
     */
    getDashboardSummary(query?: {
      branchId?: string;
    }): Promise<{
      stockValue: {
        total: string;
        goldWeight: string;
        silverWeight: string;
      };
      todaySales: {
        amount: string;
        count: number;
      };
      customers: {
        total: number;
      };
      pendingOrders: {
        count: number;
        value: string;
      };
      oldGoldToday: {
        weight: string;
        value: string;
      };
      schemeDue: {
        count: number;
        amount: string;
      };
      receivables: {
        amount: string;
        accounts: number;
      };
      alerts: Array<{
        key: string;
        label: string;
        count: number;
      }>;
    }> {
      return request<{
      stockValue: {
        total: string;
        goldWeight: string;
        silverWeight: string;
      };
      todaySales: {
        amount: string;
        count: number;
      };
      customers: {
        total: number;
      };
      pendingOrders: {
        count: number;
        value: string;
      };
      oldGoldToday: {
        weight: string;
        value: string;
      };
      schemeDue: {
        count: number;
        amount: string;
      };
      receivables: {
        amount: string;
        accounts: number;
      };
      alerts: Array<{
        key: string;
        label: string;
        count: number;
      }>;
    }>('GET', "/api/dashboard/summary", { query });
    },
    /**
     * The saved widget layout for the signed-in user
     *
     * Falls back to the role default when the user has not customised anything.
     * `GET /api/dashboard/layout`
     * Requires `reports.owner.view`.
     */
    getDashboardLayout(): Promise<{
      widgets: Array<Record<string, unknown>>;
      source: string;
    }> {
      return request<{
      widgets: Array<Record<string, unknown>>;
      source: string;
    }>('GET', "/api/dashboard/layout");
    },
    /**
     * Save the widget layout
     *
     * `PUT /api/dashboard/layout`
     * Requires `reports.owner.view`.
     */
    putDashboardLayout(body: {
      /** In display order. */
      widgets: Array<{
        key: string;
        visible?: boolean;
        section?: "overview" | "signals" | "insights" | "operations";
        order?: number;
      }>;
    }): Promise<{
      ok: boolean;
    }> {
      return request<{
      ok: boolean;
    }>('PUT', "/api/dashboard/layout", { body });
    },
    /**
     * List branchs
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/master/branches`
     * Requires `master.branch.view`.
     */
    getMasterBranches(query?: {
      /** Matches code, name, city. */
      search?: string;
      kind?: "showroom" | "factory" | "warehouse" | "office";
      is_active?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/master/branches", { query });
    },
    /**
     * Get one branch
     *
     * `GET /api/master/branches/:id`
     * Requires `master.branch.view`.
     */
    getMasterBranchesById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/master/branches/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a branch
     *
     * `POST /api/master/branches`
     * Requires `master.branch.create`.
     */
    postMasterBranches(body: {
      code: string;
      name: string;
      kind?: "showroom" | "factory" | "warehouse" | "office";
      gstin?: string;
      /** GST state code — decides CGST+SGST vs IGST. */
      state_code?: string;
      address_line1?: string;
      city?: string;
      state?: string;
      pincode?: string;
      phone?: string;
      email?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/master/branches", { body });
    },
    /**
     * Update a branch
     *
     * Only the fields you send are changed.
     * `PATCH /api/master/branches/:id`
     * Requires `master.branch.update`.
     */
    patchMasterBranchesById(params: { id: string }, body: {
      name?: string;
      gstin?: string | null;
      state_code?: string | null;
      address_line1?: unknown;
      city?: unknown;
      phone?: string | null;
      is_active?: boolean;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/master/branches/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a branch
     *
     * Soft delete — the row stays for the audit trail and disappears from lists.
     * `DELETE /api/master/branches/:id`
     * Requires `master.branch.delete`.
     */
    deleteMasterBranchesById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/master/branches/${encodeURIComponent(params.id)}`);
    },
    /**
     * List customer or suppliers
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/master/parties`
     * Requires `master.customer.view`.
     */
    getMasterParties(query?: {
      /** Matches code, name, phone, gstin. */
      search?: string;
      is_customer?: boolean;
      is_supplier?: boolean;
      is_active?: boolean;
      city?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/master/parties", { query });
    },
    /**
     * Get one customer or supplier
     *
     * `GET /api/master/parties/:id`
     * Requires `master.customer.view`.
     */
    getMasterPartiesById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/master/parties/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a customer or supplier
     *
     * `POST /api/master/parties`
     * Requires `master.customer.create`.
     */
    postMasterParties(body: {
      code: string;
      /** Customer name is required. */
      name: string;
      is_customer?: boolean;
      is_supplier?: boolean;
      party_type?: "individual" | "business";
      phone?: string;
      email?: string;
      gstin?: string;
      pan?: string;
      state_code?: string;
      address_line1?: string;
      city?: string;
      state?: string;
      pincode?: string;
      /** Rupees, as a string. Never a float. */
      credit_limit?: string;
      credit_days?: number;
      date_of_birth?: string;
      anniversary?: string;
      notes?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/master/parties", { body });
    },
    /**
     * Update a customer or supplier
     *
     * Only the fields you send are changed.
     * `PATCH /api/master/parties/:id`
     * Requires `master.customer.update`.
     */
    patchMasterPartiesById(params: { id: string }, body: {
      name?: string;
      is_customer?: boolean;
      is_supplier?: boolean;
      phone?: string | null;
      email?: string | null;
      gstin?: string | null;
      pan?: string | null;
      state_code?: string | null;
      city?: unknown;
      credit_limit?: string | null;
      credit_days?: number | null;
      kyc_status?: "none" | "pending" | "verified" | "rejected";
      is_active?: boolean;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/master/parties/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a customer or supplier
     *
     * Soft delete — the row stays for the audit trail and disappears from lists.
     * `DELETE /api/master/parties/:id`
     * Requires `master.customer.delete`.
     */
    deleteMasterPartiesById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/master/parties/${encodeURIComponent(params.id)}`);
    },
    /**
     * List items
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/master/items`
     * Requires `master.item.view`.
     */
    getMasterItems(query?: {
      /** Matches code, name. */
      search?: string;
      nature?: "raw_metal" | "finished" | "stone" | "consumable" | "service";
      tracking?: "lot" | "piece";
      is_active?: boolean;
      category_id?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/master/items", { query });
    },
    /**
     * Get one item
     *
     * `GET /api/master/items/:id`
     * Requires `master.item.view`.
     */
    getMasterItemsById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/master/items/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a item
     *
     * `POST /api/master/items`
     * Requires `master.item.create`.
     */
    postMasterItems(body: {
      code: string;
      name: string;
      nature?: "raw_metal" | "finished" | "stone" | "consumable" | "service";
      /** piece = individually tagged and counted. lot = bulk metal, measured in grams only. */
      tracking?: "lot" | "piece";
      category_id?: string;
      metal_id?: string;
      default_purity_id?: string;
      /** 7113 for jewellery articles. */
      hsn_code?: string;
      default_making_rate?: string;
      default_wastage_percent?: string;
      uom?: "gram" | "piece" | "carat" | "millilitre";
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/master/items", { body });
    },
    /**
     * Update a item
     *
     * Only the fields you send are changed.
     * `PATCH /api/master/items/:id`
     * Requires `master.item.update`.
     */
    patchMasterItemsById(params: { id: string }, body: {
      name?: string;
      category_id?: string | null;
      default_purity_id?: string | null;
      hsn_code?: unknown;
      default_making_rate?: string | null;
      default_wastage_percent?: string | null;
      is_active?: boolean;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/master/items/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a item
     *
     * Soft delete — the row stays for the audit trail and disappears from lists.
     * `DELETE /api/master/items/:id`
     * Requires `master.item.delete`.
     */
    deleteMasterItemsById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/master/items/${encodeURIComponent(params.id)}`);
    },
    /**
     * List categorys
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/master/categories`
     * Requires `master.item.view`.
     */
    getMasterCategories(query?: {
      /** Matches code, name. */
      search?: string;
      is_active?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/master/categories", { query });
    },
    /**
     * Get one category
     *
     * `GET /api/master/categories/:id`
     * Requires `master.item.view`.
     */
    getMasterCategoriesById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/master/categories/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a category
     *
     * `POST /api/master/categories`
     * Requires `master.item.create`.
     */
    postMasterCategories(body: {
      code: string;
      name: string;
      parent_id?: string;
      hsn_code?: string;
      sort_order?: number;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/master/categories", { body });
    },
    /**
     * Update a category
     *
     * Only the fields you send are changed.
     * `PATCH /api/master/categories/:id`
     * Requires `master.item.update`.
     */
    patchMasterCategoriesById(params: { id: string }, body: {
      name?: string;
      hsn_code?: unknown;
      sort_order?: number;
      is_active?: boolean;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/master/categories/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a category
     *
     * Hard delete. Fails if anything references it.
     * `DELETE /api/master/categories/:id`
     * Requires `master.item.delete`.
     */
    deleteMasterCategoriesById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/master/categories/${encodeURIComponent(params.id)}`);
    },
    /**
     * List puritys
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/master/purities`
     * Requires `master.purity.view`.
     */
    getMasterPurities(query?: {
      /** Matches code, name. */
      search?: string;
      metal_id?: string;
      is_active?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/master/purities", { query });
    },
    /**
     * Get one purity
     *
     * `GET /api/master/purities/:id`
     * Requires `master.purity.view`.
     */
    getMasterPuritiesById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/master/purities/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a purity
     *
     * `POST /api/master/purities`
     * Requires `master.purity.create`.
     */
    postMasterPurities(body: {
      metal_id: string;
      /** e.g. 22K */
      code: string;
      name: string;
      /** 91.600 for 22K. Everything calculates from this. */
      fineness_percent: string;
      karat?: string;
      is_hallmarkable?: boolean;
      sort_order?: number;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/master/purities", { body });
    },
    /**
     * Update a purity
     *
     * Only the fields you send are changed.
     * `PATCH /api/master/purities/:id`
     * Requires `master.purity.update`.
     */
    patchMasterPuritiesById(params: { id: string }, body: {
      name?: string;
      fineness_percent?: string;
      is_hallmarkable?: boolean;
      is_active?: boolean;
      sort_order?: number;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/master/purities/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a purity
     *
     * Hard delete. Fails if anything references it.
     * `DELETE /api/master/purities/:id`
     * Requires `master.purity.delete`.
     */
    deleteMasterPuritiesById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/master/purities/${encodeURIComponent(params.id)}`);
    },
    /**
     * List metals
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/master/metals`
     * Requires `master.purity.view`.
     */
    getMasterMetals(query?: {
      /** Matches code, name. */
      search?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/master/metals", { query });
    },
    /**
     * Get one metal
     *
     * `GET /api/master/metals/:id`
     * Requires `master.purity.view`.
     */
    getMasterMetalsById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/master/metals/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a metal
     *
     * `POST /api/master/metals`
     * Requires `master.purity.create`.
     */
    postMasterMetals(body: {
      code: string;
      name: string;
      hsn_code?: string;
      sort_order?: number;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/master/metals", { body });
    },
    /**
     * Update a metal
     *
     * Only the fields you send are changed.
     * `PATCH /api/master/metals/:id`
     * Requires `master.purity.update`.
     */
    patchMasterMetalsById(params: { id: string }, body: {
      name?: string;
      is_active?: boolean;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/master/metals/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a metal
     *
     * Hard delete. Fails if anything references it.
     * `DELETE /api/master/metals/:id`
     * Requires `master.purity.delete`.
     */
    deleteMasterMetalsById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/master/metals/${encodeURIComponent(params.id)}`);
    },
    /**
     * List karigars
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/master/karigars`
     * Requires `master.karigar.view`.
     */
    getMasterKarigars(query?: {
      /** Matches code, name, workshop_name, speciality. */
      search?: string;
      engagement?: "in_house" | "external";
      is_active?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/master/karigars", { query });
    },
    /**
     * Get one karigar
     *
     * `GET /api/master/karigars/:id`
     * Requires `master.karigar.view`.
     */
    getMasterKarigarsById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/master/karigars/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a karigar
     *
     * `POST /api/master/karigars`
     * Requires `master.karigar.create`.
     */
    postMasterKarigars(body: {
      code: string;
      name: string;
      workshop_name?: string;
      engagement?: "in_house" | "external";
      /** e.g. "Bridal Sets", "Kundan Meena". */
      speciality?: string;
      phone?: string;
      address?: string;
      pan?: string;
      /** Agreed metal loss allowance, in percent. */
      standard_ghat_percent?: string;
      /** Rupees, as a string. Never a float. */
      labour_rate_per_gram?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/master/karigars", { body });
    },
    /**
     * Update a karigar
     *
     * Only the fields you send are changed.
     * `PATCH /api/master/karigars/:id`
     * Requires `master.karigar.update`.
     */
    patchMasterKarigarsById(params: { id: string }, body: {
      name?: string;
      speciality?: unknown;
      phone?: string | null;
      standard_ghat_percent?: string;
      /** Rupees, as a string. Never a float. */
      labour_rate_per_gram?: string;
      is_active?: boolean;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/master/karigars/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a karigar
     *
     * Soft delete — the row stays for the audit trail and disappears from lists.
     * `DELETE /api/master/karigars/:id`
     * Requires `master.karigar.delete`.
     */
    deleteMasterKarigarsById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/master/karigars/${encodeURIComponent(params.id)}`);
    },
    /**
     * List stock locations
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/master/locations`
     * Requires `master.branch.view`.
     */
    getMasterLocations(query?: {
      /** Matches code, name. */
      search?: string;
      branch_id?: string;
      kind?: "counter" | "vault" | "window" | "floor" | "transit" | "karigar";
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/master/locations", { query });
    },
    /**
     * Get one stock location
     *
     * `GET /api/master/locations/:id`
     * Requires `master.branch.view`.
     */
    getMasterLocationsById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/master/locations/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a stock location
     *
     * `POST /api/master/locations`
     * Requires `master.branch.create`.
     */
    postMasterLocations(body: {
      branch_id: string;
      code: string;
      name: string;
      kind?: "counter" | "vault" | "window" | "floor" | "transit" | "karigar";
      is_default?: boolean;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/master/locations", { body });
    },
    /**
     * Update a stock location
     *
     * Only the fields you send are changed.
     * `PATCH /api/master/locations/:id`
     * Requires `master.branch.update`.
     */
    patchMasterLocationsById(params: { id: string }, body: {
      name?: string;
      is_default?: boolean;
      is_active?: boolean;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/master/locations/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a stock location
     *
     * Soft delete — the row stays for the audit trail and disappears from lists.
     * `DELETE /api/master/locations/:id`
     * Requires `master.branch.delete`.
     */
    deleteMasterLocationsById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/master/locations/${encodeURIComponent(params.id)}`);
    },
    /**
     * Today’s broadcast rates
     *
     * The latest rate per metal and purity, honouring a branch-specific rate over the shared one. This is what POS prices from — a sale is refused with `rate_missing` when no rate exists.
     * `GET /api/master/rates/current`
     * Requires `master.rates.view`.
     */
    getMasterRatesCurrent(query?: {
      branchId?: string;
    }): Promise<{
      rates: Array<{
        id: string;
        metal_id: string;
        metal_code: string;
        purity_id: string | null;
        purity_code: unknown;
        /** Rupees, as a string. Never a float. */
        rate_per_gram: string;
        buying_rate_per_gram: string | null;
        effective_from: string;
      }>;
    }> {
      return request<{
      rates: Array<{
        id: string;
        metal_id: string;
        metal_code: string;
        purity_id: string | null;
        purity_code: unknown;
        /** Rupees, as a string. Never a float. */
        rate_per_gram: string;
        buying_rate_per_gram: string | null;
        effective_from: string;
      }>;
    }>('GET', "/api/master/rates/current", { query });
    },
    /**
     * Broadcast a new rate
     *
     * A new rate is a new row — rates are never edited. Yesterday’s invoices keep pointing at yesterday’s rate, so an old bill can always be explained.
     * `POST /api/master/rates`
     * Requires `master.rates.create`.
     */
    postMasterRates(body: {
      metal_id: string;
      /** Omit for a pure-metal rate. */
      purity_id?: string;
      /** Selling rate. */
      rate_per_gram: string;
      /** What you pay for old gold. Normally lower. */
      buying_rate_per_gram?: string;
      /** Omit to broadcast to every branch. */
      branch_id?: string;
      /** Defaults to now. */
      effective_from?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/master/rates", { body });
    },
    /**
     * Rate history for a purity
     *
     * `GET /api/master/rates/history`
     * Requires `master.rates.view`.
     */
    getMasterRatesHistory(query?: {
      purityId: string;
      days?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
    }>('GET', "/api/master/rates/history", { query });
    },
    /**
     * The Kanban stages for every order type
     *
     * Each order type has its own stage sequence — a repair genuinely has different steps from a wedding order. Read this rather than hardcoding stage names; a tenant can override the list.
     * `GET /api/orders/pipelines`
     * Requires `orders.view`.
     */
    getOrdersPipelines(): Promise<{
      pipelines: Array<{
        orderType: "booking" | "custom" | "repair" | "wedding" | "corporate";
        label: string;
        stages: Array<{
          key: string;
          label: string;
          terminal?: boolean;
          external?: boolean;
        }>;
      }>;
    }> {
      return request<{
      pipelines: Array<{
        orderType: "booking" | "custom" | "repair" | "wedding" | "corporate";
        label: string;
        stages: Array<{
          key: string;
          label: string;
          terminal?: boolean;
          external?: boolean;
        }>;
      }>;
    }>('GET', "/api/orders/pipelines");
    },
    /**
     * The Kanban board for one order type
     *
     * Active orders grouped into their stage columns, ready to render.
     * `GET /api/orders/board`
     * Requires `orders.view`.
     */
    getOrdersBoard(query?: {
      orderType: "booking" | "custom" | "repair" | "wedding" | "corporate";
      branchId?: string;
    }): Promise<{
      orderType: string;
      stages: Array<{
        key: string;
        label: string;
        orders: Array<Record<string, unknown>>;
      }>;
    }> {
      return request<{
      orderType: string;
      stages: Array<{
        key: string;
        label: string;
        orders: Array<Record<string, unknown>>;
      }>;
    }>('GET', "/api/orders/board", { query });
    },
    /**
     * List orders
     *
     * `GET /api/orders`
     * Requires `orders.view`.
     */
    getOrders(query?: {
      orderType?: "booking" | "custom" | "repair" | "wedding" | "corporate";
      stage?: string;
      status?: "draft" | "active" | "completed" | "cancelled";
      customerId?: string;
      karigarId?: string;
      branchId?: string;
      from?: string;
      to?: string;
      /** Matches order number or customer name. */
      search?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/orders", { query });
    },
    /**
     * One order with everything attached
     *
     * Lines, timeline, payments, attachments, acknowledgement and messages, in one call.
     * `GET /api/orders/:id`
     * Requires `orders.view`.
     */
    getOrdersById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/orders/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create an order
     *
     * One endpoint for all five types; `orderType` decides which fields are required. Corporate orders need `companyName` and `poReference`; repairs need `repairItemDescription`. Lines are priced server-side from the rate master, so the client never has to compute GST.
     * `POST /api/orders`
     * Requires `orders.create`.
     */
    postOrders(body: {
      orderType: "booking" | "custom" | "repair" | "wedding" | "corporate";
      customerId: string;
      branchId: string;
      orderDate: string;
      /** Expected delivery date is required. */
      expectedDeliveryDate: string;
      salespersonId?: string;
      karigarId?: string;
      rateLockType?: "today" | "floating" | "fixed_future";
      /** Rupees, as a string. Never a float. */
      lockedRatePerGram?: string;
      /** Cannot exceed the order value. */
      advanceAmount?: string;
      lines?: Array<{
        /** booking reserves existing stock; custom is made to order. */
        lineMode?: "booking" | "custom";
        /** Every line needs a title. */
        title: string;
        designSpecification?: string;
        itemId?: string | null;
        pieceId?: string | null;
        purityId?: string | null;
        categoryId?: string | null;
        quantity?: string;
        /** Grams, as a string. */
        grossWeight?: string;
        /** Grams, as a string. */
        stoneWeight?: string;
        /** Falls back to the order’s locked rate. */
        ratePerGram?: string;
        makingBasis?: "per_gram" | "percent" | "flat";
        makingRate?: string;
        wastagePercent?: string;
        /** Rupees, as a string. Never a float. */
        stoneAmount?: string;
        /** Rupees, as a string. Never a float. */
        discountAmount?: string;
        gstRate?: string;
        hsnCode?: string;
        specialInstructions?: string;
      }>;
      notes?: string;
      /** Custom orders. */
      requirementDescription?: string;
      sizeSpecifications?: string;
      /** Rupees, as a string. Never a float. */
      budgetMin?: string;
      /** Rupees, as a string. Never a float. */
      budgetMax?: string;
      manufacturingRoute?: "in_house" | "external";
      externalManufacturerId?: string;
      /** Required for repair orders. */
      repairItemDescription?: string;
      repairIssueDescription?: string;
      /** e.g. ["clasp","stone_loose"] */
      repairIssueTypes?: Array<string>;
      underWarranty?: boolean;
      originalInvoiceNumber?: string;
      /** Wedding orders. */
      eventDate?: string;
      eventType?: string;
      /** Required for corporate orders. */
      companyName?: string;
      companyGstin?: string;
      /** Required for corporate orders. */
      poReference?: string;
      creditTerms?: "net_15" | "net_30" | "custom";
      creditTermsNote?: string;
      brandingNotes?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/orders", { body });
    },
    /**
     * Move an order to another stage
     *
     * Moving backward is allowed but requires `reason` — it is written to the timeline and the audit stream. Reaching a terminal stage completes the order.
     * `POST /api/orders/:id/stage`
     * Requires `orders.update`.
     */
    postOrdersByIdStage(params: { id: string }, body: {
      /** Must exist in this order type’s pipeline. */
      stage: string;
      /** Required when moving backward. */
      reason?: string;
      note?: string;
    }): Promise<{
      order: Record<string, unknown>;
      moved: boolean;
      direction?: string;
    }> {
      return request<{
      order: Record<string, unknown>;
      moved: boolean;
      direction?: string;
    }>('POST', `/api/orders/${encodeURIComponent(params.id)}/stage`, { body });
    },
    /**
     * Cancel an order
     *
     * The order stays in the audit trail and leaves the active pipeline.
     * `POST /api/orders/:id/cancel`
     * Requires `orders.cancel`.
     */
    postOrdersByIdCancel(params: { id: string }, body: {
      reason: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/orders/${encodeURIComponent(params.id)}/cancel`, { body });
    },
    /**
     * Record an advance or token payment
     *
     * `POST /api/orders/:id/payments`
     * Requires `orders.update`.
     */
    postOrdersByIdPayments(params: { id: string }, body: {
      mode: "cash" | "card" | "upi" | "bank_transfer" | "cheque" | "emi" | "old_gold" | "scheme";
      /** Rupees, as a string. Never a float. */
      amount: string;
      reference?: string;
      notes?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/orders/${encodeURIComponent(params.id)}/payments`, { body });
    },
    /**
     * Capture the customer acknowledgement on a repair intake
     *
     * Required before a repair leaves the counter. Either a captured signature or a verified OTP reference — never the OTP code itself.
     * `POST /api/orders/:id/acknowledge`
     * Requires `orders.update`.
     */
    postOrdersByIdAcknowledge(params: { id: string }, body: {
      method: "signature" | "otp";
      /** Required when method is signature. */
      signatureStorageKey?: string;
      /** The provider’s reference, required when method is otp. */
      otpReference?: string;
      acknowledgedByName?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/orders/${encodeURIComponent(params.id)}/acknowledge`, { body });
    },
    /**
     * Create a sales invoice (draft)
     *
     * Prices every line server-side from the rate master and the tenant’s making/wastage config, then applies GST — CGST+SGST within the state, IGST across it, zero-rated for export. Creates a draft; nothing moves until you post it.
     * `POST /api/pos/invoices`
     * Requires `pos.create`.
     */
    postPosInvoices(body: {
      customerId: string;
      branchId: string;
      docDate: string;
      channel?: "counter" | "wholesale" | "export" | "online";
      salespersonId?: string;
      /** Rupees, as a string. Never a float. */
      otherCharges?: string;
      notes?: string;
      lines: Array<{
        itemId: string;
        purityId?: string | null;
        /** Set when selling a specific tagged piece. */
        pieceId?: string | null;
        locationId?: string | null;
        description?: string;
        quantity?: string;
        /** Grams, as a string. */
        grossWeight: string;
        /** Grams, as a string. */
        stoneWeight?: string;
        /** Omit to use today’s broadcast rate. */
        ratePerGram?: string;
        makingBasis?: "per_gram" | "percent" | "flat";
        makingRate?: string;
        wastagePercent?: string;
        /** Rupees, as a string. Never a float. */
        stoneAmount?: string;
        /** Rupees, as a string. Never a float. */
        discountAmount?: string;
        /** Rupees, as a string. Never a float. */
        hallmarkCharge?: string;
        gstRate?: string;
        notes?: string;
      }>;
      /** A sale is routinely settled by several tenders at once. */
      payments?: Array<{
        mode: "cash" | "card" | "upi" | "bank_transfer" | "cheque" | "credit" | "old_gold" | "scheme" | "advance";
        /** Rupees, as a string. Never a float. */
        amount: string;
        reference?: string;
        accountId?: string;
        notes?: string;
      }>;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/pos/invoices", { body });
    },
    /**
     * Post an invoice — stock out, books updated
     *
     * The moment everything happens, in one transaction: stock leaves at cost, revenue and GST are recognised, the customer is debited for any balance, and the piece is marked sold. After this the invoice is read-only.
     * `POST /api/pos/invoices/:id/post`
     * Requires `pos.post`.
     */
    postPosInvoicesByIdPost(params: { id: string }): Promise<{
      invoice: Record<string, unknown>;
      voucherId: string;
      voucherNumber: string;
      /** Rupees, as a string. Never a float. */
      costOfGoodsSold: string;
    }> {
      return request<{
      invoice: Record<string, unknown>;
      voucherId: string;
      voucherNumber: string;
      /** Rupees, as a string. Never a float. */
      costOfGoodsSold: string;
    }>('POST', `/api/pos/invoices/${encodeURIComponent(params.id)}/post`);
    },
    /**
     * Cancel an invoice
     *
     * A posted invoice is reversed, never edited — stock comes back and mirrored ledger entries are written, leaving both the original and the correction visible.
     * `POST /api/pos/invoices/:id/cancel`
     * Requires `pos.cancel`.
     */
    postPosInvoicesByIdCancel(params: { id: string }, body: {
      reason: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/pos/invoices/${encodeURIComponent(params.id)}/cancel`, { body });
    },
    /**
     * List sales invoices
     *
     * `GET /api/pos/invoices`
     * Requires `pos.view`.
     */
    getPosInvoices(query?: {
      status?: "draft" | "confirmed" | "posted" | "cancelled";
      customerId?: string;
      branchId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/pos/invoices", { query });
    },
    /**
     * One invoice with lines and payments
     *
     * `GET /api/pos/invoices/:id`
     * Requires `pos.view`.
     */
    getPosInvoicesById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/pos/invoices/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a purchase invoice (draft)
     *
     * The buying side. Posting raises stock and credits the supplier.
     * `POST /api/pos/purchases`
     * Requires `pos.purchase.create`.
     */
    postPosPurchases(body: {
      supplierId: string;
      branchId: string;
      docDate: string;
      /** Their number, needed for GST matching. */
      supplierInvoiceNumber?: string;
      supplierInvoiceDate?: string;
      dueDate?: string;
      raisesStock?: boolean;
      /** Rupees, as a string. Never a float. */
      otherCharges?: string;
      notes?: string;
      lines: Array<{
        itemId: string;
        purityId?: string | null;
        locationId?: string | null;
        description?: string;
        quantity?: string;
        /** Grams, as a string. */
        grossWeight: string;
        /** Grams, as a string. */
        stoneWeight?: string;
        /** Rupees, as a string. Never a float. */
        ratePerGram: string;
        makingBasis?: "per_gram" | "percent" | "flat";
        makingRate?: string;
        wastagePercent?: string;
        /** Rupees, as a string. Never a float. */
        stoneAmount?: string;
        /** Rupees, as a string. Never a float. */
        discountAmount?: string;
        gstRate?: string;
        notes?: string;
      }>;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/pos/purchases", { body });
    },
    /**
     * Post a purchase — stock in, supplier credited
     *
     * `POST /api/pos/purchases/:id/post`
     * Requires `pos.purchase.post`.
     */
    postPosPurchasesByIdPost(params: { id: string }): Promise<{
      invoice: Record<string, unknown>;
      voucherId: string;
      voucherNumber: string;
    }> {
      return request<{
      invoice: Record<string, unknown>;
      voucherId: string;
      voucherNumber: string;
    }>('POST', `/api/pos/purchases/${encodeURIComponent(params.id)}/post`);
    },
    /**
     * Cancel a purchase invoice
     *
     * `POST /api/pos/purchases/:id/cancel`
     * Requires `pos.purchase.cancel`.
     */
    postPosPurchasesByIdCancel(params: { id: string }, body: {
      reason: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/pos/purchases/${encodeURIComponent(params.id)}/cancel`, { body });
    },
    /**
     * Current stock by item, purity and location
     *
     * Lot-tracked items carry weight only; piece-tracked items carry a count as well.
     * `GET /api/stock/balances`
     * Requires `stock.view`.
     */
    getStockBalances(query?: {
      branchId?: string;
      locationId?: string;
      itemId?: string;
      nonZeroOnly?: boolean;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
    }>('GET', "/api/stock/balances", { query });
    },
    /**
     * Tagged pieces (HUID stock)
     *
     * Search by tag number or HUID — this is what the command palette queries.
     * `GET /api/stock/pieces`
     * Requires `stock.view`.
     */
    getStockPieces(query?: {
      /** Matches tag number or HUID. */
      search?: string;
      status?: "in_stock" | "on_memo" | "sold" | "in_transit" | "with_karigar" | "in_repair" | "melted" | "written_off";
      locationId?: string;
      branchId?: string;
      itemId?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/stock/pieces", { query });
    },
    /**
     * The stock journal
     *
     * Append-only. This is how you answer “where did those 4 grams go”.
     * `GET /api/stock/movements`
     * Requires `stock.view`.
     */
    getStockMovements(query?: {
      itemId?: string;
      locationId?: string;
      pieceId?: string;
      sourceType?: string;
      sourceId?: string;
      from?: string;
      to?: string;
      limit?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
    }>('GET', "/api/stock/movements", { query });
    },
    /**
     * Rebuild balances from the journal
     *
     * Recomputes every balance from stock_movement. Nothing should need this, which is why it exists.
     * `POST /api/stock/balances/rebuild`
     * Requires `stock.verification.approve`.
     */
    postStockBalancesRebuild(): Promise<{
      ok: boolean;
      rebuilt: number;
    }> {
      return request<{
      ok: boolean;
      rebuilt: number;
    }>('POST', "/api/stock/balances/rebuild");
    },
    /**
     * Tag a new piece and assign its HUID
     *
     * Creates the physical piece record, allocates a tag number from the tag series, and records the BIS HUID. Net metal weight is gross minus stones.
     * `POST /api/tagging/pieces`
     * Requires `tagging.create`.
     */
    postTaggingPieces(body: {
      itemId: string;
      purityId: string;
      locationId: string;
      /** Total weight as measured. */
      grossWeight: string;
      /** Deducted to get net metal weight. */
      stoneWeight?: string;
      /** Grams, as a string. */
      otherWeight?: string;
      stoneCount?: number;
      /** Rupees, as a string. Never a float. */
      stoneValue?: string;
      huid?: string;
      hallmarkCentre?: string;
      /** Rupees, as a string. Never a float. */
      costValue?: string;
      /** Rupees, as a string. Never a float. */
      makingCost?: string;
      supplierId?: string;
      /** Omit to allocate from the tag series. */
      tagNumber?: string;
      /** Where the piece came from. `purchase` writes no stock movement, because the purchase invoice already raised it — anything else raises stock. */
      origin?: "opening" | "purchase" | "production_receipt" | "sales_return";
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/tagging/pieces", { body });
    },
    /**
     * The thermal printer queue
     *
     * `GET /api/tagging/queue`
     * Requires `tagging.view`.
     */
    getTaggingQueue(query?: {
      status?: "queued" | "printing" | "printed" | "failed" | "cancelled";
      branchId?: string;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
    }>('GET', "/api/tagging/queue", { query });
    },
    /**
     * Queue pieces for printing
     *
     * `POST /api/tagging/queue`
     * Requires `tagging.create`.
     */
    postTaggingQueue(body: {
      templateId: string;
      branchId: string;
      pieceIds: Array<string>;
      copies?: number;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/tagging/queue", { body });
    },
    /**
     * Create an old-gold appraisal voucher
     *
     * Records what the customer brought in, item by item, with XRF readings and the deductions that turn gross weight into actual metal. Fine weight and value are computed server-side from the buying rate.
     * `POST /api/oldgold/intakes`
     * Requires `oldgold.create`.
     */
    postOldgoldIntakes(body: {
      customerId: string;
      branchId: string;
      voucherDate: string;
      /** Can be decided later, at settlement. */
      settlementType?: "exchange" | "buyback";
      /** The buying rate applied to this voucher. */
      ratePerGram: string;
      /** Handling or refining charge withheld. */
      deductionAmount?: string;
      notes?: string;
      items: Array<{
        description: string;
        metalId: string;
        itemCategoryId?: string | null;
        /** Grams, as a string. */
        grossWeight: string;
        /** Grams, as a string. */
        stoneWeight?: string;
        /** Grams, as a string. */
        dirtWeight?: string;
        /** Grams, as a string. */
        solderWeight?: string;
        testMethod?: "xrf" | "touchstone" | "fire_assay" | "declared" | "visual";
        /** What the machine read, as a percentage. */
        testedPurityPercent: string;
        /** What the customer said it was. */
        declaredPurityPercent?: string;
        testInstrument?: string;
        photoStorageKey?: string;
        notes?: string;
      }>;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/oldgold/intakes", { body });
    },
    /**
     * List appraisal vouchers
     *
     * `GET /api/oldgold/intakes`
     * Requires `oldgold.view`.
     */
    getOldgoldIntakes(query?: {
      status?: "draft" | "tested" | "approved" | "settled" | "returned" | "cancelled";
      settlementType?: "exchange" | "buyback";
      customerId?: string;
      branchId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/oldgold/intakes", { query });
    },
    /**
     * Settle a voucher — exchange credit or cash buyback
     *
     * The branch point. `exchange` links the credit to an invoice or order; `buyback` records a cash payout. Same intake, opposite accounting.
     * `POST /api/oldgold/intakes/:id/settle`
     * Requires `oldgold.update`.
     */
    postOldgoldIntakesByIdSettle(params: { id: string }, body: {
      settlementType: "exchange" | "buyback";
      /** For exchange. */
      appliedToInvoiceId?: string;
      /** For exchange. */
      appliedToOrderId?: string;
      /** For buyback. */
      payoutMode?: "cash" | "bank_transfer" | "upi" | "cheque";
      payoutReference?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/oldgold/intakes/${encodeURIComponent(params.id)}/settle`, { body });
    },
    /**
     * List melt batchs
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/oldgold/melt-batches`
     * Requires `oldgold.melt.view`.
     */
    getOldgoldMeltbatches(query?: {
      /** Matches batch_number. */
      search?: string;
      status?: "open" | "sent" | "melted" | "received" | "closed";
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/oldgold/melt-batches", { query });
    },
    /**
     * Get one melt batch
     *
     * `GET /api/oldgold/melt-batches/:id`
     * Requires `oldgold.melt.view`.
     */
    getOldgoldMeltbatchesById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/oldgold/melt-batches/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a melt batch
     *
     * `POST /api/oldgold/melt-batches`
     * Requires `oldgold.melt.create`.
     */
    postOldgoldMeltbatches(body: {
      batch_number: string;
      batch_date: string;
      branch_id: string;
      metal_id: string;
      refiner_id?: string;
      notes?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/oldgold/melt-batches", { body });
    },
    /**
     * Update a melt batch
     *
     * Only the fields you send are changed.
     * `PATCH /api/oldgold/melt-batches/:id`
     * Requires `oldgold.melt.update`.
     */
    patchOldgoldMeltbatchesById(params: { id: string }, body: {
      status?: "open" | "sent" | "melted" | "received" | "closed";
      /** Grams, as a string. */
      output_weight?: string;
      output_purity_percent?: string;
      /** Rupees, as a string. Never a float. */
      refining_charge?: string;
      assay_certificate_number?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/oldgold/melt-batches/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a melt batch
     *
     * Hard delete. Fails if anything references it.
     * `DELETE /api/oldgold/melt-batches/:id`
     * Requires `oldgold.melt.delete`.
     */
    deleteOldgoldMeltbatchesById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/oldgold/melt-batches/${encodeURIComponent(params.id)}`);
    },
    /**
     * List scheme plans
     *
     * Paginated. `total` is the count before paging, for the pager.
     * `GET /api/schemes/plans`
     * Requires `schemes.plans.view`.
     */
    getSchemesPlans(query?: {
      /** Matches code, name. */
      search?: string;
      is_active?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/schemes/plans", { query });
    },
    /**
     * Get one scheme plan
     *
     * `GET /api/schemes/plans/:id`
     * Requires `schemes.plans.view`.
     */
    getSchemesPlansById(params: { id: string }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', `/api/schemes/plans/${encodeURIComponent(params.id)}`);
    },
    /**
     * Create a scheme plan
     *
     * `POST /api/schemes/plans`
     * Requires `schemes.plans.create`.
     */
    postSchemesPlans(body: {
      code: string;
      name: string;
      description?: string;
      metal_id: string;
      /** weight accrues grams at each payment’s rate — the customer is owed metal, not money. */
      accrual_basis?: "rupee" | "weight";
      tenure_months: number;
      /** Rupees, as a string. Never a float. */
      installment_amount?: string;
      is_flexible_amount?: boolean;
      /** The classic "pay 11, get 12" is 1. */
      bonus_installments?: string;
      bonus_percent?: string;
      max_missed_installments?: number;
      making_charge_discount_percent?: string;
      allow_partial_redemption?: boolean;
      allow_cash_redemption?: boolean;
      grace_period_days?: number;
      terms_and_conditions?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/schemes/plans", { body });
    },
    /**
     * Update a scheme plan
     *
     * Only the fields you send are changed.
     * `PATCH /api/schemes/plans/:id`
     * Requires `schemes.plans.update`.
     */
    patchSchemesPlansById(params: { id: string }, body: {
      name?: string;
      is_active?: boolean;
      bonus_installments?: string;
      terms_and_conditions?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/schemes/plans/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Remove a scheme plan
     *
     * Soft delete — the row stays for the audit trail and disappears from lists.
     * `DELETE /api/schemes/plans/:id`
     * Requires `schemes.plans.delete`.
     */
    deleteSchemesPlansById(params: { id: string }): Promise<void> {
      return request<void>('DELETE', `/api/schemes/plans/${encodeURIComponent(params.id)}`);
    },
    /**
     * Enroll a customer and generate the installment schedule
     *
     * Creates the account and writes every installment row up front, so “what is due this month” is a simple query rather than a calculation.
     * `POST /api/schemes/accounts`
     * Requires `schemes.accounts.create`.
     */
    postSchemesAccounts(body: {
      schemePlanId: string;
      customerId: string;
      branchId: string;
      enrolledOn: string;
      /** Rupees, as a string. Never a float. */
      installmentAmount: string;
      dueDay?: number;
      nomineeName?: string;
      nomineeRelationship?: string;
      nomineePhone?: string;
    }): Promise<{
      account: Record<string, unknown>;
      installments: number;
    }> {
      return request<{
      account: Record<string, unknown>;
      installments: number;
    }>('POST', "/api/schemes/accounts", { body });
    },
    /**
     * Collect an installment
     *
     * Records the payment and, for weight-basis plans, the grams it bought at today’s rate — which is what the customer is actually owed.
     * `POST /api/schemes/installments/:id/collect`
     * Requires `schemes.collection.create`.
     */
    postSchemesInstallmentsByIdCollect(params: { id: string }, body: {
      /** Rupees, as a string. Never a float. */
      amountPaid: string;
      paidOn: string;
      paymentMode: "cash" | "card" | "upi" | "bank_transfer" | "cheque" | "auto_debit";
      paymentReference?: string;
      /** Rupees, as a string. Never a float. */
      ratePerGram?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/schemes/installments/${encodeURIComponent(params.id)}/collect`, { body });
    },
    /**
     * List scheme accounts
     *
     * `GET /api/schemes/accounts`
     * Requires `schemes.accounts.view`.
     */
    getSchemesAccounts(query?: {
      status?: "active" | "matured" | "redeemed" | "defaulted" | "cancelled" | "closed";
      customerId?: string;
      branchId?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/schemes/accounts", { query });
    },
    /**
     * Installments due or missed
     *
     * Drives the "Scheme collections due today" dashboard alert and the reminder run.
     * `GET /api/schemes/due`
     * Requires `schemes.collection.view`.
     */
    getSchemesDue(query?: {
      onDate?: string;
      includeMissed?: boolean;
      branchId?: string;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      /** Rupees, as a string. Never a float. */
      totalDue: string;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      /** Rupees, as a string. Never a float. */
      totalDue: string;
    }>('GET', "/api/schemes/due", { query });
    },
    /**
     * Sanction a Girvi loan
     *
     * Appraises the collateral, caps the principal at the configured LTV (75% by default), and records the vault packet the items are sealed into.
     * `POST /api/girvi/loans`
     * Requires `girvi.create`.
     */
    postGirviLoans(body: {
      branchId: string;
      /** Omit for a walk-in; the borrower fields are then required. */
      customerId?: string;
      borrowerName: string;
      borrowerPhone: string;
      borrowerAddress?: string;
      borrowerIdType?: "aadhaar" | "pan" | "voter" | "driving_licence" | "passport";
      borrowerIdNumber?: string;
      sanctionedOn: string;
      dueDate: string;
      /** Regulatory cap is 75%. */
      ltvPercent?: string;
      /** Rupees, as a string. Never a float. */
      principalAmount: string;
      interestRateMonthly: string;
      /** Rupees, as a string. Never a float. */
      processingFee?: string;
      disbursalMode?: "cash" | "bank_transfer" | "upi" | "cheque";
      vaultPacketNumber?: string;
      vaultLocationId?: string;
      collateral: Array<{
        description: string;
        metalId: string;
        purityId?: string | null;
        quantity?: number;
        /** Grams, as a string. */
        grossWeight: string;
        /** Grams, as a string. */
        stoneWeight?: string;
        testedPurityPercent: string;
        testMethod?: "xrf" | "touchstone" | "declared";
        /** Buying rate used for appraisal. */
        ratePerGram: string;
        conditionNotes?: string;
        photoStorageKey?: string;
      }>;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', "/api/girvi/loans", { body });
    },
    /**
     * List Girvi loans
     *
     * `GET /api/girvi/loans`
     * Requires `girvi.view`.
     */
    getGirviLoans(query?: {
      status?: "draft" | "sanctioned" | "active" | "overdue" | "redeemed" | "defaulted" | "auctioned" | "cancelled";
      branchId?: string;
      /** Matches loan number, borrower or vault packet. */
      search?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/girvi/loans", { query });
    },
    /**
     * Record a repayment
     *
     * Interest is cleared before principal. The balance after the payment is stored so a receipt reprints exactly.
     * `POST /api/girvi/loans/:id/repayments`
     * Requires `girvi.update`.
     */
    postGirviLoansByIdRepayments(params: { id: string }, body: {
      /** Rupees, as a string. Never a float. */
      amount: string;
      paidOn: string;
      mode?: "cash" | "card" | "upi" | "bank_transfer" | "cheque";
      reference?: string;
      /** Rupees, as a string. Never a float. */
      penaltyComponent?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/girvi/loans/${encodeURIComponent(params.id)}/repayments`, { body });
    },
    /**
     * The precious metal ledger, in fine grams
     *
     * The gram side of the dual ledger. Weights are fine (pure) so purities are comparable.
     * `GET /api/accounts/metal-ledger`
     * Requires `accounts.metal.view`.
     */
    getAccountsMetalledger(query?: {
      accountId?: string;
      partyId?: string;
      metalId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      /** Grams, as a string. */
      balance: string;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      /** Grams, as a string. */
      balance: string;
    }>('GET', "/api/accounts/metal-ledger", { query });
    },
    /**
     * Trial balance
     *
     * Debits and credits per account. If these do not match, something is badly wrong — they always should.
     * `GET /api/accounts/trial-balance`
     * Requires `accounts.cash.view`.
     */
    getAccountsTrialbalance(query?: {
      from?: string;
      to?: string;
      branchId?: string;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      /** Rupees, as a string. Never a float. */
      totalDebit: string;
      /** Rupees, as a string. Never a float. */
      totalCredit: string;
      balanced: boolean;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      /** Rupees, as a string. Never a float. */
      totalDebit: string;
      /** Rupees, as a string. Never a float. */
      totalCredit: string;
      balanced: boolean;
    }>('GET', "/api/accounts/trial-balance", { query });
    },
    /**
     * Karigar metal and ghat ledger
     *
     * Metal issued to each goldsmith, what came back, and the ghat (loss). Loss above the agreed allowance is recoverable and is what this screen exists to surface.
     * `GET /api/accounts/karigar-ledger`
     * Requires `accounts.ghat.view`.
     */
    getAccountsKarigarledger(query?: {
      karigarId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      /** Grams, as a string. */
      metalBalance: string;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      /** Grams, as a string. */
      metalBalance: string;
    }>('GET', "/api/accounts/karigar-ledger", { query });
    },
    /**
     * The four roles and what each can do
     *
     * Reference only. Roles are fixed in code and assigned by the super admin — there is no endpoint here to assign one.
     * `GET /api/settings/roles`
     * Requires `settings.users.view`.
     */
    getSettingsRoles(): Promise<{
      roles: Array<Record<string, unknown>>;
      /** Always empty — tenants do not assign roles. */
      assignable: Array<string>;
    }> {
      return request<{
      roles: Array<Record<string, unknown>>;
      /** Always empty — tenants do not assign roles. */
      assignable: Array<string>;
    }>('GET', "/api/settings/roles");
    },
    /**
     * Who works in this business
     *
     * Read-only. Ask the super admin to add or change anyone.
     * `GET /api/settings/users`
     * Requires `settings.users.view`.
     */
    getSettingsUsers(query?: {
      search?: string;
      role?: "admin" | "sales" | "accountant" | "storekeeper";
      isActive?: boolean;
      branchId?: string;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
    }>('GET', "/api/settings/users", { query });
    },
    /**
     * Super admin sign-in
     *
     * No tenant code — platform operators do not belong to a tenant. The token returned is a *platform* token and is rejected by every tenant route, and vice versa.
     * `POST /api/platform/auth/login`
     */
    postPlatformAuthLogin(body: {
      email: string;
      password: string;
    }): Promise<{
      accessToken: string;
      refreshToken: string;
      user: {
        id: string;
        email: string;
        fullName: string;
        role: string;
        roleName: string;
      };
      permissions: Array<string>;
    }> {
      return request<{
      accessToken: string;
      refreshToken: string;
      user: {
        id: string;
        email: string;
        fullName: string;
        role: string;
        roleName: string;
      };
      permissions: Array<string>;
    }>('POST', "/api/platform/auth/login", { body });
    },
    /**
     * Refresh a platform session
     *
     * `POST /api/platform/auth/refresh`
     */
    postPlatformAuthRefresh(body: {
      refreshToken: string;
    }): Promise<{
      accessToken: string;
    }> {
      return request<{
      accessToken: string;
    }>('POST', "/api/platform/auth/refresh", { body });
    },
    /**
     * Revoke a platform refresh token
     *
     * `POST /api/platform/auth/logout`
     */
    postPlatformAuthLogout(body: {
      refreshToken: string;
    }): Promise<void> {
      return request<void>('POST', "/api/platform/auth/logout", { body });
    },
    /**
     * The fixed role set
     *
     * Four roles, fixed in code. Only you assign them — nobody inside a jewellery business can create or change a user. `isBranchAdmin` marks the role that is limited to one holder per branch.
     * `GET /api/platform/roles`
     */
    getPlatformRoles(): Promise<{
      platform: {
        code: string;
        name: string;
        description: string;
      };
      tenant: Array<{
        code: string;
        name: string;
        description: string;
        isBranchAdmin: boolean;
        permissions: Array<string>;
      }>;
    }> {
      return request<{
      platform: {
        code: string;
        name: string;
        description: string;
      };
      tenant: Array<{
        code: string;
        name: string;
        description: string;
        isBranchAdmin: boolean;
        permissions: Array<string>;
      }>;
    }>('GET', "/api/platform/roles");
    },
    /**
     * The module catalog, for provisioning
     *
     * `GET /api/platform/modules`
     * Requires `platform.tenants.view`.
     */
    getPlatformModules(): Promise<{
      modules: Array<Record<string, unknown>>;
    }> {
      return request<{
      modules: Array<Record<string, unknown>>;
    }>('GET', "/api/platform/modules");
    },
    /**
     * List every tenant
     *
     * `GET /api/platform/tenants`
     * Requires `platform.tenants.view`.
     */
    getPlatformTenants(query?: {
      status?: "trial" | "active" | "suspended" | "closed";
      kind?: "manufacturer" | "retailer" | "both";
      /** Matches code or name. */
      search?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    }>('GET', "/api/platform/tenants", { query });
    },
    /**
     * Create a tenant with its Admin and first branch
     *
     * One call sets up everything a business needs to start: the tenant, its chart of accounts, purities, numbering series, the five roles, the head user (Admin) and the first branch with its stock locations. A half-created tenant is worse than none, so this does the lot.
     * `POST /api/platform/tenants`
     * Requires `platform.tenants.create`.
     */
    postPlatformTenants(body: {
      /** Used at sign-in and in URLs. Cannot be changed later. */
      code: string;
      legalName: string;
      displayName?: string;
      /** Decides which modules the tenant can see at all. */
      kind?: "manufacturer" | "retailer" | "both";
      gstin?: string;
      pan?: string;
      /** GST state code — decides CGST+SGST vs IGST. */
      stateCode?: string;
      /** The head user. Gets the Admin role and can then create all other staff. */
      admin: {
        email: string;
        fullName: string;
        /** At least 8 characters. */
        password: string;
        phone?: string;
      };
      /** Omit to get a default "MAIN" branch. */
      branch?: {
        code: string;
        name: string;
        kind?: "showroom" | "factory" | "warehouse" | "office";
        city?: string;
        state?: string;
        stateCode?: string;
      };
      /** Omit to use each module’s default licence. */
      modules?: Array<{
        key: string;
        licence: "included" | "purchased" | "trial";
        trialDays?: number;
      }>;
    }): Promise<{
      tenantId: string;
      branchId: string;
      adminUserId: string;
    }> {
      return request<{
      tenantId: string;
      branchId: string;
      adminUserId: string;
    }>('POST', "/api/platform/tenants", { body });
    },
    /**
     * One tenant with its branches, users and module licences
     *
     * `GET /api/platform/tenants/:id`
     * Requires `platform.tenants.view`.
     */
    getPlatformTenantsById(params: { id: string }): Promise<{
      tenant: Record<string, unknown>;
      branches: Array<Record<string, unknown>>;
      users: Array<Record<string, unknown>>;
      modules: Array<Record<string, unknown>>;
    }> {
      return request<{
      tenant: Record<string, unknown>;
      branches: Array<Record<string, unknown>>;
      users: Array<Record<string, unknown>>;
      modules: Array<Record<string, unknown>>;
    }>('GET', `/api/platform/tenants/${encodeURIComponent(params.id)}`);
    },
    /**
     * Update a tenant
     *
     * Setting `status` to `suspended` blocks every user of that tenant from signing in.
     * `PATCH /api/platform/tenants/:id`
     * Requires `platform.tenants.update`.
     */
    patchPlatformTenantsById(params: { id: string }, body: {
      displayName?: string;
      legalName?: string;
      status?: "trial" | "active" | "suspended" | "closed";
      kind?: "manufacturer" | "retailer" | "both";
      gstin?: string;
      pan?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/platform/tenants/${encodeURIComponent(params.id)}`, { body });
    },
    /**
     * Add a branch to a tenant
     *
     * Creates the branch together with its stock locations and its own document numbering series — without those the first invoice at that branch would fail.
     * `POST /api/platform/tenants/:id/branches`
     * Requires `platform.tenants.update`.
     */
    postPlatformTenantsByIdBranches(params: { id: string }, body: {
      code: string;
      name: string;
      kind?: "showroom" | "factory" | "warehouse" | "office";
      gstin?: string;
      stateCode?: string;
      city?: string;
      state?: string;
      address_line1?: string;
      pincode?: string;
      phone?: string;
      email?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/platform/tenants/${encodeURIComponent(params.id)}/branches`, { body });
    },
    /**
     * Create a user inside a tenant
     *
     * Only you can do this — nobody inside the business can create users. Give `branchId` to place the person at one branch; leave it out and they cover all branches. A branch has exactly one admin, so creating a second one for the same branch is refused with `409` naming whoever already holds the slot.
     * `POST /api/platform/tenants/:id/users`
     * Requires `platform.tenants.update`.
     */
    postPlatformTenantsByIdUsers(params: { id: string }, body: {
      email: string;
      fullName: string;
      password: string;
      role: "admin" | "sales" | "accountant" | "storekeeper";
      phone?: string;
      /** Their branch. Omit to cover all branches. */
      branchId?: string;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('POST', `/api/platform/tenants/${encodeURIComponent(params.id)}/users`, { body });
    },
    /**
     * Change a user’s role, branch or activation
     *
     * Moving someone to `admin`, or moving an existing admin to another branch, is refused if that branch already has one. The only admin in a business cannot be deactivated — the shop would be left with nobody able to run it.
     * `PATCH /api/platform/tenants/:id/users/:userId`
     * Requires `platform.tenants.update`.
     */
    patchPlatformTenantsByIdUsersByUserId(params: { id: string; userId: string }, body: {
      role?: "admin" | "sales" | "accountant" | "storekeeper";
      /** Null moves them to all branches. */
      branchId?: string | null;
      isActive?: boolean;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PATCH', `/api/platform/tenants/${encodeURIComponent(params.id)}/users/${encodeURIComponent(params.userId)}`, { body });
    },
    /**
     * The signed-in super admin
     *
     * There is exactly one super admin and it is seeded from the command line — there is no endpoint to create another.
     * `GET /api/platform/me`
     */
    getPlatformMe(): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('GET', "/api/platform/me");
    },
    /**
     * Platform audit log
     *
     * Every super-admin action, newest first.
     * `GET /api/platform/audit`
     * Requires `platform.tenants.view`.
     */
    getPlatformAudit(query?: {
      tenantId?: string;
      action?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      rows: Array<Record<string, unknown>>;
    }> {
      return request<{
      rows: Array<Record<string, unknown>>;
    }>('GET', "/api/platform/audit", { query });
    },
    /**
     * Platform-wide counts for the super admin dashboard
     *
     * `GET /api/platform/stats`
     * Requires `platform.tenants.view`.
     */
    getPlatformStats(): Promise<{
      tenants: {
        total: number;
        active: number;
        trial: number;
        suspended: number;
      };
      users: number;
      branches: number;
      operators: number;
    }> {
      return request<{
      tenants: {
        total: number;
        active: number;
        trial: number;
        suspended: number;
      };
      users: number;
      branches: number;
      operators: number;
    }>('GET', "/api/platform/stats");
    },
    /**
     * Change a tenant’s module entitlement
     *
     * Grant, revoke, or move a module between included / purchased / trial. A module whose trial or term has lapsed still appears in the tenant’s dock, but locked — so they can see what they are missing rather than having it silently vanish.
     * `PUT /api/platform/tenants/:id/modules/:moduleKey`
     * Requires `platform.entitlement.update`.
     */
    putPlatformTenantsByIdModulesByModuleKey(params: { id: string; moduleKey: string }, body: {
      enabled?: boolean;
      licence?: "included" | "purchased" | "trial" | "expired";
      trialEndsAt?: string | null;
      expiresAt?: string | null;
      /** Sub-module keys to hide, e.g. ["orders.repair"]. */
      disabledSubmodules?: Array<string>;
    }): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>('PUT', `/api/platform/tenants/${encodeURIComponent(params.id)}/modules/${encodeURIComponent(params.moduleKey)}`, { body });
    },
    /**
     * Start a support impersonation session
     *
     * Time-boxed access into one tenant. Read-only unless `canWrite` is set, and every action during the window is written to the platform audit log — so “who looked at my data” is always answerable with exactly what and when.
     * `POST /api/platform/support-sessions`
     * Requires `platform.support.create`.
     */
    postPlatformSupportsessions(body: {
      tenantId: string;
      reason: string;
      durationMinutes?: number;
      /** Write access is a deliberate escalation. */
      canWrite?: boolean;
    }): Promise<{
      session: Record<string, unknown>;
      endsAt: string;
    }> {
      return request<{
      session: Record<string, unknown>;
      endsAt: string;
    }>('POST', "/api/platform/support-sessions", { body });
    },
    /**
     * Feature flags in effect
     *
     * Rows with a null tenant are global defaults; a tenant row overrides the default for that tenant.
     * `GET /api/platform/feature-flags`
     * Requires `platform.flags.view`.
     */
    getPlatformFeatureflags(): Promise<{
      flags: Array<Record<string, unknown>>;
    }> {
      return request<{
      flags: Array<Record<string, unknown>>;
    }>('GET', "/api/platform/feature-flags");
    },
  };
}

export type RatnaGridClient = ReturnType<typeof createClient>;
