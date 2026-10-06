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
 * Support impersonation, end to end.
 *
 * This is the only path from a platform operator to a shop's data, so the parts
 * worth proving are the ones that keep it honest: a platform token cannot read
 * business data on its own, a read-only window really cannot write, ending a
 * window locks the operator out at once, and whatever is done inside it is
 * tagged with the session in the shop's own audit log.
 */
describe('Support sessions', { timeout: 60_000 }, () => {
  let server: Server;
  let base: string;
  let tenantId: string;
  let operatorToken: string;

  const run = Date.now().toString(36);
  const email = `op-${run}@swarnay.test`;
  const PASSWORD = 'operator-pass-1';

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

  const openSession = (body: Record<string, unknown>) =>
    call('/api/platform/support-sessions', { body: { tenantId, ...body }, token: operatorToken });

  beforeAll(async () => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await asPlatform(async (tx) => {
      tenantId = (await tx.one<{ id: string }>(`select id from tenant limit 1`)).id;
      await tx.query(
        `insert into platform_user (id, email, full_name, password_hash, role, is_active)
         values ($1, $2, $3, $4, $5, true)`,
        [newId(), email, 'Test Operator', await hashPassword(PASSWORD), SUPER_ADMIN.code],
      );
    });

    const signIn = await call('/api/platform/auth/login', { body: { email, password: PASSWORD } });
    expect(signIn.status).toBe(200);
    operatorToken = signIn.body.accessToken;
  });

  afterAll(async () => {
    await asPlatform(async (tx) => {
      await tx.query(`delete from support_session where operator_user_id in
                        (select id from platform_user where email = $1)`, [email]);
      await tx.query(`delete from platform_audit_log where platform_user_id in
                        (select id from platform_user where email = $1)`, [email]);
      await tx.query(`delete from platform_refresh_token where platform_user_id in
                        (select id from platform_user where email = $1)`, [email]);
      await tx.query(`delete from platform_user where email = $1`, [email]);
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses a platform token on a tenant endpoint, so a session is the only way in', async () => {
    const direct = await call('/api/me', { token: operatorToken });
    expect(direct.status).toBe(401);
  });

  it('opens a read-only window and reads the shop through it', async () => {
    const opened = await openSession({ reason: 'Checking a mis-priced invoice' });
    expect(opened.status).toBe(201);
    expect(opened.body.token).toBeTruthy();
    expect(opened.body.session.can_write).toBe(false);

    const me = await call('/api/me', { token: opened.body.token });
    expect(me.status).toBe(200);
    expect(me.body.tenant.id).toBe(tenantId);
    // The app is told it is a support session, so it can show its banner.
    expect(me.body.support).toMatchObject({ sessionId: opened.body.session.id, canWrite: false });
    // The identity says plainly that this is support, not a member of staff.
    expect(me.body.user.fullName).toContain('support');
  });

  it('refuses every write from a read-only window', async () => {
    const opened = await openSession({ reason: 'Looking at the stock register' });
    const token = opened.body.token;

    expect((await call('/api/me', { token })).status).toBe(200);

    const write = await call('/api/master/rates', {
      token,
      body: { metalId: newId(), purityId: newId(), ratePerGram: '6000' },
    });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('support_session_read_only');
  });

  it('writes through an escalated window, and tags the change with the session', async () => {
    // The super admin holds '*', so it can escalate; this proves the gate is
    // wired to the permission rather than ignored.
    const escalated = await openSession({ reason: 'Adding a category the owner asked for', canWrite: true });
    expect(escalated.status).toBe(201);
    expect(escalated.body.session.can_write).toBe(true);

    const code = `SUP${run.slice(-5).toUpperCase()}`;
    const created = await call('/api/master/categories', {
      token: escalated.body.token,
      body: { code, name: `Support test ${run}` },
    });
    expect(created.status).toBe(201);

    /*
     * The point of the whole mechanism: the shop's own audit log can say that
     * this change came from a support session, and which one.
     */
    const tagged = await asPlatform(async (tx) => tx.maybeOne<{ support_session_id: string; user_id: string | null }>(
      `select support_session_id, user_id from audit_log
        where entity_id = $1 order by at desc limit 1`,
      [created.body.id],
    ));

    expect(tagged?.support_session_id).toBe(escalated.body.session.id);
    // No member of staff did this, and the log does not pretend one did.
    expect(tagged?.user_id).toBeNull();

    await asPlatform(async (tx) => {
      await tx.query(`delete from audit_log where entity_id = $1`, [created.body.id]);
      await tx.query(`delete from item_category where id = $1`, [created.body.id]);
    });
  });

  it('locks the operator out the moment the window is closed', async () => {
    const opened = await openSession({ reason: 'Short look at the order board' });
    const token = opened.body.token;
    expect((await call('/api/me', { token })).status).toBe(200);

    const ended = await call(`/api/platform/support-sessions/${opened.body.session.id}/end`, {
      method: 'POST', token: operatorToken,
    });
    expect(ended.status).toBe(200);

    // The token has not expired — the row is what decides.
    const after = await call('/api/me', { token });
    expect(after.status).toBe(401);

    // Closing twice is refused rather than silently accepted.
    const again = await call(`/api/platform/support-sessions/${opened.body.session.id}/end`, {
      method: 'POST', token: operatorToken,
    });
    expect(again.status).toBe(400);
  });

  it('refuses a window that has run past its end', async () => {
    const opened = await openSession({ reason: 'Window that we will age by hand', durationMinutes: 5 });
    const token = opened.body.token;

    await asPlatform(async (tx) => {
      await tx.query(`update support_session set ends_at = now() - interval '1 minute' where id = $1`,
        [opened.body.session.id]);
    });

    const after = await call('/api/me', { token });
    expect(after.status).toBe(401);
  });

  it('lists its sessions with the reason, so a tenant can be shown who looked', async () => {
    const reason = `Audit trail check ${run}`;
    await openSession({ reason });

    const list = await call(`/api/platform/support-sessions?tenantId=${tenantId}&limit=50`, {
      token: operatorToken,
    });
    expect(list.status).toBe(200);

    const mine = list.body.rows.find((r: any) => r.reason === reason);
    expect(mine).toBeDefined();
    expect(mine.operator_email).toBe(email);
    expect(mine.tenant_id).toBe(tenantId);
    expect(mine.is_open).toBe(true);
  });

  it('writes the start and the end to the platform audit log', async () => {
    const opened = await openSession({ reason: 'Session that should be audited' });
    await call(`/api/platform/support-sessions/${opened.body.session.id}/end`, {
      method: 'POST', token: operatorToken,
    });

    const audit = await call('/api/platform/audit?limit=100', { token: operatorToken });
    const actions = audit.body.rows
      .filter((r: any) => r.target_id === opened.body.session.id)
      .map((r: any) => r.action);

    expect(actions).toContain('support.session_start');
    expect(actions).toContain('support.session_end');
  });

  it('rejects a reason too short to tell a tenant anything', async () => {
    const bad = await openSession({ reason: 'hi' });
    expect(bad.status).toBe(400);
  });

  it('will not open a window longer than the hard ceiling', async () => {
    const bad = await openSession({ reason: 'Far too long a window', durationMinutes: 10_000 });
    expect(bad.status).toBe(400);
  });

  it('will not open a window into a shop that does not exist', async () => {
    const bad = await call('/api/platform/support-sessions', {
      token: operatorToken,
      body: { tenantId: newId(), reason: 'No such business' },
    });
    expect(bad.status).toBe(404);
  });
});
