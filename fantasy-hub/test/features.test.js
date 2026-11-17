// Season Wrapped, Rivalry, Draft re-grades, Awards: unit checks plus mock-API smoke tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.MOCK = '1';
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-'));
const { server } = await import('../server.js');
const { gradeDraft } = await import('../lib/draftgrades.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}/api`; r(); })));
after(() => server.close());
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };

test('gradeDraft: steals beat their slot, busts trail it, grades follow surplus', () => {
  const picks = [
    { pickNo: 1, playerId: 'a', ownerId: 'o1', team: 'One', label: '1.01' },
    { pickNo: 2, playerId: 'b', ownerId: 'o2', team: 'Two', label: '1.02' },
    { pickNo: 3, playerId: 'c', ownerId: 'o1', team: 'One', label: '1.03' },
    { pickNo: 4, playerId: 'd', ownerId: 'o2', team: 'Two', label: '1.04' },
  ];
  const vals = { a: 1000, b: 200, c: 100, d: 5000 };
  const g = gradeDraft(picks, (id) => vals[id]);
  assert.equal(g.redraft[0].playerId, 'd');
  assert.equal(g.steals[0].playerId, 'd');
  assert.equal(g.steals[0].redraftPick, 1);
  assert.ok(g.busts.some((r) => r.playerId === 'b'));
  assert.equal(g.teams[0].team, 'Two');
  assert.ok(g.teams[0].pct > 0 && g.teams[1].pct < 0);
  // Unvalued players count as zero rather than crashing.
  assert.equal(gradeDraft(picks, () => null).teams.length, 2);
});

test('wrapped: every team gets a season summary', async () => {
  const { status, body } = await get('/league/9001/wrapped');
  assert.equal(status, 200);
  assert.equal(body.teams.length, 12);
  for (const t of body.teams) {
    assert.ok(t.team && t.record && t.pf >= 0);
    assert.ok(t.benchTotal >= 0);
  }
  assert.ok(body.teams.some((t) => t.mvp && t.bestWeek));
});

test('rivalry: records add up and both sides are described', async () => {
  const lg = (await get('/league/9001')).body;
  const [a, b] = lg.teams.map((t) => t.ownerId);
  const { status, body } = await get(`/league/9001/rivalry?a=${a}&b=${b}`);
  assert.equal(status, 200);
  assert.equal(body.record.a + body.record.b + body.record.ties, body.games.length);
  assert.equal(body.a.ownerId, a);
  assert.equal(body.b.ownerId, b);
  for (const g of body.games) assert.equal(g.winner === 'a', g.aPts > g.bPts);
  assert.equal((await get('/league/9001/rivalry?a=' + a)).status, 400);
});

test('drafts and awards respond', async () => {
  const d = await get('/league/9001/drafts');
  assert.equal(d.status, 200);
  assert.ok(Array.isArray(d.body.drafts));
  const w = await get('/league/9001/awards');
  assert.equal(w.status, 200);
  assert.ok(w.body.awards.length >= 5);
  assert.ok(w.body.awards.every((x) => x.title && x.team && x.blurb));
  const keys = w.body.awards.map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('pitch decks: every trade in history, from either side', async () => {
  const idx = await get('/league/9001/decks');
  assert.equal(idx.status, 200);
  assert.ok(Array.isArray(idx.body.trades));
  for (const t of idx.body.trades.slice(0, 5)) {
    for (const s of t.sides) {
      const { status, body: d } = await get(`/league/9001/deck/${t.id}?owner=${s.ownerId}`);
      assert.equal(status, 200);
      assert.equal(d.presenter.ownerId, s.ownerId);
      assert.ok(d.title && d.disclaimers.length === 5 && d.rationale.cols.length >= 1);
      assert.equal(d.transaction.received.length, s.count);
      assert.ok(d.coverage && typeof d.coverage.edge === 'number');
      if (d.scoreboard) assert.ok(d.scoreboard.holdings.length && d.scoreboard.original.length);
    }
  }
  assert.equal((await get('/league/9001/deck/123')).status, 404);
});
