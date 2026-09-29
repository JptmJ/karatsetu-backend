import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomInt } from 'node:crypto';
import '../src/bootstrap.js';
import { createApp } from '../src/app.js';
import { asPlatform } from '../src/core/db/client.js';
import { hashPassword } from '../src/modules/identity/auth.service.js';
import { invalidateUserAccess } from '../src/modules/identity/access.service.js';
import { provisionTenant } from '../src/modules/tenancy/provisioning.service.js';

const SHOP = 'authtest';
const PASSWORD = 'correct-horse-1';

describe('Sign-in, sessions and edge cases', { timeout: 60_000 }, () => {
  let server: Server;
  let base: string;
  let tenantId: string;
  const run = Date.now().toString(36);

  interface Reply { status: number; body: any; cookie: string | undefined; setCookie: string }

  async function call(path: string, init: { method?: string; body?: unknown; token?: string; cookie?: string; branch?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.cookie) headers.cookie = `ks_rt=${init.cookie}`;
    if (init.branch) headers['x-branch-id'] = init.branch;
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('ks_rt=')) ?? '';
    const text = await res.text();
    return {
      status: res.status,
      body: text ? JSON.parse(text) : null,
      cookie: setCookie.match(/^ks_rt=([^;]*)/)?.[1] || undefined,
      setCookie,
    };
  }

  const login = (identifier: string, password = PASSWORD, extra: Record<string, unknown> = {}) =>
    call('/api/auth/login', { body: { tenantCode: SHOP, identifier, password, ...extra } });

  /** A user in the test shop. Owner role at every branch unless `branch: false`. */
  async function createUser(name: string, opts: { active?: boolean; branch?: boolean; mustChange?: boolean; phone?: string } = {}) {
    const email = `${name}.${run}@authtest.in`;
    await asPlatform(async (tx) => {
      const user = await tx.one<{ id: string }>(
        `insert into app_user (id, tenant_id, email, phone, full_name, password_hash, is_active, must_change_password)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7) returning id`,
        [tenantId, email, opts.phone ?? null, name, await hashPassword(PASSWORD), opts.active ?? true, opts.mustChange ?? false],
      );
      if (opts.branch !== false) {
        await tx.query(
          `insert into user_role (id, tenant_id, user_id, role_id, branch_id)
           select gen_random_uuid(), $1, $2, id, null from role where tenant_id = $1 and code = 'owner'`,
          [tenantId, user.id],
        );
      }
    });
    return email;
  }

  const userId = (email: string) => asPlatform(async (tx) =>
    (await tx.one<{ id: string }>(`select id from app_user where email = $1`, [email])).id);

  beforeAll(async () => {
    const existing = await asPlatform((tx) => tx.maybeOne<{ id: string }>(`select id from tenant where code = $1`, [SHOP]));
    tenantId = existing?.id ?? (await provisionTenant({
      code: SHOP, legalName: 'Auth Test Jewellers', displayName: 'Auth Test', kind: 'retailer',
      owner: { email: `owner@${SHOP}.in`, fullName: 'Auth Owner', password: PASSWORD },
      firstBranch: { code: 'MAIN', name: 'Main Showroom' },
    })).tenantId;
    await asPlatform((tx) => tx.query(`update tenant set status = 'active' where id = $1`, [tenantId]));

    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await asPlatform((tx) => tx.query(`update tenant set status = 'active' where id = $1`, [tenantId]));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('signs in by email and returns the whole session with a 30-day httpOnly cookie', async () => {
    const email = await createUser('email');
    const r = await login(email.toUpperCase(), PASSWORD, { tenantCode: SHOP.toUpperCase() });
    expect(r.status).toBe(200);
    expect(typeof r.body.accessToken).toBe('string');
    expect(r.body.refreshToken).toBeUndefined();
    const s = r.body.session;
    expect(s.tenant.code).toBe(SHOP);
    expect(s.user.email).toBe(email);
    expect(s.branches.length).toBeGreaterThan(0);
    expect(s.branchId).toBe(s.branches[0].id);
    expect(s.permissions.length).toBeGreaterThan(0);
    expect(Array.isArray(s.modules)).toBe(true);
    expect(s.theme.preset_key).toBeTruthy();
    expect(r.setCookie).toMatch(/HttpOnly/);
    expect(r.setCookie).toMatch(/Path=\/api/);
    expect(r.setCookie).toMatch(/Max-Age=2592000/);
  });

  it('signs in by mobile number typed any way, and a browser-only session has no Max-Age', async () => {
    const phone = `+9198${randomInt(10_000_000, 99_999_999)}`;
    await createUser('mobile', { phone });
    const r = await login(`${phone.slice(3, 8)} ${phone.slice(8)}`, PASSWORD, { remember: false });
    expect(r.status).toBe(200);
    expect(r.cookie).toBeTruthy();
    expect(r.setCookie).not.toMatch(/Max-Age|Expires/);
  });

  it('gives one message for wrong shop, wrong user and wrong password', async () => {
    const email = await createUser('wrong');
    for (const r of [
      await login(email, 'nope-nope'),
      await login(`nobody.${run}@authtest.in`),
      await call('/api/auth/login', { body: { tenantCode: `no-shop-${run}`, identifier: email, password: PASSWORD } }),
    ]) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('invalid_credentials');
    }
  });

  it('locks after five wrong passwords, and an expired lock starts the count again', async () => {
    const email = await createUser('locked');
    for (let i = 1; i <= 4; i++) expect((await login(email, 'bad')).body.error.code).toBe('invalid_credentials');
    const fifth = await login(email, 'bad');
    expect(fifth.body.error.code).toBe('account_locked');
    expect(fifth.body.error.message).toMatch(/15 minutes/);
    expect((await login(email)).body.error.code).toBe('account_locked');

    await asPlatform((tx) => tx.query(`update app_user set locked_until = now() - interval '1 minute' where email = $1`, [email]));
    expect((await login(email, 'bad')).body.error.code).toBe('invalid_credentials');
    const count = await asPlatform((tx) => tx.one<{ failed_login_count: number; locked_until: string | null }>(
      `select failed_login_count, locked_until from app_user where email = $1`, [email]));
    expect(count).toEqual({ failed_login_count: 1, locked_until: null });

    expect((await login(email)).status).toBe(200);
  });

  it('only reveals a deactivated or branchless user once the password is right', async () => {
    const inactive = await createUser('inactive', { active: false });
    expect((await login(inactive, 'bad')).body.error.code).toBe('invalid_credentials');
    expect((await login(inactive)).body.error.code).toBe('account_inactive');

    const branchless = await createUser('branchless', { branch: false });
    expect((await login(branchless, 'bad')).body.error.code).toBe('invalid_credentials');
    expect((await login(branchless)).body.error.code).toBe('no_branch');
  });

  it('rotates the refresh cookie, allows a quick retry, and treats a late replay as theft', async () => {
    const email = await createUser('rotate');
    const first = (await login(email)).cookie!;

    const second = await call('/api/auth/refresh', { body: {}, cookie: first });
    expect(second.status).toBe(200);
    expect(second.cookie).toBeTruthy();
    expect(second.cookie).not.toBe(first);

    const retry = await call('/api/auth/refresh', { body: {}, cookie: first });
    expect(retry.status).toBe(200);

    const id = await userId(email);
    await asPlatform((tx) => tx.query(
      `update refresh_token set revoked_at = now() - interval '1 minute' where replaced_by_id is not null and user_id = $1`,
      [id]));
    const replay = await call('/api/auth/refresh', { body: {}, cookie: first });
    expect(replay.body.error.code).toBe('session_expired');
    expect((await call('/api/auth/refresh', { body: {}, cookie: second.cookie })).status).toBe(401);
    expect((await call('/api/auth/refresh', { body: {}, cookie: retry.cookie })).status).toBe(401);
  });

  it('refuses refresh with no cookie, and logout ends the sign-in and clears the cookie', async () => {
    expect((await call('/api/auth/refresh', { body: {} })).body.error.code).toBe('session_expired');

    const email = await createUser('logout');
    const cookie = (await login(email)).cookie!;
    const out = await call('/api/auth/logout', { body: {}, cookie });
    expect(out.status).toBe(204);
    expect(out.setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await call('/api/auth/refresh', { body: {}, cookie })).status).toBe(401);
    expect((await call('/api/auth/logout', { body: {} })).status).toBe(204);
  });

  it('holds a new user at the password screen, then keeps their remember-me choice', async () => {
    const email = await createUser('newbie', { mustChange: true });
    const signedIn = await login(email, PASSWORD, { remember: false });
    expect(signedIn.body.session.user.mustChangePassword).toBe(true);
    const token = signedIn.body.accessToken;

    expect((await call('/api/me', { token })).status).toBe(200);
    expect((await call('/api/stock/balances', { token })).body.error.code).toBe('password_change_required');

    const wrong = await call('/api/me/password', { token, cookie: signedIn.cookie, body: { currentPassword: 'bad', newPassword: 'another-pass-2' } });
    expect(wrong.status).toBe(400);

    const changed = await call('/api/me/password', { token, cookie: signedIn.cookie, body: { currentPassword: PASSWORD, newPassword: 'another-pass-2' } });
    expect(changed.status).toBe(200);
    expect(changed.setCookie).not.toMatch(/Max-Age/);
    expect((await call('/api/me', { token })).body.error.code).toBe('session_expired');
    expect((await call('/api/auth/refresh', { body: {}, cookie: signedIn.cookie })).status).toBe(401);

    const fresh = changed.body.accessToken;
    expect((await call('/api/me', { token: fresh })).body.user.mustChangePassword).toBe(false);
    expect((await call('/api/stock/balances', { token: fresh })).status).toBe(200);
  });

  it('refuses a branch the user does not hold', async () => {
    const email = await createUser('branch');
    const token = (await login(email)).body.accessToken;
    const r = await call('/api/me', { token, branch: '00000000-0000-4000-8000-000000000000' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('branch_forbidden');
  });

  it('shuts a suspended shop out of sign-in, requests and refresh', async () => {
    const email = await createUser('suspended');
    const signedIn = await login(email);
    await asPlatform((tx) => tx.query(`update tenant set status = 'suspended' where id = $1`, [tenantId]));
    try {
      expect((await login(email)).body.error.code).toBe('tenant_inactive');
      invalidateUserAccess(tenantId, await userId(email));
      expect((await call('/api/me', { token: signedIn.body.accessToken })).body.error.code).toBe('tenant_inactive');
      expect((await call('/api/auth/refresh', { body: {}, cookie: signedIn.cookie })).body.error.code).toBe('tenant_inactive');
    } finally {
      await asPlatform((tx) => tx.query(`update tenant set status = 'active' where id = $1`, [tenantId]));
    }
    expect((await call('/api/auth/refresh', { body: {}, cookie: signedIn.cookie })).status).toBe(401);
  });

  it('slows down a flood of attempts from one network for one shop', async () => {
    const tenantCode = `flood-${run}`;
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await call('/api/auth/login', { body: { tenantCode, identifier: 'x@y.in', password: 'z' } })).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
