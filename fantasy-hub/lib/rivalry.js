// Rivalry pages: everything between two teams, all-time.
import * as S from './sleeper.js';
import { getHistory } from './history.js';
import { gradeLeagueTrades } from './tradegrades.js';
import { getOdds } from './odds.js';
import { getPersonas, quoteFor } from './personas.js';

const r1 = (x) => Math.round(x * 10) / 10;

export async function getRivalry(ctx, a, b) {
  const id = ctx.league.league_id;
  const [hist, trades, odds, cast] = await Promise.all([
    getHistory(id), gradeLeagueTrades(ctx).catch(() => []), getOdds(ctx).catch(() => null), getPersonas(ctx).catch(() => null),
  ]);
  const team = (o) => ctx.teams.find((t) => t.ownerId === o);
  const name = (o) => team(o)?.name ?? hist.names[o]?.name ?? o;
  const games = hist.games.filter((g) => (g.a === a && g.b === b) || (g.a === b && g.b === a))
    .map((g) => {
      const aPts = g.a === a ? g.ap : g.bp, bPts = g.a === a ? g.bp : g.ap;
      return { season: g.season, week: g.week, aPts, bPts, margin: r1(aPts - bPts), winner: aPts > bPts ? 'a' : aPts < bPts ? 'b' : 'tie' };
    })
    .sort((x, y) => Number(x.season) - Number(y.season) || x.week - y.week);
  const aw = games.filter((g) => g.winner === 'a').length, bw = games.filter((g) => g.winner === 'b').length, ties = games.length - aw - bw;
  let streak = null;
  for (let i = games.length - 1; i >= 0; i--) {
    const w = games[i].winner;
    if (!streak) streak = { who: w, n: 1 }; else if (w === streak.who) streak.n++; else break;
  }
  const byMargin = [...games].sort((x, y) => y.margin - x.margin);
  const bySeason = {};
  for (const g of games) { const s = (bySeason[g.season] ||= { season: g.season, a: 0, b: 0, t: 0 }); s[g.winner === 'tie' ? 't' : g.winner]++; }

  // Next scheduled meeting this season.
  let next = null;
  const regEnd = (ctx.league.settings?.playoff_week_start || 15) - 1;
  if (ctx.currentWeek) {
    const ra = team(a)?.rosterId, rb = team(b)?.rosterId;
    for (let w = ctx.currentWeek; w <= regEnd && !next; w++) {
      const rows = await S.getMatchups(id, w).catch(() => []);
      const ma = rows.find((r) => r.roster_id === ra)?.matchup_id;
      if (ma != null && rows.find((r) => r.roster_id === rb)?.matchup_id === ma) next = { week: w };
    }
  }
  const between = trades.filter((t) => t.sides.some((s) => s.team === name(a)) && t.sides.some((s) => s.team === name(b)))
    .map((t) => ({ id: t.id, week: t.week, offseason: t.offseason, at: t.at, verdict: t.verdict, teamsCount: t.teamsCount,
      a: t.sides.find((s) => s.team === name(a)), b: t.sides.find((s) => s.team === name(b)) }))
    .map((t) => ({ ...t, a: { grade: t.a.grade, received: t.a.received.map((x) => x.label) }, b: { grade: t.b.grade, received: t.b.received.map((x) => x.label) } }));
  const pa = cast?.personas[a], pb = cast?.personas[b];
  const leader = aw > bw ? 'a' : bw > aw ? 'b' : null;
  const side = (o, p, me) => {
    const t = team(o), ow = hist.owners.find((x) => x.ownerId === o), od = odds?.teams.find((x) => x.ownerId === o);
    return {
      ownerId: o, team: name(o), avatar: t?.avatar ?? hist.names[o]?.avatar ?? null, record: t ? `${t.wins}-${t.losses}` : null,
      allTime: ow ? `${ow.wins}-${ow.losses}${ow.ties ? `-${ow.ties}` : ''}` : null, titles: ow?.titles ?? 0,
      playoffOdds: od?.playoffOdds ?? null, titleOdds: od?.titleOdds ?? null,
      persona: p ? { nickname: p.nickname, voiceLabel: p.voiceLabel, catchphrase: p.catchphrase } : null,
      // Trash talk in persona voice: the series leader gloats, the trailer copes.
      trashTalk: p ? quoteFor(p, leader === me ? 'blowoutWin' : leader ? 'cold' : 'win', `rivalry:${a}:${b}`) : null,
    };
  };
  return {
    a: side(a, pa, 'a'), b: side(b, pb, 'b'),
    record: { a: aw, b: bw, ties, games: games.length },
    streak: streak && streak.who !== 'tie' ? { team: streak.who === 'a' ? name(a) : name(b), n: streak.n } : null,
    avgMargin: games.length ? r1(games.reduce((s, g) => s + g.margin, 0) / games.length) : 0,
    biggestA: byMargin[0]?.margin > 0 ? byMargin[0] : null,
    biggestB: byMargin.at(-1)?.margin < 0 ? byMargin.at(-1) : null,
    closest: [...games].filter((g) => g.winner !== 'tie').sort((x, y) => Math.abs(x.margin) - Math.abs(y.margin))[0] ?? null,
    bySeason: Object.values(bySeason), games, trades: between, next,
    personaRivals: { a: pa?.rival === name(b), b: pb?.rival === name(a) },
  };
}
