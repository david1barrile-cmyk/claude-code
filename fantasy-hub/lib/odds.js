// Monte Carlo season simulation: playoff odds and projected final standings.
// Each team's weekly score ~ Normal(mean, sd), where mean blends its best lineup today
// (rest-of-season form) with its average score so far, and sd comes from its own
// week-to-week variation. The remaining regular season is played on the real schedule,
// including the weekly game against the league median when the league uses it.
import { cached } from './cache.js';
import * as S from './sleeper.js';
import { summarizeSeason } from './history.js';
import { bestLineup, lineupInfo } from './lineup.js';

const SIMS = 10000;

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
const sd = (xs) => { if (xs.length < 2) return null; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };

/** Load what the simulation needs (cached per league). */
async function seasonInputs(ctx) {
  const id = ctx.league.league_id;
  const regEnd = (ctx.league.settings?.playoff_week_start || 15) - 1;
  const [rosters, users, ...weeks] = await Promise.all([
    S.getRosters(id), S.getLeagueUsers(id),
    ...Array.from({ length: regEnd }, (_, i) => S.getMatchups(id, i + 1).catch(() => [])),
  ]);
  return { rosters, users, weeks, regEnd };
}

/**
 * Simulate the rest of the regular season from the standings after `throughWeek`.
 * @returns {{teams: object[], throughWeek: number, remaining: number[]}}
 */
export function simulate({ league, rosters, users, weeks, regEnd, strength, throughWeek, sims = SIMS, seed = 1 }) {
  const summary = summarizeSeason({ league, rosters, users, bracket: [], weeks: weeks.slice(0, throughWeek) });
  const owners = summary.standings.map((s) => s.ownerId);
  const idx = Object.fromEntries(owners.map((o, i) => [o, i]));
  const rid2owner = Object.fromEntries(rosters.map((r) => [r.roster_id, r.owner_id || `roster${r.roster_id}`]));
  const n = owners.length;
  const base = summary.standings.map((s) => ({ w: s.wins + s.ties / 2, pf: s.pf }));
  const remaining = [];
  for (let w = throughWeek + 1; w <= regEnd; w++) {
    const byM = {};
    for (const r of weeks[w - 1] || []) if (r.matchup_id != null) (byM[r.matchup_id] ||= []).push(idx[rid2owner[r.roster_id]]);
    const pairs = Object.values(byM).filter((p) => p.length === 2 && p.every((x) => x != null));
    if (pairs.length) remaining.push({ week: w, pairs });
  }
  const median = !!league.settings?.league_average_match;
  const mu = owners.map((o) => strength[o]?.mean ?? 100), sig = owners.map((o) => strength[o]?.sd ?? 25);
  const spots = league.settings?.playoff_teams || Math.min(n, 4);
  const byes = spots === 6 ? 2 : spots === 12 ? 4 : 0;

  const finish = owners.map(() => new Array(n).fill(0));
  const madeFinal = new Array(n).fill(0), champs = new Array(n).fill(0);
  const winsDist = owners.map(() => []);
  const rand = rng(seed);
  const normal = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  const W = new Float64Array(n), PF = new Float64Array(n), sc = new Float64Array(n), order = owners.map((_, i) => i);
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) { W[i] = base[i].w; PF[i] = base[i].pf; }
    for (const { pairs } of remaining) {
      for (let i = 0; i < n; i++) { sc[i] = Math.max(0, mu[i] + sig[i] * normal()); PF[i] += sc[i]; }
      for (const [a, b] of pairs) { if (sc[a] > sc[b]) W[a]++; else W[b]++; }
      if (median) {
        const sorted = Array.from(sc).sort((x, y) => x - y);
        const m = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
        for (let i = 0; i < n; i++) if (sc[i] > m) W[i]++;
      }
    }
    order.sort((a, b) => W[b] - W[a] || PF[b] - PF[a]);
    order.forEach((t, place) => { finish[t][place]++; });
    // Playoffs: single-elimination on Sleeper's fixed bracket for the seeds.
    const play = (a, b) => (Math.max(0, mu[a] + sig[a] * normal()) >= Math.max(0, mu[b] + sig[b] * normal()) ? a : b);
    const seeds = order.slice(0, spots);
    let finalists;
    if (spots === 4) finalists = [play(seeds[0], seeds[3]), play(seeds[1], seeds[2])];
    else if (spots === 6) finalists = [play(seeds[0], play(seeds[3], seeds[4])), play(seeds[1], play(seeds[2], seeds[5]))];
    else if (spots === 8) finalists = [play(play(seeds[0], seeds[7]), play(seeds[3], seeds[4])), play(play(seeds[1], seeds[6]), play(seeds[2], seeds[5]))];
    else {
      // generic: byes to the top seeds, then reseed highest vs lowest each round
      let field = [...seeds];
      while (field.length > 2) {
        const size = 2 ** Math.floor(Math.log2(field.length));
        const byes = field.length === size ? 0 : 2 * size - field.length;
        const next = field.slice(0, byes), rest = field.slice(byes);
        for (let i = 0; i < rest.length / 2; i++) next.push(play(rest[i], rest[rest.length - 1 - i]));
        field = next.sort((x, y) => seeds.indexOf(x) - seeds.indexOf(y));
      }
      finalists = field;
    }
    for (const f of finalists) madeFinal[f]++;
    if (finalists.length === 2) champs[play(finalists[0], finalists[1])]++; else if (finalists.length === 1) champs[finalists[0]]++;
    for (let i = 0; i < n; i++) winsDist[i].push(W[i]);
  }
  const pct = (x) => Math.round((x / sims) * 1000) / 10;
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const gamesPerWeek = median ? 2 : 1;
  return {
    throughWeek, remaining: remaining.map((r) => r.week), spots, byes, sims, gamesTotal: (throughWeek + remaining.length) * gamesPerWeek,
    teams: owners.map((o, i) => {
      const wd = Float64Array.from(winsDist[i]).sort();
      const s = summary.standings[i];
      return {
        ownerId: o, wins: s.wins, losses: s.losses, ties: s.ties,
        playoffOdds: pct(finish[i].slice(0, spots).reduce((a, b) => a + b, 0)),
        byeOdds: byes ? pct(finish[i].slice(0, byes).reduce((a, b) => a + b, 0)) : null,
        firstOdds: pct(finish[i][0]),
        finalOdds: pct(madeFinal[i]), titleOdds: pct(champs[i]),
        finishDist: finish[i].map(pct),
        projWins: Math.round((wd.reduce((a, b) => a + b, 0) / sims) * 10) / 10,
        winsP10: q(wd, 0.1), winsP90: q(wd, 0.9),
        expectedFinish: Math.round((finish[i].reduce((a, c, k) => a + c * (k + 1), 0) / sims) * 10) / 10,
        strength: { mean: Math.round(mu[i] * 10) / 10, sd: Math.round(sig[i] * 10) / 10 },
      };
    }).sort((a, b) => a.expectedFinish - b.expectedFinish),
  };
}

/** Team scoring model: blend best lineup now with points-per-week so far. */
export function teamStrength(ctx, summary) {
  const info = lineupInfo(ctx.players, ctx.metrics);
  const out = {};
  for (const t of ctx.teams) {
    const s = summary.standings.find((x) => x.ownerId === t.ownerId);
    const scores = (s?.weekly || []).map((w) => w.pts);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const lineup = bestLineup(t.ids, info, ctx.slots).total;
    const weight = Math.min(1, scores.length / 8) * 0.5; // trust results more as the season goes on
    const mean = avg == null ? lineup : (1 - weight) * lineup + weight * avg;
    const spread = sd(scores);
    out[t.ownerId] = { mean, sd: spread ? Math.max(spread, mean * 0.08) : mean * 0.15 };
  }
  return out;
}

export function getOdds(ctx, { throughWeek } = {}) {
  const tw = throughWeek ?? ctx.completedWeeks.length;
  return cached(`odds:${ctx.league.league_id}:${tw}`, 30 * 60e3, async () => {
    const inputs = await seasonInputs(ctx);
    const summary = summarizeSeason({ league: ctx.league, rosters: inputs.rosters, users: inputs.users, bracket: [], weeks: inputs.weeks.slice(0, ctx.completedWeeks.length) });
    const strength = teamStrength(ctx, summary);
    const res = simulate({ league: ctx.league, ...inputs, strength, throughWeek: Math.min(tw, inputs.regEnd), seed: hash(`${ctx.league.league_id}:${tw}`) });
    const names = Object.fromEntries(ctx.teams.map((t) => [t.ownerId, t]));
    res.teams = res.teams.map((t) => ({ ...t, name: names[t.ownerId]?.name ?? t.ownerId, rosterId: names[t.ownerId]?.rosterId, avatar: names[t.ownerId]?.avatar ?? null }));
    return res;
  });
}
