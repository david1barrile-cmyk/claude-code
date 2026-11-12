// End-to-end API smoke test against the built-in mock data (no network).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.MOCK = '1';
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-'));
const { server } = await import('../server.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}/api`; r(); })));
after(() => server.close());
const get = async (p, opts) => { const r = await fetch(base + p, opts); return { status: r.status, body: await r.json() }; };

test('username → leagues → league overview', async () => {
  const u = await get('/user/demo/leagues');
  assert.equal(u.body.leagues[0].id, '9001');
  assert.equal((await get('/user/nobody/leagues')).status, 404);
  const l = await get('/league/9001');
  assert.equal(l.body.teams.length, 12);
  assert.equal(l.body.format, 'PPR');
});

test('team, waivers, trades, metrics, player, news', async () => {
  const t = await get('/league/9001/team/u1');
  assert.ok(t.body.optimal.total > 50);
  const w = await get('/league/9001/waivers?owner=u1');
  assert.ok(w.body.recs.length > 0 && w.body.recs.every((r) => r.why.length));
  const s = await get('/league/9001/trades/suggest?owner=u1');
  assert.ok(s.body.suggestions.every((x) => x.myDelta > 0 && x.theirDelta >= 0));
  const ev = await get('/league/9001/trades/evaluate', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner: 'u1', partner: s.body.suggestions[0].rosterId, give: s.body.suggestions[0].give.map((p) => p.id), get: s.body.suggestions[0].get.map((p) => p.id) }) });
  assert.equal(ev.body.you.delta, s.body.suggestions[0].myDelta);
  const m = await get('/league/9001/metrics?pos=WR');
  assert.ok(m.body.rows[0].tgtShare > 0);
  const p = await get(`/league/9001/player/${m.body.rows[0].id}`);
  assert.ok(p.body.report.outlook.length);
  const n = await get('/news');
  assert.ok(n.body.items.length > 0 && n.body.status.every((x) => x.ok));
  const tx = await get('/league/9001/transactions');
  assert.equal(new Set(tx.body.map((x) => x.at + x.adds[0]?.id)).size, tx.body.length);
});
