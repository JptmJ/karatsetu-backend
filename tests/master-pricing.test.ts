import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import '../src/bootstrap.js';
import { createApp } from '../src/app.js';
import { asPlatform, asTenant } from '../src/core/db/client.js';
import { repo } from '../src/core/db/repository.js';
import { signAccessToken } from '../src/modules/identity/auth.service.js';

describe('Masters Pricing, Keyset Pagination, and Audit', { timeout: 30_000 }, () => {
  let server: Server;
  let baseUrl: string;
  let token: string;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    let tokenVersion = 1;
    await asPlatform(async (tx) => {
      let user = await tx.maybeOne<{ id: string; tenant_id: string; token_version: number }>(
        `select u.id, u.tenant_id, u.token_version
           from app_user u
           join user_role ur on ur.user_id = u.id
           join role r on r.id = ur.role_id
          where r.code = 'owner' and u.deleted_at is null and not u.must_change_password
          limit 1`,
      );
      if (!user) {
        user = await tx.maybeOne<{ id: string; tenant_id: string; token_version: number }>(
          `select u.id, u.tenant_id, u.token_version
             from app_user u
             join user_role ur on ur.user_id = u.id
             join role r on r.id = ur.role_id
            where r.code = 'owner' and u.deleted_at is null
            limit 1`,
        );
        if (user) {
          await tx.query(`update app_user set must_change_password = false where id = $1`, [user.id]);
        }
      }
      if (!user) throw new Error('No owner user found in database');
      userId = user.id;
      tenantId = user.tenant_id;
      tokenVersion = user.token_version;
    });

    token = signAccessToken({ sub: userId, tenantId, tv: tokenVersion });

    const app = createApp();
    server = app.listen(0);
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  describe('GST versioning', () => {
    it('handles version creation, collision rejection, in-force delete rejection, and future delete reopen', async () => {
      let tenantToday: string;
      await asTenant(tenantId, async (tx) => {
        const row = await tx.one<{ today: string }>(
          `select (now() at time zone timezone)::date::text as today from tenant where id = $1`,
          [tenantId],
        );
        tenantToday = row.today;

        // Ensure an open 7113 / metal rate exists starting today or earlier
        const open = await tx.maybeOne<{ id: string; effective_from: string }>(
          `select id, effective_from::text from hsn_gst_rate where hsn_code = '7113' and component = 'metal' and effective_to is null`,
        );
        if (!open) {
          await tx.query(
            `insert into hsn_gst_rate (id, tenant_id, hsn_code, component, gst_rate, effective_from, code_type, created_by)
             values (gen_random_uuid(), $1, '7113', 'metal', 3, '2024-01-01', 'hsn', $2)`,
            [tenantId, userId],
          );
        }
      });

      // Get current active version's effective_from and ID
      let currentId: string;
      let currentEffFrom: string;
      await asTenant(tenantId, async (tx) => {
        const row = await tx.one<{ id: string; eff: string }>(
          `select id, effective_from::text as eff from hsn_gst_rate where hsn_code = '7113' and component = 'metal' and effective_to is null`,
        );
        currentId = row.id;
        currentEffFrom = row.eff;
      });

      // 1. Adding 7113/metal at 3% from a future date closes the current row the day before.
      const futureDate = '2099-01-01';
      const createRes = await fetch(`${baseUrl}/api/master/gst-rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          hsn_code: '7113',
          code_type: 'hsn',
          component: 'metal',
          gst_rate: '3',
          effective_from: futureDate,
          description: 'Future GST update',
        }),
      });
      expect(createRes.status).toBe(201);
      const newVersion = (await createRes.json()) as { id: string };

      // Verify the previous row's effective_to is 2098-12-31
      await asTenant(tenantId, async (tx) => {
        const closed = await tx.one<{ effective_to: string }>(
          `select effective_to::text from hsn_gst_rate where id = $1`,
          [currentId],
        );
        expect(closed.effective_to).toBe('2098-12-31');
      });

      // 2. A second version starting on or before the current start date is rejected.
      const rejectRes = await fetch(`${baseUrl}/api/master/gst-rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          hsn_code: '7113',
          code_type: 'hsn',
          component: 'metal',
          gst_rate: '3',
          effective_from: futureDate, // Same start date
        }),
      });
      expect(rejectRes.status).toBe(400);
      const rejectBody = (await rejectRes.json()) as { error: { message: string } };
      expect(rejectBody.error.message).toContain('The current version starts on 2099-01-01. A new version must start after that.');

      // 3. Deleting a version that's already in force is rejected.
      const deleteInForceRes = await fetch(`${baseUrl}/api/master/gst-rates/${currentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(deleteInForceRes.status).toBe(400);
      const deleteInForceBody = (await deleteInForceRes.json()) as { error: { message: string } };
      expect(deleteInForceBody.error.message).toContain('This rate is already in force and may be on invoices.');

      // 4. Deleting a future version reopens the previous one.
      const deleteFutureRes = await fetch(`${baseUrl}/api/master/gst-rates/${newVersion.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(deleteFutureRes.status).toBe(204);

      // Verify previous version is re-opened (effective_to is null)
      await asTenant(tenantId, async (tx) => {
        const reopened = await tx.one<{ effective_to: string | null }>(
          `select effective_to::text from hsn_gst_rate where id = $1`,
          [currentId],
        );
        expect(reopened.effective_to).toBeNull();
      });
    });
  });

  describe('Price rules', () => {
    it('creating a slab rule with a gap between slabs gives 400 with the slab message', async () => {
      const res = await fetch(`${baseUrl}/api/master/price-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: 'TEST_GAP_SLAB',
          name: 'Gap Slab Rule',
          applies_to: 'making',
          basis: 'slab',
          slab_mode: 'whole',
          slabs: [
            { fromG: '0', toG: '10', rate: '100' },
            { fromG: '15', toG: null, rate: '150' }, // gap: 10 to 15
          ],
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain('Gap or overlap');
    });

    it('updating an existing slab rule to basis: per_gram without a rate is rejected', async () => {
      const createRes = await fetch(`${baseUrl}/api/master/price-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: 'TEST_VALID_SLAB',
          name: 'Valid Slab Rule',
          applies_to: 'making',
          basis: 'slab',
          slab_mode: 'whole',
          slabs: [
            { fromG: '0', toG: '10', rate: '100' },
            { fromG: '10', toG: null, rate: '150' },
          ],
        }),
      });
      expect(createRes.status).toBe(201);
      const rule = (await createRes.json()) as { id: string };

      const updateRes = await fetch(`${baseUrl}/api/master/price-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          basis: 'per_gram',
          rate: null,
        }),
      });
      expect(updateRes.status).toBe(400);
      const body = (await updateRes.json()) as { error: { message: string } };
      expect(body.error.message).toBe('Enter a rate for this rule.');

      // Clean up
      await fetch(`${baseUrl}/api/master/price-rules/${rule.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    });
  });

  describe('Payment methods', () => {
    it('account_id pointing at an income ledger is rejected', async () => {
      let incomeAccountId: string;
      await asTenant(tenantId, async (tx) => {
        const acc = await tx.one<{ id: string }>(
          `select id from account where account_type = 'income' and deleted_at is null limit 1`,
        );
        incomeAccountId = acc.id;
      });

      const res = await fetch(`${baseUrl}/api/master/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: 'TEST_INCOME_PAY',
          name: 'Test Income Payment',
          kind: 'cash',
          account_id: incomeAccountId,
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toBe('Money must land in an asset ledger — Cash in Hand or a bank account.');
    });

    it('PUT …/branches with [] clears the list (meaning every branch)', async () => {
      const createRes = await fetch(`${baseUrl}/api/master/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: 'TEST_BRANCH_PAY',
          name: 'Test Branch Payment',
          kind: 'cash',
        }),
      });
      expect(createRes.status).toBe(201);
      const pm = (await createRes.json()) as { id: string };

      let branchId: string;
      await asTenant(tenantId, async (tx) => {
        const b = await tx.one<{ id: string }>(`select id from branch where deleted_at is null limit 1`);
        branchId = b.id;
      });

      // Assign one branch
      const putRes1 = await fetch(`${baseUrl}/api/master/payment-methods/${pm.id}/branches`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ branchIds: [branchId] }),
      });
      expect(putRes1.status).toBe(204);

      // Verify branch is saved
      await asTenant(tenantId, async (tx) => {
        const branches = await tx.query(
          `select branch_id from payment_method_branch where payment_method_id = $1`,
          [pm.id],
        );
        expect(branches.length).toBe(1);
      });

      // Now clear branches with []
      const putRes2 = await fetch(`${baseUrl}/api/master/payment-methods/${pm.id}/branches`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ branchIds: [] }),
      });
      expect(putRes2.status).toBe(204);

      // Verify branches cleared in DB
      await asTenant(tenantId, async (tx) => {
        const branches = await tx.query(
          `select branch_id from payment_method_branch where payment_method_id = $1`,
          [pm.id],
        );
        expect(branches.length).toBe(0);
      });

      // Clean up
      await fetch(`${baseUrl}/api/master/payment-methods/${pm.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    });
  });

  describe('Cursor pagination', () => {
    it('pages through 120 parties with limit=50 (50 + 50 + 20), no duplicates, and nextCursor: null at end; tampered cursor gives 400', async () => {
      const prefix = `CURS_${Date.now().toString(36)}_`;

      // Insert 120 parties
      await asTenant(tenantId, async (tx) => {
        const values = [];
        for (let i = 1; i <= 120; i++) {
          const pad = String(i).padStart(3, '0');
          values.push({
            code: `${prefix}${pad}`,
            name: `${prefix} Customer ${pad}`,
            is_customer: true,
            party_type: 'individual' as const,
          });
        }
        await repo(tx, 'party').insertMany(values);
      });

      // Page 1
      const res1 = await fetch(`${baseUrl}/api/master/parties?search=${prefix}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res1.status).toBe(200);
      const page1 = (await res1.json()) as { rows: Array<{ id: string }>; nextCursor: string | null };
      expect(page1.rows.length).toBe(50);
      expect(page1.nextCursor).toBeTruthy();

      // Page 2
      const res2 = await fetch(
        `${baseUrl}/api/master/parties?search=${prefix}&limit=50&cursor=${encodeURIComponent(page1.nextCursor!)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res2.status).toBe(200);
      const page2 = (await res2.json()) as { rows: Array<{ id: string }>; nextCursor: string | null };
      expect(page2.rows.length).toBe(50);
      expect(page2.nextCursor).toBeTruthy();

      // Page 3
      const res3 = await fetch(
        `${baseUrl}/api/master/parties?search=${prefix}&limit=50&cursor=${encodeURIComponent(page2.nextCursor!)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res3.status).toBe(200);
      const page3 = (await res3.json()) as { rows: Array<{ id: string }>; nextCursor: string | null };
      expect(page3.rows.length).toBe(20);
      expect(page3.nextCursor).toBeNull();

      // No duplicates across pages
      const allIds = [...page1.rows, ...page2.rows, ...page3.rows].map((r) => r.id);
      expect(new Set(allIds).size).toBe(120);

      // Tampered cursor gives 400
      const tamperedRes = await fetch(`${baseUrl}/api/master/parties?limit=50&cursor=invalid_base64_cursor`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(tamperedRes.status).toBe(400);
      const tamperedBody = (await tamperedRes.json()) as { error: { message: string } };
      expect(tamperedBody.error.message).toContain('That page link is no longer valid');

      // Clean up test parties
      await asTenant(tenantId, async (tx) => {
        await tx.query(`delete from party where code like $1`, [`${prefix}%`]);
      });
    });
  });

  describe('Audit', () => {
    it('records matching rows in audit_log after create, update, and delete', async () => {
      // 1. Create
      const createRes = await fetch(`${baseUrl}/api/master/price-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: 'AUDIT_RULE',
          name: 'Audit Test Rule',
          applies_to: 'making',
          basis: 'per_gram',
          rate: '150',
        }),
      });
      expect(createRes.status).toBe(201);
      const rule = (await createRes.json()) as { id: string };

      await asTenant(tenantId, async (tx) => {
        const row = await tx.maybeOne<{ action: string; entity_table: string; entity_id: string }>(
          `select action, entity_table, entity_id from audit_log where entity_table = 'price_rule' and entity_id = $1 and action = 'price_rule.create'`,
          [rule.id],
        );
        expect(row).toBeTruthy();
        expect(row?.action).toBe('price_rule.create');
      });

      // 2. Update
      const updateRes = await fetch(`${baseUrl}/api/master/price-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'Audit Test Rule Updated' }),
      });
      expect(updateRes.status).toBe(200);

      await asTenant(tenantId, async (tx) => {
        const row = await tx.maybeOne<{ action: string }>(
          `select action from audit_log where entity_table = 'price_rule' and entity_id = $1 and action = 'price_rule.update'`,
          [rule.id],
        );
        expect(row).toBeTruthy();
        expect(row?.action).toBe('price_rule.update');
      });

      // 3. Delete
      const deleteRes = await fetch(`${baseUrl}/api/master/price-rules/${rule.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(deleteRes.status).toBe(204);

      await asTenant(tenantId, async (tx) => {
        const row = await tx.maybeOne<{ action: string }>(
          `select action from audit_log where entity_table = 'price_rule' and entity_id = $1 and action = 'price_rule.delete'`,
          [rule.id],
        );
        expect(row).toBeTruthy();
        expect(row?.action).toBe('price_rule.delete');
      });
    });
  });
});
