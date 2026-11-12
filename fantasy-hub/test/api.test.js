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
  assert.equal(l.body.format, 'PPR · Dynasty');
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

test('history, power rankings and weekly series', async () => {
  const h = await get('/league/9001/history');
  assert.equal(h.body.seasons.length, 3);
  assert.deepEqual(h.body.seasons.map((s) => s.complete), [false, true, true]);
  assert.ok(h.body.seasons[1].champion);
  const champ = h.body.seasons[1].standings.find((s) => s.ownerId === h.body.seasons[1].champion);
  assert.equal(champ.finish, 1);
  assert.equal(h.body.owners.reduce((s, o) => s + o.titles, 0), 2);
  assert.ok(h.body.records.high.pts > h.body.records.low.pts);
  // h2h is symmetric
  const [a, b] = h.body.owners.map((o) => o.ownerId);
  const ab = h.body.h2h[a]?.[b], ba = h.body.h2h[b]?.[a];
  if (ab) assert.equal(ab.w, ba.l);

  const p = await get('/league/9001/power');
  assert.equal(p.body.season.length, 12);
  assert.ok(p.body.season.every((t, i) => i === 0 || p.body.season[i - 1].score >= t.score));
  assert.ok(p.body.dynasty.teams.every((t) => t.projected.length === 4 && t.picks.length > 0));
  // A team that acquired another team's 2027 1st owns two of them.
  const t1 = p.body.dynasty.teams.find((t) => t.rosterId === 1);
  assert.equal(t1.picks.filter((x) => x.season === 2027 && x.round === 1).length, 2);

  const w = await get('/league/9001/weekly');
  assert.equal(w.body.weeks.length, 10);
  const mu = await get('/league/9001/matchups');
  assert.ok(mu.body.matchups.every(([x, y]) => x.winProb + y.winProb === 100));
});

test('site password gate', async () => {
  const { config } = await import('../config.js');
  config.sitePassword = 'hunter2';
  try {
    assert.equal((await fetch(base + '/league/9001')).status, 401);
    assert.equal((await fetch(base + '/health')).status, 200);
    const ok = await fetch(base + '/league/9001', { headers: { authorization: 'Basic ' + Buffer.from('x:hunter2').toString('base64') } });
    assert.equal(ok.status, 200);
  } finally { config.sitePassword = null; }
});
