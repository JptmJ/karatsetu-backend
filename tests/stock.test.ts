import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import '../src/bootstrap.js';
import { createApp } from '../src/app.js';
import { asPlatform } from '../src/core/db/client.js';
import { signAccessToken } from '../src/modules/identity/auth.service.js';
import { provisionTenant } from '../src/modules/tenancy/provisioning.service.js';

const SHOP = 'stocktest';
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Stock & Tagging', { timeout: 120_000 }, () => {
  let server: Server;
  let base: string;
  let owner: string;
  let storekeeper: string;
  let tenantId: string;
  let main: string;
  const run = Date.now().toString(36).toUpperCase();
  const ids: Record<string, string> = {};

  async function call(path: string, body?: unknown, opts: { method?: string; as?: string } = {}) {
    const res = await fetch(`${base}${path}`, {
      method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.as ?? owner}`, 'x-branch-id': main },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  }
  const tag = (pieces: Body[]) => call('/api/tagging/pieces', { pieces });
  const piece = async (id: string) => (await call(`/api/stock/pieces/${id}`)).body;
  const lot = async (locationId: string) => Number((await call(`/api/stock/balances?tracking=lot&locationId=${locationId}`)).body.rows
    .find((r: Body) => r.item_id === ids.bulk)?.net_weight ?? 0);

  beforeAll(async () => {
    const existing = await asPlatform((tx) => tx.maybeOne<{ id: string }>(`select id from tenant where code = $1`, [SHOP]));
    tenantId = existing?.id ?? (await provisionTenant({
      code: SHOP, legalName: 'Stock Test Jewellers', displayName: 'Stock Test', kind: 'retailer',
      owner: { email: `owner@${SHOP}.in`, fullName: 'Stock Owner', password: 'owner-pass-1' },
      firstBranch: { code: 'MAIN', name: 'Main Showroom' },
    })).tenantId;
    const users = await asPlatform(async (tx) => {
      const o = await tx.one<{ id: string; tv: number; branch: string }>(
        `select u.id, u.token_version as tv, (select id from branch where tenant_id = $1 and code = 'MAIN') as branch
           from app_user u where u.tenant_id = $1 and u.email = $2`, [tenantId, `owner@${SHOP}.in`]);
      await tx.query(`update app_user set must_change_password = false where id = $1`, [o.id]);
      // A run that failed halfway leaves its count open, which would block the next one.
      await tx.query(`update stock_count set status = 'cancelled' where tenant_id = $1 and status = 'open'`, [tenantId]);
      const s = await tx.one<{ id: string; tv: number }>(
        `insert into app_user (id, tenant_id, email, full_name, password_hash, is_active, must_change_password)
         values (gen_random_uuid(), $1, $2, 'Store Keeper', 'x', true, false) returning id, token_version as tv`,
        [tenantId, `store.${run.toLowerCase()}@${SHOP}.in`]);
      await tx.query(
        `insert into user_role (id, tenant_id, user_id, role_id, branch_id)
         select gen_random_uuid(), $1, $2, id, null from role where tenant_id = $1 and code = 'storekeeper'`, [tenantId, s.id]);
      return { o, s };
    });
    main = users.o.branch;
    owner = signAccessToken({ sub: users.o.id, tenantId, tv: users.o.tv });
    storekeeper = signAccessToken({ sub: users.s.id, tenantId, tv: users.s.tv });
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const find = async (path: string, code: string) => (await call(path)).body.rows.find((r: Body) => r.code === code).id as string;
    ids.gold = await find('/api/master/metals', 'GOLD');
    ids.k22 = (await call(`/api/master/purities?metal_id=${ids.gold}`)).body.rows.find((r: Body) => r.code === '22K').id;
    ids.s925 = (await call('/api/master/purities?limit=200')).body.rows.find((r: Body) => r.code === '925').id;
    ids.counter = await find(`/api/master/locations?branch_id=${main}`, 'COUNTER');
    ids.vault = await find(`/api/master/locations?branch_id=${main}`, 'VAULT');
    ids.ring = (await call('/api/master/items', { code: `RING${run}`, name: `Ring ${run}`, metal_id: ids.gold, tracking: 'piece' })).body.id;
    ids.bulk = (await call('/api/master/items', { code: `BULK${run}`, name: `Bulk ${run}`, metal_id: ids.gold, tracking: 'lot', nature: 'raw_metal' })).body.id;
    const branch = (await call('/api/master/branches', { code: `S${run}`.slice(0, 20), name: 'Surat' })).body;
    ids.branch2 = branch.id;
    ids.surat = (await call('/api/master/locations', { branch_id: branch.id, code: 'COUNTER', name: 'Counter' })).body.id;
  });

  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  const ring = (extra: Body = {}) => ({ itemId: ids.ring, purityId: ids.k22, locationId: ids.counter, grossWeight: '10.000', ...extra });
  const huid = () => Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X');

  it('tags a batch: next tag numbers, net and fine weight, HUID history, opening stock, print queue', async () => {
    const h = huid();
    const res = await tag([ring({ stoneWeight: '1.500', huid: h.toLowerCase(), costValue: '60000' }), ring({ grossWeight: '4.250' })]);
    expect(res.status).toBe(201);
    const [a, b] = res.body.rows;
    expect(a.tag_number).toMatch(/^T\d{7}$/);
    expect(Number(b.tag_number.slice(1))).toBe(Number(a.tag_number.slice(1)) + 1);
    expect(Number(a.net_weight)).toBe(8.5);
    expect(Number(a.fine_weight)).toBe(7.786);
    expect(a.huid).toBe(h);
    ids.a = a.id; ids.b = b.id;

    const detail = await piece(a.id);
    expect(detail.movements).toHaveLength(1);
    expect(detail.movements[0].reason).toBe('opening');
    expect(detail.huids).toHaveLength(1);

    const queue = (await call('/api/stock/pieces?unprinted=true&limit=200')).body.rows.map((r: Body) => r.id);
    expect(queue).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it('refuses bad pieces with the reason, and saves nothing from a bad batch', async () => {
    const taken = (await piece(ids.a)).huid;
    const cases: [Body, RegExp][] = [
      [ring({ purityId: ids.s925 }), /different metal/],
      [ring({ stoneWeight: '11' }), /more than the gross weight/],
      [ring({ grossWeight: '0' }), /more than 0/],
      [ring({ huid: 'AB12' }), /6 letters or digits/],
      [ring({ huid: taken }), /already on another piece/],
      [ring({ itemId: ids.bulk }), /counted by weight/],
    ];
    for (const [input, message] of cases) {
      const res = await tag([input]);
      expect(res.status, JSON.stringify(input)).toBe(422);
      expect(res.body.error.message).toMatch(message);
    }
    const h = huid();
    const dup = await tag([ring({ huid: h }), ring({ huid: h })]);
    expect(dup.body.error.message).toBe(`Piece 2: HUID ${h} is repeated on piece 1.`);
    expect((await call(`/api/stock/pieces?search=${h}`)).body.rows).toHaveLength(0);
  });

  it('two counters saving the same HUID or tag number at the same instant: one wins, the other is told which', async () => {
    const h = huid();
    const both = await Promise.all([tag([ring({ huid: h })]), tag([ring({ huid: h })])]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(both.find((r) => r.status === 422)!.body.error.message).toMatch(new RegExp(`HUID ${h} (is already on another piece|was just saved on another piece)`));
    const tagNo = `RACE${run}`;
    const pair = await Promise.all([tag([ring({ tagNumber: tagNo })]), tag([ring({ tagNumber: tagNo })])]);
    expect(pair.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(pair.find((r) => r.status === 422)!.body.error.message).toMatch(new RegExp(`Tag number ${tagNo} (is already used|was just used for another piece)`));
  });

  it('prints with a saved design and takes the pieces out of the queue', async () => {
    const t = await call('/api/tagging/templates', {
      code: `tag-${run}`, name: 'Butterfly', page: { widthMm: 85, heightMm: 15 }, canvas_json: '{"objects":[]}',
      bindings: [{ objectId: 'x', fieldKey: 'item.netWeightG' }], is_default: true,
    });
    expect(t.status).toBe(201);
    expect(t.body.bindings).toEqual([{ objectId: 'x', fieldKey: 'item.netWeightG' }]);
    const printed = await call('/api/tagging/print', { templateId: t.body.id, pieceIds: [ids.a, ids.b] });
    expect(printed.status).toBe(200);
    const label = printed.body.labels.find((l: Body) => l.pieceId === ids.a);
    expect(Number(label.item.netWeightG)).toBe(8.5);
    expect(label.item.purity).toBe('22K');
    expect(label.branch.shortName).toBe('MAIN');
    const queue = (await call('/api/stock/pieces?unprinted=true&limit=200')).body.rows.map((r: Body) => r.id);
    expect(queue).not.toContain(ids.a);
    expect((await piece(ids.a)).label_print_count).toBe(1);

    // The queue never prints a tag twice; reprinting is on purpose.
    const again = await call('/api/tagging/print', { templateId: t.body.id, pieceIds: [ids.a] });
    expect(again.body.error.code).toBe('tag_already_printed');
    const tagA = (await piece(ids.a)).tag_number;
    expect(again.body.error.message).toMatch(new RegExp(String.raw`^Already printed: ${tagA} by Stock Owner at \d{2} \w{3} \d{2}:\d{2}\. Nothing was printed`));
    expect((await call('/api/tagging/print', { templateId: t.body.id, pieceIds: [ids.a], reprint: true })).status).toBe(200);
    expect((await piece(ids.a)).label_print_count).toBe(2);

    // Two people printing the same new tags at once: one prints, the other is refused.
    const [c] = (await tag([ring()])).body.rows;
    const both = await Promise.all([1, 2].map(() => call('/api/tagging/print', { templateId: t.body.id, pieceIds: [c.id] })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 422]);
    expect((await piece(c.id)).label_print_count).toBe(1);

    // The queue can be narrowed to pieces the signed-in person tagged.
    const [mineOnly] = (await tag([ring()])).body.rows;
    const mine = (await call('/api/stock/pieces?unprinted=true&mine=true&limit=200')).body.rows.map((r: Body) => r.id);
    expect(mine).toContain(mineOnly.id);
    expect((await call('/api/stock/pieces?unprinted=true&mine=true&limit=200', undefined, { as: storekeeper })).body.rows.map((r: Body) => r.id)).not.toContain(mineOnly.id);
    expect((await call('/api/stock/summary')).body.print_queue.mine).toBeGreaterThan(0);
  });

  it('replaces a HUID keeping the old one in history', async () => {
    const h = huid();
    expect((await call(`/api/stock/pieces/${ids.a}/huid`, { huid: h })).body.huid).toBe(h);
    const detail = await piece(ids.a);
    expect(detail.huids).toHaveLength(2);
    expect(detail.huids[0].superseded_at).not.toBeNull();
  });

  it('corrects weights through an adjustment; only the owner or admin may', async () => {
    const refused = await call(`/api/stock/pieces/${ids.b}/weights`, { grossWeight: '4.300', note: 'Scale error' }, { as: storekeeper });
    expect(refused.status).toBe(403);
    const fixed = await call(`/api/stock/pieces/${ids.b}/weights`, { grossWeight: '4.300', note: 'Scale error' });
    expect(Number(fixed.body.net_weight)).toBe(4.3);
    const adj = (await call('/api/stock/adjustments')).body.rows[0];
    expect(adj.reason).toBe('weighing_correction');
    expect(Number(adj.net_weight_in)).toBe(4.3);
    expect(Number(adj.net_weight_out)).toBe(4.25);
  });

  it('imports opening stock, reporting bad rows by spreadsheet row', async () => {
    const lots = await call('/api/stock/import/lots', { locationId: ids.vault, rows: [
      { item_code: `bulk${run}`, purity: '22k', net_weight: '1,000.500', cost_value: '6600000' },
      { item_code: `RING${run}`, purity: '22K', net_weight: '5' },
      { item_code: `BULK${run}`, purity: '925', net_weight: '5' },
      { item_code: 'NOPE', purity: '22K', net_weight: '5' },
    ] });
    expect(lots.body.inserted).toBe(1);
    expect(lots.body.failed.map((f: Body) => f.row)).toEqual([3, 4, 5]);
    expect(await lot(ids.vault)).toBe(1000.5);

    const tagNo = `OP${run}`;
    const pieces = await call('/api/stock/import/pieces', { locationId: ids.counter, rows: [
      { item_code: `RING${run}`, purity: '22K', gross_weight: 7, tag_number: tagNo },
      { item_code: `RING${run}`, purity: '22K', gross_weight: '6', tag_number: tagNo },
      { item_code: `RING${run}`, purity: '22K', gross_weight: '' },
    ] });
    expect(pieces.body.inserted).toBe(1);
    expect(pieces.body.failed).toEqual([
      { row: 3, message: `Tag number ${tagNo} is repeated on row 2.` },
      { row: 4, message: expect.stringMatching(/^gross_weight/) },
    ]);
  });

  it('transfers inside a branch at once, and between branches in two steps', async () => {
    const inside = await call('/api/stock/transfers', { fromLocationId: ids.counter, toLocationId: ids.vault, pieceIds: [ids.a] });
    expect(inside.body.status).toBe('received');
    expect((await piece(ids.a)).location_id).toBe(ids.vault);

    const out = await call('/api/stock/transfers', {
      fromLocationId: ids.vault, toLocationId: ids.surat, pieceIds: [ids.a], lots: [{ itemId: ids.bulk, purityId: ids.k22, netWeight: '100' }],
    }, { as: storekeeper });
    expect(out.body.status).toBe('in_transit');
    expect((await piece(ids.a)).status).toBe('in_transit');
    expect(await lot(ids.vault)).toBe(900.5);
    expect((await call(`/api/stock/summary?branchId=${ids.branch2}`)).body.in_transit).toBe(1);

    const again = await call('/api/stock/transfers', { fromLocationId: ids.vault, toLocationId: ids.surat, pieceIds: [ids.a] });
    expect(again.body.error.code).toBe('piece_not_at_location');
    const tooMuch = await call('/api/stock/transfers', { fromLocationId: ids.vault, toLocationId: ids.surat, lots: [{ itemId: ids.bulk, purityId: ids.k22, netWeight: '5000' }] });
    expect(tooMuch.body.error.code).toBe('insufficient_stock');

    expect((await call(`/api/stock/transfers/${out.body.id}/receive`, {})).body.status).toBe('received');
    const moved = await piece(ids.a);
    expect([moved.status, moved.location_id]).toEqual(['in_stock', ids.surat]);
    expect(await lot(ids.surat)).toBe(100);
    expect((await call(`/api/stock/transfers/${out.body.id}/receive`, {})).body.error.code).toBe('transfer_not_in_transit');

    const back = await call('/api/stock/transfers', { fromLocationId: ids.surat, toLocationId: ids.vault, lots: [{ itemId: ids.bulk, purityId: ids.k22, netWeight: '40' }] });
    await call(`/api/stock/transfers/${back.body.id}/cancel`, {});
    expect(await lot(ids.surat)).toBe(100);
  });

  it('adjusts: damage writes a piece off, found adds lot weight; storekeeper cannot', async () => {
    const [c] = (await tag([ring()])).body.rows;
    expect((await call('/api/stock/adjustments', { reason: 'damage', note: 'Broken clasp', pieceIds: [c.id] }, { as: storekeeper })).status).toBe(403);
    const damaged = await call('/api/stock/adjustments', { reason: 'damage', note: 'Broken clasp', pieceIds: [c.id] });
    expect(damaged.status).toBe(201);
    expect((await piece(c.id)).status).toBe('written_off');
    const twice = await call('/api/stock/adjustments', { reason: 'damage', note: 'Again', pieceIds: [c.id] });
    expect(twice.body.error.code).toBe('piece_not_in_stock');

    await call('/api/stock/adjustments', { reason: 'found', note: 'Scale drawer', lots: [{ itemId: ids.bulk, purityId: ids.k22, locationId: ids.vault, netWeight: '0.500' }] });
    expect(await lot(ids.vault)).toBe(901);
    const mixed = await call('/api/stock/adjustments', { reason: 'loss', note: 'x x', lots: [
      { itemId: ids.bulk, purityId: ids.k22, locationId: ids.vault, netWeight: '1' },
      { itemId: ids.bulk, purityId: ids.k22, locationId: ids.surat, netWeight: '1' },
    ] });
    expect(mixed.body.error.code).toBe('adjustment_branches');
  });

  it('counts a location: found, missing, elsewhere, unknown and lot differences', async () => {
    const [here, gone, away] = (await tag([ring(), ring(), ring({ locationId: ids.vault })])).body.rows;
    await call('/api/stock/import/lots', { locationId: ids.counter, rows: [{ item_code: `BULK${run}`, purity: '22K', net_weight: '50' }] });

    const count = (await call('/api/stock/counts', { locationId: ids.counter }, { as: storekeeper })).body;
    expect(count.doc_number).toMatch(/^SC-/);
    expect((await call('/api/stock/counts', { locationId: ids.counter })).body.error.code).toBe('count_already_open');

    const scanned = (await call(`/api/stock/counts/${count.id}/scan`, { tags: [here.tag_number, away.tag_number, 'NOPE-1', here.tag_number] }, { as: storekeeper })).body.rows;
    expect(Object.fromEntries(scanned.map((r: Body) => [r.tag_number, r.outcome])))
      .toEqual({ [here.tag_number]: 'found', [away.tag_number]: 'elsewhere', 'NOPE-1': 'unknown' });
    const rescan = (await call(`/api/stock/counts/${count.id}/scan`, { tags: [here.tag_number] })).body.rows[0];
    expect(rescan.repeated).toBe(true);
    await call(`/api/stock/counts/${count.id}/lots`, { itemId: ids.bulk, purityId: ids.k22, netWeight: '49.200' }, { as: storekeeper });

    const result = (await call(`/api/stock/counts/${count.id}`)).body;
    expect(result.pieces.find((p: Body) => p.piece_id === gone.id).outcome).toBe('missing');
    expect(result.summary).toMatchObject({ found: 1, elsewhere: 1, unknown: 1, lotsWeighed: 1 });

    expect((await call(`/api/stock/counts/${count.id}/post`, { note: 'Monthly count' }, { as: storekeeper })).status).toBe(403);
    const posted = await call(`/api/stock/counts/${count.id}/post`, { note: 'Monthly count', writeOffMissing: true });
    expect(posted.body.status).toBe('posted');
    expect((await piece(gone.id)).status).toBe('written_off');
    expect((await piece(away.id)).location_id).toBe(ids.counter);
    expect(await lot(ids.counter)).toBe(49.2);
    expect((await call(`/api/stock/counts/${count.id}/scan`, { tags: ['X'] })).body.error.code).toBe('count_not_open');
  });

  it('balances always equal the journal', async () => {
    const snapshot = async () => asPlatform((tx) => tx.query(
      `select item_id, purity_id, location_id, quantity, net_weight, fine_weight, value from stock_balance
        where tenant_id = $1 and (quantity <> 0 or net_weight <> 0) order by 1, 2, 3`, [tenantId]));
    const before = await snapshot();
    expect((await call('/api/stock/balances/rebuild', {})).body.ok).toBe(true);
    expect(await snapshot()).toEqual(before);
    const summary = (await call(`/api/stock/summary?branchId=${main}`)).body;
    expect(summary.metals[0].metal).toBe('Gold');
  });
});
