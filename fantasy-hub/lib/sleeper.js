// Thin, cached client for the public Sleeper API (no auth required).
// Docs: https://docs.sleeper.com/
import { config } from '../config.js';
import { cached } from './cache.js';
import { fetchJson } from './http.js';

const B = config.sleeperBase;
const T = config.ttl;
const j = (path, ttl, opts) => cached(`sleeper:${path}`, ttl, () => fetchJson(B + path), opts);

export const getState = () => j('/state/nfl', T.live);
export const getUser = (username) => j(`/user/${encodeURIComponent(username)}`, T.values);
export const getUserLeagues = (userId, season) => j(`/user/${userId}/leagues/nfl/${season}`, T.live);
export const getLeague = (id) => j(`/league/${id}`, T.live);
export const getRosters = (id) => j(`/league/${id}/rosters`, T.live);
export const getLeagueUsers = (id) => j(`/league/${id}/users`, T.live);
export const getMatchups = (id, week) => j(`/league/${id}/matchups/${week}`, T.live);
export const getTransactions = (id, week) => j(`/league/${id}/transactions/${week}`, T.live);
export const getTrending = (type, hours = 48, limit = 50) =>
  j(`/players/nfl/trending/${type}?lookback_hours=${hours}&limit=${limit}`, T.live);

// ~5 MB; trimmed to the fields the app uses and cached to disk for a day.
export const getPlayers = () =>
  cached('sleeper:players:trim', T.players, async () => {
    const all = await fetchJson(`${B}/players/nfl`);
    const out = {};
    for (const [id, p] of Object.entries(all)) {
      const pos = p.fantasy_positions?.[0] || p.position;
      if (!['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(pos)) continue;
      if (pos !== 'DEF' && !p.active) continue;
      out[id] = {
        id,
        name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || id,
        pos,
        team: p.team || 'FA',
        age: p.age ?? null,
        exp: p.years_exp ?? null,
        college: p.college ?? null,
        height: p.height ?? null,
        weight: p.weight ?? null,
        number: p.number ?? null,
        depth: p.depth_chart_order ?? null,
        injury: p.injury_status ?? null,
        injuryBody: p.injury_body_part ?? null,
        status: p.status ?? null,
      };
    }
    return out;
  }, { disk: true });

// Weekly stats/projections come back keyed by player_id (older form) or as an
// array of {player_id, stats}; normalize to {player_id: stats}.
function normalizeWeekly(data) {
  if (Array.isArray(data)) {
    const out = {};
    for (const r of data) if (r?.player_id) out[r.player_id] = r.stats || {};
    return out;
  }
  return data || {};
}

export async function getWeekStats(season, week, isPast) {
  const data = await j(`/stats/nfl/regular/${season}/${week}`, isPast ? T.pastWeekStats : T.live, { disk: isPast });
  return normalizeWeekly(data);
}

export async function getWeekProjections(season, week) {
  try {
    return normalizeWeekly(await j(`/projections/nfl/regular/${season}/${week}`, T.live));
  } catch {
    return {}; // projections are an unofficial endpoint; degrade gracefully
  }
}

export const getWinnersBracket = (id) => j(`/league/${id}/winners_bracket`, T.live);
export const getTradedPicks = (id) => j(`/league/${id}/traded_picks`, T.live);
