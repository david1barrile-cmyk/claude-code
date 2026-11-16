import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../lib/odds.js';

const rosters = [1, 2, 3, 4].map((r) => ({ roster_id: r, owner_id: `o${r}` }));
const wk = (pairs, pts) => pairs.flatMap(([a, b], m) => [{ roster_id: a, matchup_id: m + 1, points: pts?.[a - 1] ?? 0 }, { roster_id: b, matchup_id: m + 1, points: pts?.[b - 1] ?? 0 }]);
const sched = [[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[1, 4], [2, 3]]];
const league = { settings: { playoff_teams: 2 } };

test('season simulation: probabilities are consistent and repeatable', () => {
  // Week 1 played (1 and 3 win); weeks 2-3 to simulate.
  const weeks = [wk(sched[0], [120, 90, 110, 80]), wk(sched[1]), wk(sched[2])];
  const strength = { o1: { mean: 130, sd: 15 }, o2: { mean: 90, sd: 15 }, o3: { mean: 110, sd: 15 }, o4: { mean: 85, sd: 15 } };
  const args = { league, rosters, users: [], weeks, regEnd: 3, strength, throughWeek: 1, sims: 4000, seed: 7 };
  const a = simulate(args), b = simulate(args);
  assert.deepEqual(a, b);
  assert.deepEqual(a.remaining, [2, 3]);
  for (const t of a.teams) {
    assert.ok(Math.abs(t.finishDist.reduce((x, y) => x + y, 0) - 100) < 0.5);
    assert.ok(t.playoffOdds >= 0 && t.playoffOdds <= 100);
    assert.ok(t.winsP10 <= t.projWins && t.projWins <= t.winsP90);
  }
  const o1 = a.teams.find((t) => t.ownerId === 'o1'), o4 = a.teams.find((t) => t.ownerId === 'o4');
  assert.ok(o1.playoffOdds > 80 && o4.playoffOdds < 20);
  assert.equal(a.teams.reduce((s, t) => s + t.playoffOdds, 0).toFixed(0), '200'); // 2 spots
});

test('median games add a second result each week', () => {
  const weeks = [wk(sched[0], [120, 90, 110, 80]), wk(sched[1]), wk(sched[2])];
  const strength = Object.fromEntries(rosters.map((r) => [r.owner_id, { mean: 100, sd: 10 }]));
  const res = simulate({ league: { settings: { playoff_teams: 2, league_average_match: 1 } }, rosters, users: [], weeks, regEnd: 3, strength, throughWeek: 1, sims: 500, seed: 3 });
  assert.equal(res.gamesTotal, 6);
  const o1 = res.teams.find((t) => t.ownerId === 'o1');
  assert.equal(o1.wins, 2); // H2H win + above-median win in week 1
});
