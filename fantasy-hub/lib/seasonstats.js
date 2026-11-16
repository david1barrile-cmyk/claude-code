// Per-team season story for Season Wrapped and the Gazette awards issue: best and worst
// weeks, MVP, worst lineup call, best waiver pickup, best and worst trades, luck, outlook.
import { cached } from './cache.js';
import * as S from './sleeper.js';
import { bestLineup, SLOT_ELIGIBILITY } from './lineup.js';
import { getHistory } from './history.js';
import { gradeLeagueTrades } from './tradegrades.js';
import { getOdds } from './odds.js';
import { getPersonas } from './personas.js';

const r1 = (x) => Math.round(x * 10) / 10;

export function getSeasonStats(ctx) {
  return cached(`seasonstats:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const id = ctx.league.league_id;
    const weeks = ctx.completedWeeks;
    const [rosters, hist, trades, odds, cast, ...rest] = await Promise.all([
      S.getRosters(id), getHistory(id).catch(() => null), gradeLeagueTrades(ctx).catch(() => []),
      getOdds(ctx).catch(() => null), getPersonas(ctx).catch(() => null),
      ...weeks.map((w) => S.getMatchups(id, w).catch(() => [])),
      ...weeks.map((w) => S.getTransactions(id, w).catch(() => [])),
    ]);
    const matchups = rest.slice(0, weeks.length), txs = rest.slice(weeks.length).flat();
    const rid2owner = Object.fromEntries(rosters.map((r) => [r.roster_id, r.owner_id]));
    const pname = (pid) => ctx.players[pid]?.name ?? `Player ${pid}`;
    const ppos = (pid) => ctx.players[pid]?.pos ?? '?';
    const T = {};
    for (const t of ctx.teams) {
      T[t.ownerId] = { ownerId: t.ownerId, rosterId: t.rosterId, team: t.name, avatar: t.avatar, record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
        wins: t.wins, losses: t.losses, pf: r1(t.pf), weeks: [], starts: {}, benchTotal: 0, worstCall: null, adds: [], faab: 0 };
    }
    weeks.forEach((w, wi) => {
      const rows = (matchups[wi] || []).filter((r) => r.matchup_id != null);
      for (const r of rows) {
        const st = T[rid2owner[r.roster_id]];
        if (!st) continue;
        const pp = r.players_points || {};
        const opp = rows.find((x) => x.matchup_id === r.matchup_id && x !== r);
        st.weeks.push({ week: w, pts: r1(r.points || 0), opp: opp ? T[rid2owner[opp.roster_id]]?.team : null, oppPts: opp ? r1(opp.points || 0) : null });
        for (const pid of r.starters || []) {
          if (!pid || pid === '0') continue;
          const s = (st.starts[pid] ||= { pid, games: 0, pts: 0 });
          s.games++; s.pts += pp[pid] ?? 0;
        }
        // Lineup decisions: points left on the bench, and the single worst sit/start call.
        const best = bestLineup(r.players || [], (pid) => ({ pos: ppos(pid), pts: pp[pid] ?? 0 }), ctx.slots).total;
        const left = Math.max(0, best - (r.points || 0));
        st.benchTotal += left;
        const starters = new Set(r.starters || []);
        const benched = (r.players || []).filter((pid) => !starters.has(pid) && !(r.reserve || []).includes(pid));
        for (const b of benched) {
          const bp = pp[b] ?? 0;
          // the weakest starter this bench player could have replaced (same eligible slot family)
          const worse = (r.starters || []).filter((s) => s && s !== '0' && (pp[s] ?? 0) < bp && Object.values(SLOT_ELIGIBILITY).some((el) => el.includes(ppos(s)) && el.includes(ppos(b))))
            .sort((a, c) => (pp[a] ?? 0) - (pp[c] ?? 0))[0];
          if (!worse) continue;
          const cost = bp - (pp[worse] ?? 0);
          if (!st.worstCall || cost > st.worstCall.cost) st.worstCall = { week: w, cost: r1(cost), benched: { name: pname(b), pos: ppos(b), pts: r1(bp) }, started: { name: pname(worse), pos: ppos(worse), pts: r1(pp[worse] ?? 0) } };
        }
      }
    });
    // Waiver pickups: points they scored as starters for the team after being added.
    for (const t of txs) {
      if (t.status !== 'complete' || t.type === 'trade') continue;
      for (const [pid, rid] of Object.entries(t.adds || {})) {
        const st = T[rid2owner[rid]];
        if (!st) continue;
        st.faab += t.settings?.waiver_bid || 0;
        st.adds.push({ pid, week: t.leg, faab: t.settings?.waiver_bid ?? null });
      }
    }
    const cur = hist?.seasons.find((s) => String(s.season) === String(ctx.league.season));
    const out = Object.values(T).map((st) => {
      const ws = st.weeks;
      const best = [...ws].sort((a, b) => b.pts - a.pts)[0] ?? null, worst = [...ws].sort((a, b) => a.pts - b.pts)[0] ?? null;
      const wins = ws.filter((w) => w.oppPts != null && w.pts > w.oppPts), losses = ws.filter((w) => w.oppPts != null && w.pts < w.oppPts);
      const biggestWin = wins.sort((a, b) => (b.pts - b.oppPts) - (a.pts - a.oppPts))[0] ?? null;
      const toughestLoss = losses.sort((a, b) => (b.pts - b.oppPts) - (a.pts - a.oppPts))[0] ?? null; // closest loss
      const starts = Object.values(st.starts);
      const mvp = [...starts].sort((a, b) => b.pts - a.pts)[0];
      const mostStarted = [...starts].sort((a, b) => b.games - a.games || b.pts - a.pts)[0];
      // Best waiver add: points it scored in this team's starting lineup after the add week.
      const addValue = (a) => weeks.reduce((sum, w, wi) => {
        if (w <= (a.week ?? 0)) return sum;
        const row = (matchups[wi] || []).find((r) => rid2owner[r.roster_id] === st.ownerId);
        return row && (row.starters || []).includes(a.pid) ? sum + (row.players_points?.[a.pid] ?? 0) : sum;
      }, 0);
      const bestAdd = st.adds.map((a) => ({ ...a, pts: r1(addValue(a)) })).sort((a, b) => b.pts - a.pts)[0];
      const myTrades = trades.filter((t) => t.sides.some((s) => s.team === st.team)).map((t) => ({ t, side: t.sides.find((s) => s.team === st.team) }));
      const tradeSummary = ({ t, side }) => ({ id: t.id, week: t.week, offseason: t.offseason, grade: side.grade, score: side.score, edge: side.edge,
        received: side.received.map((x) => x.label), sent: side.sent.map((x) => x.label), partners: t.sides.filter((s) => s !== side).map((s) => s.team) });
      const bestTrade = [...myTrades].sort((a, b) => b.side.score - a.side.score)[0];
      const worstTrade = [...myTrades].sort((a, b) => a.side.score - b.side.score)[0];
      const row = cur?.standings.find((x) => x.ownerId === st.ownerId);
      const ap = row && row.apW + row.apL ? row.apW / (row.apW + row.apL) : null;
      const g = st.wins + st.losses;
      const o = odds?.teams.find((x) => x.ownerId === st.ownerId);
      const persona = cast?.personas[st.ownerId];
      return {
        ownerId: st.ownerId, rosterId: st.rosterId, team: st.team, avatar: st.avatar, record: st.record, pf: st.pf,
        ppg: ws.length ? r1(ws.reduce((a, w) => a + w.pts, 0) / ws.length) : 0,
        bestWeek: best, worstWeek: worst, biggestWin, toughestLoss,
        allPlay: row ? `${row.apW}-${row.apL}` : null, luck: ap == null || !g ? 0 : r1(st.wins - ap * g),
        mvp: mvp ? { name: pname(mvp.pid), pos: ppos(mvp.pid), pts: r1(mvp.pts), games: mvp.games, id: mvp.pid } : null,
        mostStarted: mostStarted ? { name: pname(mostStarted.pid), pos: ppos(mostStarted.pid), games: mostStarted.games, id: mostStarted.pid } : null,
        benchTotal: Math.round(st.benchTotal), worstCall: st.worstCall,
        adds: st.adds.length, faab: st.faab, bestAdd: bestAdd && bestAdd.pts > 0 ? { name: pname(bestAdd.pid), pos: ppos(bestAdd.pid), pts: bestAdd.pts, week: bestAdd.week, faab: bestAdd.faab, id: bestAdd.pid } : null,
        trades: myTrades.length, bestTrade: bestTrade ? tradeSummary(bestTrade) : null, worstTrade: worstTrade && worstTrade !== bestTrade ? tradeSummary(worstTrade) : null,
        outlook: o ? { playoffOdds: o.playoffOdds, projWins: o.projWins, expectedFinish: o.expectedFinish, titleOdds: o.titleOdds ?? null } : null,
        persona: persona ? { nickname: persona.nickname, archetype: persona.archetype, voiceLabel: persona.voiceLabel, catchphrase: persona.catchphrase } : null,
      };
    });
    return { season: ctx.league.season, weeksPlayed: weeks.length, complete: !ctx.currentWeek, teams: out };
  });
}
