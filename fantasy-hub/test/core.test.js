import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePoints, buildMetrics } from '../lib/metrics.js';
import { startingSlots, bestLineup } from '../lib/lineup.js';
import { waiverAdvice, evaluateTrade } from '../lib/advice.js';
import { parseFeed, mentions } from '../lib/feeds.js';
import { weeksToLoad } from '../lib/league.js';

test('scorePoints applies league scoring and falls back to presets', () => {
  assert.equal(scorePoints({ rec: 5, rec_yd: 60, rec_td: 1 }, { rec: 1, rec_yd: 0.1, rec_td: 6 }), 17);
  assert.equal(scorePoints({ rec: 5, rec_yd: 60 }, { rec: 0.5, rec_yd: 0.1 }), 8.5);
  assert.equal(scorePoints({ pts_half_ppr: 12.3 }, { rec: 0.5 }), 12.3);
});

test('buildMetrics computes shares, trend and WOPR', () => {
  const players = { a: { pos: 'WR', team: 'X' }, b: { pos: 'WR', team: 'X' } };
  const wk = (ta, tb) => ({ a: { gp: 1, off_snp: 60, tm_off_snp: 60, rec_tgt: ta, rec: ta, rec_yd: 10 * ta, rec_air_yd: 10 * ta }, b: { gp: 1, off_snp: 30, tm_off_snp: 60, rec_tgt: tb, rec: tb, rec_yd: 10 * tb, rec_air_yd: 10 * tb } });
  const weeks = [1, 2, 3, 4].map((w) => ({ week: w, stats: wk(w === 4 ? 9 : 6, w === 4 ? 1 : 4) }));
  const m = buildMetrics({ players, weeks, scoring: { rec: 1, rec_yd: 0.1 } });
  assert.equal(m.a.games, 4);
  assert.equal(m.a.snapShare, 1);
  assert.equal(m.b.snapShare, 0.5);
  assert.equal(m.a.tgtShare, 0.675); // 27 of 40
  assert.ok(m.a.wopr > 1);
  assert.ok(m.a.trend > 0 && m.b.trend < 0);
});

test('bestLineup fills restrictive slots before flex', () => {
  const slots = startingSlots(['FLEX', 'RB', 'WR', 'BN', 'BN']);
  assert.deepEqual(slots, ['RB', 'WR', 'FLEX']);
  const info = { r1: ['RB', 20], r2: ['RB', 15], w1: ['WR', 18], w2: ['WR', 5] };
  const L = bestLineup(Object.keys(info), (id) => ({ pos: info[id][0], pts: info[id][1] }), slots);
  assert.equal(L.total, 53);
  assert.equal(L.lineup.find((s) => s.slot === 'FLEX').id, 'r2');
});

const P = { q: { pos: 'QB' }, r1: { pos: 'RB' }, r2: { pos: 'RB' }, w1: { pos: 'WR' }, w2: { pos: 'WR' }, fa: { pos: 'WR' }, x: { pos: 'RB' } };
const M = { q: { ros: 20 }, r1: { ros: 15 }, r2: { ros: 4 }, w1: { ros: 12 }, w2: { ros: 3 }, fa: { ros: 11 }, x: { ros: 14 } };
const slots = ['QB', 'RB', 'WR', 'FLEX'];

test('waiverAdvice ranks free agents by lineup gain and picks a drop', () => {
  const r = waiverAdvice({ players: P, metrics: M, slots, myIds: ['q', 'r1', 'r2', 'w1', 'w2'], rosteredIds: new Set(['q', 'r1', 'r2', 'w1', 'w2', 'x']), trendingAdds: [{ player_id: 'fa', count: 500 }] });
  assert.equal(r.recs[0].id, 'fa');
  assert.equal(r.recs[0].gain, 7); // replaces the 4-pt flex
  assert.equal(r.drop.id, 'w2');
  assert.ok(!r.recs.some((x) => x.id === 'x'), 'rostered players are excluded');
});

test('evaluateTrade reports lineup deltas and value fairness', () => {
  const r = evaluateTrade({ players: P, metrics: M, values: { w2: { value: 300 }, x: { value: 110 } }, slots,
    mineIds: ['q', 'r1', 'r2', 'w1', 'w2'], theirIds: ['x', 'fa'], give: ['w2'], get: ['x'] });
  assert.equal(r.you.delta, 10); // 14-pt RB replaces the 4-pt flex
  assert.equal(r.fairness, -63);
  assert.ok(r.verdict.startsWith('Lineup upgrade, but'));
});

test('parseFeed handles RSS and YouTube Atom', () => {
  const rss = '<rss><channel><item><title><![CDATA[Star &amp; Co]]></title><link>https://x/1</link><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hi&lt;/p&gt;</description></item></channel></rss>';
  const [a] = parseFeed(rss, 'S');
  assert.equal(a.title, 'Star & Co');
  assert.equal(a.summary, 'Hi');
  assert.equal(a.published, '2026-11-10T10:00:00.000Z');
  const atom = '<feed><entry><yt:videoId>abc</yt:videoId><title>Joe Back highlights</title><link rel="alternate" href="https://yt/abc"/><published>2026-11-01T00:00:00Z</published></entry></feed>';
  const [v] = parseFeed(atom, 'YT');
  assert.equal(v.link, 'https://yt/abc');
  assert.match(v.image, /abc/);
  assert.equal(mentions([a, v], 'Joe Back').length, 1);
});

test('weeksToLoad covers in-season, preseason and past seasons', () => {
  assert.deepEqual(weeksToLoad({ season: '2026', week: 4, season_type: 'regular' }, '2026'), { completed: [1, 2, 3], next: 4 });
  assert.deepEqual(weeksToLoad({ season: '2026', week: 0, season_type: 'pre' }, '2026'), { completed: [], next: 1 });
  assert.equal(weeksToLoad({ season: '2026', week: 1, season_type: 'regular' }, '2025').completed.length, 18);
});
