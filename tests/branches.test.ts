import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import '../src/bootstrap.js';
import { createApp } from '../src/app.js';
import { asPlatform } from '../src/core/db/client.js';
import { signAccessToken } from '../src/modules/identity/auth.service.js';
import { createTenant } from '../src/modules/platform/provisioning.service.js';
import { newId } from '../src/core/util/id.js';
import { hashPassword } from '../src/modules/identity/auth.service.js';
import { SUPER_ADMIN } from '../src/modules/platform/roles.js';
import { signPlatformToken } from '../src/modules/platform/platform-auth.service.js';

/**
 * Branches, from both directions.
 *
 * The two paths used to disagree: the console seeded a branch's stock locations
 * and the shop's own Masters screen did not, so a branch added from inside the
 * business had nowhere to hold stock. These prove they now agree, and that the
 * branch allowance is honoured wherever the branch is added from.
 */
describe('Branches', { timeout: 60_000 }, () => {
  let server: Server;
  let base: string;
  let tenantId: string;
  let ownerToken: string;
  let operatorToken: string;

  const run = Date.now().toString(36).slice(-6);
  const SHOP = `br${run}`;

  interface Reply { status: number; body: any }

  async function call(
    path: string,
    init: { method?: string; body?: unknown; token?: string } = {},
  ): Promise<Reply> {
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

  /** Locations belonging to one branch, by code. */
  const locationsOf = (branchId: string) =>
    asPlatform((tx) => tx.query<{ code: string; is_default: boolean }>(
      `select code, is_default from stock_location where branch_id = $1 order by code`, [branchId]));

  const setLimit = (max: number | null) =>
    asPlatform((tx) => tx.query(`update tenant set max_branches = $2 where id = $1`, [tenantId, max]));

  beforeAll(async () => {
    const operatorId = newId();
    await asPlatform((tx) => tx.query(
      `insert into platform_user (id, email, full_name, password_hash, role, is_active)
       values ($1, $2, 'Branch Test Operator', $3, $4, true)`,
      [operatorId, `br-${run}@swarnay.test`, 'x', SUPER_ADMIN.code]));
    operatorToken = signPlatformToken({
      sub: operatorId, scope: 'platform', role: SUPER_ADMIN.code, permissions: ['*'],
    });

    tenantId = (await createTenant({
      code: SHOP,
      legalName: 'Branch Test Jewellers',
      kind: 'retailer',
      admin: { email: `owner@${SHOP}.in`, fullName: 'Branch Owner', password: 'owner-pass-1' },
      branch: { code: 'MAIN', name: 'Main Showroom' },
    }, operatorId)).tenantId;

    const owner = await asPlatform(async (tx) => {
      await tx.query(`update app_user set must_change_password = false where tenant_id = $1`, [tenantId]);
      return tx.one<{ id: string; tv: number }>(
        `select id, token_version as tv from app_user where tenant_id = $1 and email = $2`,
        [tenantId, `owner@${SHOP}.in`]);
    });
    ownerToken = signAccessToken({ sub: owner.id, tenantId, tv: owner.tv });

    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await asPlatform(async (tx) => {
      await tx.query(`delete from platform_audit_log where target_tenant_id = $1`, [tenantId]);
      await tx.query(`delete from platform_user where email = $1`, [`br-${run}@swarnay.test`]);
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('gives a branch added from the shop the same stock locations as one added from the console', async () => {
    const fromShop = await call('/api/master/branches', {
      token: ownerToken, body: { code: `SHOP${run}`.slice(0, 20), name: 'Added by the shop' },
    });
    expect(fromShop.status).toBe(201);

    const fromConsole = await call(`/api/platform/tenants/${tenantId}/branches`, {
      token: operatorToken, body: { code: `CON${run}`.slice(0, 20), name: 'Added by the console' },
    });
    expect(fromConsole.status).toBe(201);

    const shopCodes = (await locationsOf(fromShop.body.id)).map((l) => l.code);
    const consoleCodes = (await locationsOf(fromConsole.body.id)).map((l) => l.code);

    expect(shopCodes).toEqual(['COUNTER', 'VAULT', 'WINDOW']);
    expect(shopCodes).toEqual(consoleCodes);

    // And the same default, or stock would land somewhere different at each.
    const shopDefault = (await locationsOf(fromShop.body.id)).find((l) => l.is_default)?.code;
    const consoleDefault = (await locationsOf(fromConsole.body.id)).find((l) => l.is_default)?.code;
    expect(shopDefault).toBe('COUNTER');
    expect(consoleDefault).toBe('COUNTER');
  });

  it('gives a factory its production floor instead of a counter', async () => {
    const factory = await call(`/api/platform/tenants/${tenantId}/branches`, {
      token: operatorToken,
      body: { code: `FAC${run}`.slice(0, 20), name: 'Workshop', kind: 'factory' },
    });
    expect(factory.status).toBe(201);
    expect((await locationsOf(factory.body.id)).map((l) => l.code)).toEqual(['FLOOR', 'VAULT']);
  });

  it('refuses a branch code the business already uses, from either side', async () => {
    const taken = `DUP${run}`.slice(0, 20);
    expect((await call('/api/master/branches', {
      token: ownerToken, body: { code: taken, name: 'First' },
    })).status).toBe(201);

    // Same code, different case, from the shop.
    const again = await call('/api/master/branches', {
      token: ownerToken, body: { code: taken.toLowerCase(), name: 'Second' },
    });
    expect(again.status).toBe(409);

    // And from the console.
    const fromConsole = await call(`/api/platform/tenants/${tenantId}/branches`, {
      token: operatorToken, body: { code: taken, name: 'Third' },
    });
    expect(fromConsole.status).toBe(409);
  });

  it('holds the shop to its branch allowance', async () => {
    const used = await asPlatform((tx) => tx.one<{ n: number }>(
      `select count(*)::int n from branch where tenant_id = $1 and deleted_at is null`, [tenantId]));

    await setLimit(used.n);

    const refused = await call('/api/master/branches', {
      token: ownerToken, body: { code: `OVER${run}`.slice(0, 20), name: 'One too many' },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('branch_limit_reached');

    // The console is held to the same number — the limit is the plan, not the door.
    const alsoRefused = await call(`/api/platform/tenants/${tenantId}/branches`, {
      token: operatorToken, body: { code: `OVER2${run}`.slice(0, 20), name: 'Also too many' },
    });
    expect(alsoRefused.status).toBe(422);

    // Raising it lets the next one through.
    await setLimit(used.n + 1);
    const allowed = await call('/api/master/branches', {
      token: ownerToken, body: { code: `OK${run}`.slice(0, 20), name: 'Within the plan' },
    });
    expect(allowed.status).toBe(201);
  });

  it('treats no limit as no limit', async () => {
    await setLimit(null);
    const allowed = await call('/api/master/branches', {
      token: ownerToken, body: { code: `FREE${run}`.slice(0, 20), name: 'Unlimited plan' },
    });
    expect(allowed.status).toBe(201);
  });

  it('counts a deactivated branch against the allowance', async () => {
    // Otherwise a shop could park a branch and claim the slot back.
    const used = await asPlatform((tx) => tx.one<{ n: number }>(
      `select count(*)::int n from branch where tenant_id = $1 and deleted_at is null`, [tenantId]));
    await setLimit(used.n);

    const list = await call('/api/master/branches?limit=200', { token: ownerToken });
    const spare = list.body.rows.find((b: any) => !b.is_head_office && b.is_active);
    expect(spare).toBeDefined();

    await call(`/api/master/branches/${spare.id}`, {
      method: 'PATCH', token: ownerToken, body: { is_active: false },
    });

    const refused = await call('/api/master/branches', {
      token: ownerToken, body: { code: `PARK${run}`.slice(0, 20), name: 'Reclaimed slot' },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('branch_limit_reached');
  });
});
