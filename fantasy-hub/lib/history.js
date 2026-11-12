// League history across seasons by following Sleeper's previous_league_id chain.
// Owners are tracked by user id (roster ids are per-season).
import { cached } from './cache.js';
import * as S from './sleeper.js';

const DAY = 24 * 3600e3;

export async function leagueChain(leagueId, max = 12) {
  const chain = [];
  let id = leagueId;
  while (id && id !== '0' && chain.length < max) {
    const l = await S.getLeague(id).catch(() => null);
    if (!l) break;
    chain.push(l);
    id = l.previous_league_id;
  }
  return chain; // newest first
}

async function seasonData(league, state) {
  const done = league.status === 'complete';
  const loader = async () => {
    const regEnd = (league.settings?.playoff_week_start || 15) - 1;
    const isCurrent = String(state.season) === String(league.season) && !done;
    const lastWeek = isCurrent ? Math.min(regEnd, Math.max(0, (Number(state.week) || 1) - 1)) : regEnd;
    const [rosters, users, bracket, ...weeks] = await Promise.all([
      S.getRosters(league.league_id), S.getLeagueUsers(league.league_id),
      S.getWinnersBracket(league.league_id).catch(() => []),
      ...Array.from({ length: lastWeek }, (_, i) => S.getMatchups(league.league_id, i + 1).catch(() => [])),
    ]);
    return { league, rosters, users, bracket: bracket || [], weeks };
  };
  // Finished seasons never change: cache them for a week on disk.
  return done ? cached(`hist:${league.league_id}`, 7 * DAY, loader, { disk: true }) : loader();
}

export function summarizeSeason({ league, rosters, users, bracket, weeks }) {
  const owner = Object.fromEntries(rosters.map((r) => [r.roster_id, r.owner_id || `roster${r.roster_id}`]));
  const st = {};
  const row = (o) => (st[o] ||= { ownerId: o, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, apW: 0, apL: 0, weekly: [], results: [] });
  rosters.forEach((r) => row(owner[r.roster_id]));
  const games = [];
  weeks.forEach((rows, wi) => {
    const week = wi + 1;
    const scored = (rows || []).filter((r) => r.matchup_id != null && (r.points ?? 0) > 0);
    if (!scored.length) return;
    for (const r of scored) {
      const me = row(owner[r.roster_id]);
      me.weekly.push({ week, pts: r.points });
      me.apW += scored.filter((x) => x.points < r.points).length;
      me.apL += scored.filter((x) => x.points > r.points).length;
    }
    // Leagues with "play the league median" add a second game each week vs the median score.
    if (league.settings?.league_average_match) {
      const pts = scored.map((r) => r.points).sort((a, b) => a - b);
      const mid = pts.length % 2 ? pts[(pts.length - 1) / 2] : (pts[pts.length / 2 - 1] + pts[pts.length / 2]) / 2;
      for (const r of scored) {
        const me = row(owner[r.roster_id]);
        if (r.points > mid) me.wins++; else if (r.points < mid) me.losses++; else me.ties++;
        me.medianW = (me.medianW || 0) + (r.points > mid ? 1 : 0);
      }
    }
    const byM = {};
    scored.forEach((r) => (byM[r.matchup_id] ||= []).push(r));
    for (const pair of Object.values(byM)) {
      if (pair.length !== 2) continue;
      const [a, b] = pair, A = row(owner[a.roster_id]), B = row(owner[b.roster_id]);
      A.pf += a.points; A.pa += b.points; B.pf += b.points; B.pa += a.points;
      const res = a.points > b.points ? 1 : a.points < b.points ? -1 : 0;
      if (res > 0) { A.wins++; B.losses++; } else if (res < 0) { A.losses++; B.wins++; } else { A.ties++; B.ties++; }
      A.results.push(res > 0 ? 'W' : res < 0 ? 'L' : 'T'); B.results.push(res < 0 ? 'W' : res > 0 ? 'L' : 'T');
      games.push({ season: league.season, week, a: A.ownerId, b: B.ownerId, ap: a.points, bp: b.points });
    }
  });
  const standings = Object.values(st).sort((x, y) => y.wins - x.wins || y.pf - x.pf);
  standings.forEach((s, i) => { s.regRank = i + 1; });

  // Final finish from the playoff bracket's placement games (p = place of winner).
  const place = {};
  for (const m of bracket) {
    if (m.p && m.w && m.l) { place[owner[m.w]] = m.p; place[owner[m.l]] = m.p + 1; }
  }
  const playoffTeams = new Set(bracket.flatMap((m) => [m.t1, m.t2]).filter((x) => typeof x === 'number').map((x) => owner[x]));
  const placed = Object.keys(place).length;
  standings.forEach((s) => {
    s.playoffs = playoffTeams.has(s.ownerId);
    s.finish = place[s.ownerId] ?? (placed ? null : s.regRank);
  });
  const unplaced = standings.filter((s) => s.finish == null);
  unplaced.forEach((s, i) => { s.finish = placed + 1 + i; });
  const champ = bracket.find((m) => m.p === 1 && m.w);
  return {
    season: league.season, leagueId: league.league_id, name: league.name, complete: league.status === 'complete',
    medianGames: !!league.settings?.league_average_match,
    champion: champ ? owner[champ.w] : null, runnerUp: champ ? owner[champ.l] : null,
    standings, games,
    users: Object.fromEntries(users.map((u) => [u.user_id, { name: u.metadata?.team_name || u.display_name, user: u.display_name, avatar: u.avatar }])),
  };
}

export function buildHistory(seasons) {
  const owners = {};
  const h2h = {};
  const records = { high: null, low: null, blowout: null, closest: null };
  const names = {};
  // Newest season's names win.
  for (const s of [...seasons].reverse()) Object.assign(names, s.users);
  for (const s of seasons) {
    for (const r of s.standings) {
      const o = (owners[r.ownerId] ||= { ownerId: r.ownerId, seasons: 0, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, apW: 0, apL: 0, titles: 0, runnerUps: 0, playoffs: 0, finishes: {} });
      o.seasons++; o.wins += r.wins; o.losses += r.losses; o.ties += r.ties; o.pf += r.pf; o.pa += r.pa;
      o.apW += r.apW; o.apL += r.apL; o.playoffs += r.playoffs ? 1 : 0;
      o.finishes[s.season] = r.finish;
      if (s.champion === r.ownerId) o.titles++;
      if (s.runnerUp === r.ownerId) o.runnerUps++;
      for (const w of r.weekly) {
        const rec = { ownerId: r.ownerId, season: s.season, week: w.week, pts: w.pts };
        if (!records.high || w.pts > records.high.pts) records.high = rec;
        if (!records.low || w.pts < records.low.pts) records.low = rec;
      }
    }
    for (const g of s.games) {
      const margin = Math.abs(g.ap - g.bp);
      const [win, lose, wp, lp] = g.ap >= g.bp ? [g.a, g.b, g.ap, g.bp] : [g.b, g.a, g.bp, g.ap];
      const rec = { season: g.season, week: g.week, winner: win, loser: lose, wp, lp, margin };
      if (!records.blowout || margin > records.blowout.margin) records.blowout = rec;
      if (!records.closest || margin < records.closest.margin) records.closest = rec;
      for (const [x, y, res] of [[g.a, g.b, Math.sign(g.ap - g.bp)], [g.b, g.a, Math.sign(g.bp - g.ap)]]) {
        const c = ((h2h[x] ||= {})[y] ||= { w: 0, l: 0, t: 0 });
        if (res > 0) c.w++; else if (res < 0) c.l++; else c.t++;
      }
    }
  }
  const list = Object.values(owners).map((o) => {
    const g = o.wins + o.losses + o.ties;
    const winPct = g ? (o.wins + o.ties / 2) / g : 0;
    const apPct = o.apW + o.apL ? o.apW / (o.apW + o.apL) : 0;
    return {
      ...o, ...(names[o.ownerId] || { name: o.ownerId }), winPct, apPct,
      luck: Math.round((winPct - apPct) * g * 10) / 10, // wins above all-play expectation
      pf: Math.round(o.pf * 10) / 10, pa: Math.round(o.pa * 10) / 10,
    };
  }).sort((a, b) => b.titles - a.titles || b.winPct - a.winPct);
  return {
    seasons: seasons.map(({ games, users, ...s }) => ({
      ...s, standings: s.standings.map(({ results, ...r }) => ({ ...r, form: results.slice(-5) })),
    })),
    owners: list, h2h, records, names,
  };
}

export function getHistory(leagueId) {
  return cached(`history:${leagueId}`, 10 * 60e3, async () => {
    const [state, chain] = await Promise.all([S.getState(), leagueChain(leagueId)]);
    const seasons = [];
    for (const l of chain) seasons.push(summarizeSeason(await seasonData(l, state)));
    return buildHistory(seasons); // seasons newest first
  });
}
