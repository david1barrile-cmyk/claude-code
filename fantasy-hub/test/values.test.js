import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePickName, resolvePickValue, projectedOrder, tierForSlot } from '../lib/picks.js';
import { extractJsArray, parseCsv, normName, nameIndex } from '../lib/sources.js';
import { buildBoard, runMock, rookieReport } from '../lib/rookies.js';
import { compareSides } from '../lib/valuehub.js';

test('parsePickName understands KTC, DynastyProcess and FantasyCalc styles', () => {
  assert.deepEqual(parsePickName('2027 Mid 1st'), { season: 2027, round: 1, tier: 'mid', slot: null });
  assert.deepEqual(parsePickName('2027 Pick 1.05'), { season: 2027, round: 1, slot: 5, tier: null });
  assert.deepEqual(parsePickName('2028 2nd'), { season: 2028, round: 2, tier: null, slot: null });
  assert.deepEqual(parsePickName('2028 Round 3'), { season: 2028, round: 3, tier: null, slot: null });
  assert.equal(parsePickName('Justin Jefferson'), null);
});

test('resolvePickValue prefers exact slot, then tier, then generic, then nearest year', () => {
  const table = [
    { season: 2027, round: 1, slot: 1, value: 9000 }, { season: 2027, round: 1, tier: 'late', value: 4000 },
    { season: 2028, round: 1, tier: null, slot: null, value: 5000 },
  ];
  assert.equal(resolvePickValue(table, { season: 2027, round: 1, slot: 1 }, 12), 9000);
  assert.equal(resolvePickValue(table, { season: 2027, round: 1, slot: 11, tier: 'late' }, 12), 4000);
  assert.equal(resolvePickValue(table, { season: 2028, round: 1, slot: null, tier: 'mid' }, 12), 5000);
  assert.equal(resolvePickValue(table, { season: 2029, round: 1, slot: null, tier: 'mid' }, 12), 5000);
  assert.equal(resolvePickValue(table, { season: 2027, round: 4 }, 12), null);
});

test('projected draft order: worst record first, fewer points breaks ties', () => {
  const t = (rosterId, wins, pf) => ({ rosterId, wins, losses: 10 - wins, ties: 0, pf });
  assert.deepEqual(projectedOrder([t(1, 8, 1500), t(2, 3, 1400), t(3, 3, 1300)]), [3, 2, 1]);
  assert.equal(tierForSlot(1, 12), 'early'); assert.equal(tierForSlot(6, 12), 'mid'); assert.equal(tierForSlot(12, 12), 'late');
});

test('extractJsArray pulls the embedded KTC array, including brackets inside strings', () => {
  const html = '<script>var x=1; var playersArray = [{"playerName":"A [B]","v":[1,2]},{"playerName":"C\\"D"}];\nvar y=[];</script>';
  const arr = extractJsArray(html);
  assert.equal(arr.length, 2);
  assert.equal(arr[0].playerName, 'A [B]');
  assert.equal(extractJsArray('<html>nothing</html>'), null);
});

test('parseCsv handles quotes, commas and CRLF', () => {
  const rows = parseCsv('player,pos,value\r\n"Smith, Jr.",WR,10\r\n"Say ""Hi""",RB,5\r\n');
  assert.deepEqual(rows, [{ player: 'Smith, Jr.', pos: 'WR', value: '10' }, { player: 'Say "Hi"', pos: 'RB', value: '5' }]);
});

test('name matching ignores punctuation and suffixes', () => {
  assert.equal(normName('D.J. Moore'), normName('DJ Moore'));
  assert.equal(normName('Marvin Harrison Jr.'), 'marvin harrison');
  const find = nameIndex({ 1: { id: '1', name: 'Kenneth Walker III', pos: 'RB' }, 2: { id: '2', name: 'Mike Williams', pos: 'WR' }, 3: { id: '3', name: 'Mike Williams', pos: 'TE' } });
  assert.equal(find('Kenneth Walker', 'RB'), '1');
  assert.equal(find('Mike Williams', 'TE'), '3');
  assert.equal(find('Mike Williams', 'QB'), null); // ambiguous without position
});

const board = () => buildBoard({
  season: 2027,
  ktcRookies: [
    { name: 'Alpha Back', pos: 'RB', value: 8000, rank: 1, college: 'U' }, { name: 'Beta Wideout', pos: 'WR', value: 7600, rank: 2 },
    { name: 'Gamma Wideout', pos: 'WR', value: 5000, rank: 3 }, { name: 'Delta End', pos: 'TE', value: 3000, rank: 4 },
  ],
  dpRookies: [{ name: 'Beta Wideout', pos: 'WR', value: 9000, draftYear: 2027 }, { name: 'Alpha Back', pos: 'RB', value: 8000, draftYear: 2027 }, { name: 'Old Vet', pos: 'WR', value: 9999, draftYear: 2020 }],
});

test('buildBoard merges sources, scales to 100 and ignores other classes', () => {
  const b = board();
  assert.equal(b.length, 4);
  assert.equal(b[0].name, 'Beta Wideout'); // avg(95, 100) beats avg(100, 88.9)
  assert.ok(!b.some((r) => r.name === 'Old Vet'));
  assert.equal(b.find((r) => r.name === 'Gamma Wideout').posRank, 2);
});

test('mock draft: BPA follows the board, need mode reaches for a thin position', () => {
  const b = board();
  const picks = [{ owner: 1, label: '1.01', round: 1, slot: 1 }, { owner: 2, label: '1.02', round: 1, slot: 2 }];
  const bpa = runMock({ board: b, picks, needs: {}, mode: 'bpa' });
  assert.deepEqual(bpa.map((p) => p.player.name), ['Beta Wideout', 'Alpha Back']);
  const needs = { 1: { QB: 1, RB: 1, WR: 0.6, TE: 1.8 }, 2: { QB: 1, RB: 1, WR: 1, TE: 1 } };
  const need = runMock({ board: b, picks, needs, mode: 'need' });
  assert.equal(need[0].player.name, 'Alpha Back'); // team 1 is deep at WR
  assert.match(need[0].why, /deep at WR/);
});

test('rookieReport flags source disagreement on within-class ranks', () => {
  const r = { name: 'X', pos: 'WR', rank: 5, posRank: 2, sources: { KTC: { classRank: 2 }, DP: { classRank: 9 } } };
  assert.ok(rookieReport(r, null).outlook.some((x) => x.includes('KTC traders are higher')));
});

test('compareSides computes per-source edges and a consensus', () => {
  const hub = {
    sources: [{ short: 'KTC', name: 'KTC', ok: true }, { short: 'FC', name: 'FC', ok: true }, { short: 'DP', name: 'DP', ok: false }],
    teams: [
      { players: [{ id: 'a', name: 'A', pos: 'WR', values: { KTC: 5000, FC: 5000 } }], picks: [] },
      { players: [{ id: 'b', name: 'B', pos: 'RB', values: { KTC: 4000, FC: 6000 } }], picks: [{ key: '2027:1:2', label: '2027 1.02', slot: 2, orig: 2, owner: 2, values: { KTC: 1000, FC: null } }] },
    ],
  };
  const r = compareSides(hub, ['a'], ['b', '2027:1:2']);
  const ktc = r.perSource.find((p) => p.source === 'KTC'), fc = r.perSource.find((p) => p.source === 'FC');
  assert.equal(ktc.edgeA, 0); // 5000 vs 5000
  assert.equal(fc.edgeA, 17); // A receives 6000 for 5000
  assert.deepEqual(fc.missing, ['2027 1.02']);
  assert.equal(r.perSource.length, 2); // unavailable source excluded
  assert.equal(r.consensus, 9);
  assert.equal(r.verdict, 'Slight edge to side A');
});

import { summarizeSeason } from '../lib/history.js';
import { extractKtcPlayers } from '../lib/sources.js';
test('league-median games count toward the record', () => {
  const rosters = [1, 2, 3, 4].map((r) => ({ roster_id: r, owner_id: `o${r}` }));
  const s = summarizeSeason({
    league: { season: '2026', league_id: 'x', status: 'in_season', settings: { league_average_match: 1 } }, rosters, users: [], bracket: [],
    weeks: [[{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 90 }, { roster_id: 3, matchup_id: 2, points: 80 }, { roster_id: 4, matchup_id: 2, points: 70 }]],
  });
  const o = Object.fromEntries(s.standings.map((r) => [r.ownerId, r]));
  assert.deepEqual([o.o1.wins, o.o1.losses], [2, 0]); // beat opponent + above median
  assert.deepEqual([o.o2.wins, o.o2.losses], [1, 1]); // lost H2H, above median
  assert.deepEqual([o.o3.wins, o.o3.losses], [1, 1]);
  assert.deepEqual([o.o4.wins, o.o4.losses], [0, 2]);
});
test('KTC parser reads the JSON script tag and FantasyCalc pick names', () => {
  const html = '<script id="ktc-players" type="application/json">[{"playerName":"A"},{"playerName":"B"}]</script><script>var playersArray = JSON.parse(x);</script>';
  assert.equal(extractKtcPlayers(html).length, 2);
  assert.deepEqual(parsePickName('2027 1st (Early)'), { season: 2027, round: 1, tier: 'early', slot: null });
});

test('rookie report ignores a thin latest season and flags it', () => {
  const r = { name: 'X', pos: 'RB', rank: 10, posRank: 3, sources: {} };
  const college = { seasons: [
    { year: 2026, car: 4, rec: 0, rushYds: 45, recYds: 0, ypc: 11.3, dominator: 0.006 },
    { year: 2025, car: 256, rec: 6, rushYds: 1649, recYds: 22, ypc: 6.4, dominator: 0.33 },
  ] };
  const rep = rookieReport(r, college);
  assert.ok(rep.concerns.some((x) => x.startsWith('Limited 2026 sample')));
  assert.ok(rep.strengths.some((x) => x.includes('33% dominator rating in 2025')));
  assert.ok(!rep.strengths.some((x) => x.includes('11.3')));
});
