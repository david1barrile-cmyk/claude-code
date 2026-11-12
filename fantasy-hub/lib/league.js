import { cached } from './cache.js';
import * as S from './sleeper.js';
import { buildMetrics, positionalRanks } from './metrics.js';
import { startingSlots } from './lineup.js';
import { getTradeValues } from './values.js';

const REG_SEASON_WEEKS = 18;

export function weeksToLoad(state, leagueSeason) {
  const cur = String(state.season) === String(leagueSeason);
  if (!cur) return { completed: range(1, REG_SEASON_WEEKS), next: null };
  if (state.season_type === 'pre') return { completed: [], next: 1 };
  if (state.season_type === 'post') return { completed: range(1, REG_SEASON_WEEKS), next: null };
  const week = Math.max(1, Number(state.week) || 1);
  return { completed: range(1, week - 1), next: week };
}
const range = (a, b) => (b < a ? [] : Array.from({ length: b - a + 1 }, (_, i) => a + i));

export function teamName(user, roster) {
  return user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`;
}

export function getLeagueContext(leagueId) {
  return cached(`ctx:${leagueId}`, 10 * 60e3, async () => {
    const [state, league, rosters, users, players] = await Promise.all([
      S.getState(), S.getLeague(leagueId), S.getRosters(leagueId), S.getLeagueUsers(leagueId), S.getPlayers(),
    ]);
    const { completed, next } = weeksToLoad(state, league.season);
    const [weeks, projections] = await Promise.all([
      Promise.all(completed.map(async (w) => ({ week: w, stats: await S.getWeekStats(league.season, w, true) }))),
      next ? S.getWeekProjections(league.season, next) : {},
    ]);
    const metrics = buildMetrics({ players, weeks: weeks.filter((w) => Object.keys(w.stats).length), scoring: league.scoring_settings, projections });
    const ranks = positionalRanks(metrics, players);
    const weeksLeft = next ? Math.max(0, (league.settings?.playoff_week_start || 15) + 2 - next) : 0;
    const values = await getTradeValues(league, metrics, weeksLeft);
    const usersById = Object.fromEntries(users.map((u) => [u.user_id, u]));
    const teams = rosters.map((r) => {
      const u = usersById[r.owner_id];
      const st = r.settings || {};
      return {
        rosterId: r.roster_id, ownerId: r.owner_id, name: teamName(u, r), owner: u?.display_name ?? null,
        avatar: u?.avatar ?? null,
        wins: st.wins ?? 0, losses: st.losses ?? 0, ties: st.ties ?? 0,
        pf: (st.fpts ?? 0) + (st.fpts_decimal ?? 0) / 100,
        pa: (st.fpts_against ?? 0) + (st.fpts_against_decimal ?? 0) / 100,
        ids: (r.players || []).filter((id) => players[id]),
        starters: r.starters || [], reserve: r.reserve || [], taxi: r.taxi || [],
      };
    }).sort((a, b) => b.wins - a.wins || b.pf - a.pf);
    return {
      state, league, players, metrics, ranks, values, teams,
      slots: startingSlots(league.roster_positions), currentWeek: next, completedWeeks: completed,
      rostered: new Set(teams.flatMap((t) => t.ids)),
    };
  });
}

export function findTeam(ctx, ownerIdOrRosterId) {
  return ctx.teams.find((t) => t.ownerId === ownerIdOrRosterId || String(t.rosterId) === String(ownerIdOrRosterId));
}
