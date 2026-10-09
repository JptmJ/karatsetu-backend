import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import '../src/bootstrap.js';
import { createApp } from '../src/app.js';
import { asPlatform } from '../src/core/db/client.js';
import { hashPassword } from '../src/modules/identity/auth.service.js';
import { newId } from '../src/core/util/id.js';
import { SUPER_ADMIN } from '../src/modules/platform/roles.js';

/**
 * Switching a module off for a tenant, end to end.
 *
 * The point worth proving is that "off" is enforced by the API — a module that
 * merely vanished from the dock would still answer anyone who knew its URL.
 * Business endpoints are called through a support session, which is refused
 * exactly as a member of staff would be.
 */
describe('Module entitlement', { timeout: 60_000 }, () => {
  let server: Server;
  let base: string;
  let tenantId: string;
  let operatorToken: string;
  let shopToken: string;
  let saved: Array<Record<string, unknown>> = [];

  const run = Date.now().toString(36);
  const email = `mod-${run}@swarnay.test`;
  const PASSWORD = 'operator-pass-1';

  interface Reply { status: number; body: any }

  async function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  const setModule = (key: string, body: Record<string, unknown>) =>
    call(`/api/platform/tenants/${tenantId}/modules/${key}`, { method: 'PUT', body, token: operatorToken });

  beforeAll(async () => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await asPlatform(async (tx) => {
      tenantId = (await tx.one<{ id: string }>(`select id from tenant where kind = 'both' limit 1`)).id;
      saved = await tx.query(`select * from tenant_module where tenant_id = $1`, [tenantId]);
      await tx.query(
        `insert into platform_user (id, email, full_name, password_hash, role, is_active)
         values ($1, $2, $3, $4, $5, true)`,
        [newId(), email, 'Module Test Operator', await hashPassword(PASSWORD), SUPER_ADMIN.code],
      );
    });

    const signIn = await call('/api/platform/auth/login', { body: { email, password: PASSWORD } });
    expect(signIn.status).toBe(200);
    operatorToken = signIn.body.accessToken;

    const opened = await call('/api/platform/support-sessions', {
      body: { tenantId, reason: 'module entitlement test', durationMinutes: 10 }, token: operatorToken,
    });
    expect(opened.status).toBe(201);
    shopToken = opened.body.token;
  });

  afterAll(async () => {
    await asPlatform(async (tx) => {
      // Put the tenant's modules back exactly as they were.
      for (const row of saved) {
        await tx.query(
          `update tenant_module set enabled = $3, licence = $4, trial_ends_at = $5, expires_at = $6,
                  disabled_submodules = $7::jsonb
            where tenant_id = $1 and module_key = $2`,
          [tenantId, row.module_key, row.enabled, row.licence, row.trial_ends_at, row.expires_at,
           JSON.stringify(row.disabled_submodules ?? [])],
        );
      }
      await tx.query(`delete from support_session where operator_user_id in (select id from platform_user where email = $1)`, [email]);
      await tx.query(`delete from platform_audit_log where platform_user_id in (select id from platform_user where email = $1)`, [email]);
      await tx.query(`delete from platform_refresh_token where platform_user_id in (select id from platform_user where email = $1)`, [email]);
      await tx.query(`delete from platform_user where email = $1`, [email]);
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses every endpoint of a module switched off, and only that module', async () => {
    expect((await setModule('stock', { enabled: false })).status).toBe(200);

    const refused = await call('/api/stock/summary', { token: shopToken });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('module_disabled');
    expect(refused.body.error.details).toEqual({ module: 'stock', subModule: null });

    expect((await call('/api/oldgold/stock', { token: shopToken })).status).toBe(200);

    const me = await call('/api/me', { token: shopToken });
    expect(me.body.modules.map((m: { key: string }) => m.key)).not.toContain('stock');

    expect((await setModule('stock', { enabled: true })).status).toBe(200);
    expect((await call('/api/stock/summary', { token: shopToken })).status).toBe(200);
  });

  it('refuses a switched-off sub-module and leaves the rest of the module working', async () => {
    expect((await setModule('pos', { disabledSubmodules: ['pos.purchase'] })).status).toBe(200);

    const refused = await call('/api/purchase/orders', { token: shopToken });
    expect(refused.status).toBe(403);
    expect(refused.body.error.details).toEqual({ module: 'pos', subModule: 'pos.purchase' });

    expect((await setModule('pos', { disabledSubmodules: [] })).status).toBe(200);
    expect((await call('/api/purchase/orders', { token: shopToken })).status).toBe(200);
  });

  it('will not switch off a required module', async () => {
    const reply = await setModule('master', { enabled: false });
    expect(reply.status).toBe(422);
    expect(reply.body.error.code).toBe('module_required');
  });

  it('rejects unknown modules and sub-modules from another module', async () => {
    expect((await setModule('nope', { enabled: false })).status).toBe(404);
    const reply = await setModule('girvi', { disabledSubmodules: ['orders.repair'] });
    expect(reply.status).toBe(400);
  });

  it('keeps the trial end date when only the switch is changed', async () => {
    const ends = new Date(Date.now() + 9 * 86_400_000).toISOString();
    expect((await setModule('girvi', { licence: 'trial', trialEndsAt: ends })).status).toBe(200);
    const toggled = await setModule('girvi', { enabled: false });
    expect(new Date(toggled.body.trial_ends_at).toISOString()).toBe(ends);
  });

  it('shows the console every applicable module with its sub-modules', async () => {
    const detail = await call(`/api/platform/tenants/${tenantId}`, { token: operatorToken });
    const master = detail.body.modules.find((m: { module_key: string }) => m.module_key === 'master');
    expect(master.required).toBe(true);
    const pos = detail.body.modules.find((m: { module_key: string }) => m.module_key === 'pos');
    expect(pos.sub_modules.find((s: { key: string }) => s.key === 'pos.purchase').enforced).toBe(true);
  });
});
