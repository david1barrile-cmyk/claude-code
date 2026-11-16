import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.MOCK = '1';
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-tg-'));
const { getLeagueContext } = await import('../lib/league.js');
const { gradeLeagueTrades, gradeScore, letter } = await import('../lib/tradegrades.js');
const { getEdition } = await import('../lib/gazette.js');

let ctx;
before(async () => { ctx = await getLeagueContext('9001'); });

test('grade scale: even trade is a B, big wins and losses move it', () => {
  assert.equal(letter(gradeScore({ edge: 0, lineupDelta: 0, ageGain: 0, contender: true })), 'B');
  assert.match(letter(gradeScore({ edge: 30, lineupDelta: 3, ageGain: 0, contender: true })), /^A/);
  assert.match(letter(gradeScore({ edge: -35, lineupDelta: -2, ageGain: 0, contender: true })), /^[DF]/);
  assert.ok(gradeScore({ edge: 0, futureShift: 0.5, contender: false }) > gradeScore({ edge: 0, futureShift: 0.5, contender: true }));
  // Contenders care about points now; rebuilders about youth.
  const now = { edge: 0, lineupDelta: 4, ageGain: -3 };
  assert.ok(gradeScore({ ...now, contender: true }) > gradeScore({ ...now, contender: false }));
});

test('league trades get report cards for both sides', async () => {
  const trades = await gradeLeagueTrades(ctx);
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.equal(t.week, 9);
  assert.equal(t.sides.length, 2);
  const [a, b] = t.sides;
  assert.equal(a.received.length, 2); // a player and the 2027 1st
  assert.ok(a.received.some((x) => x.kind === 'pick' && x.values.KTC > 0));
  assert.equal(b.faabIn, 5);
  assert.ok(Math.sign(a.edge) === -Math.sign(b.edge) || (a.edge === 0 && b.edge === 0));
  assert.ok(a.grade && b.grade && typeof a.lineupDelta === 'number');
  assert.ok(t.notes.length >= 1);
});

test('the Gazette trade desk covers that week with fixed grades', async () => {
  const ed9 = await getEdition(ctx, 9, {});
  assert.equal(ed9.tradeDesk.length, 1);
  assert.ok(ed9.tradeDesk[0].headline && ed9.tradeDesk[0].body);
  assert.equal(ed9.tradeDesk[0].card.sides.length, 2);
  const ed8 = await getEdition(ctx, 8, {});
  assert.equal(ed8.tradeDesk.length, 0);
  // AI text is used only when it lines up one-to-one with the graded trades.
  const ai = async () => ({ generator: 'claude', lead: { kicker: 'k', headline: 'h', body: 'b' }, stories: [], briefs: [], lookahead: [], tradeDesk: [{ headline: 'AI desk', body: 'AI body' }] });
  const edAi = await getEdition(ctx, 9, { aiWriter: ai });
  assert.equal(edAi.tradeDesk[0].headline, 'AI desk');
  assert.equal(edAi.tradeDesk[0].card.sides[0].grade, ed9.tradeDesk[0].card.sides[0].grade);
});
