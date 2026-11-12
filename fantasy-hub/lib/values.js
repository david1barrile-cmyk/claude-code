// Trade values. Primary source: FantasyCalc (crowd-sourced from real trades,
// keyed by Sleeper ID). Fallback: derived from rest-of-season production.
import { config } from '../config.js';
import { cached } from './cache.js';
import { fetchJson } from './http.js';

export function leagueValueParams(league) {
  const rp = league.roster_positions || [];
  return {
    isDynasty: league.settings?.type === 2,
    numQbs: rp.includes('SUPER_FLEX') || rp.filter((s) => s === 'QB').length > 1 ? 2 : 1,
    numTeams: league.total_rosters || 12,
    ppr: league.scoring_settings?.rec ?? 1,
  };
}

export async function getTradeValues(league, metrics, weeksLeft) {
  const p = leagueValueParams(league);
  try {
    const url = `${config.fantasyCalcBase}/values/current?isDynasty=${p.isDynasty}&numQbs=${p.numQbs}&numTeams=${p.numTeams}&ppr=${p.ppr}`;
    const rows = await cached(`fc:${url}`, config.ttl.values, () => fetchJson(url));
    const out = {};
    for (const r of rows) {
      const id = r.player?.sleeperId;
      if (id) out[id] = { value: r.value, trend30: r.trend30Day ?? null, rank: r.overallRank ?? null, source: 'FantasyCalc' };
    }
    if (Object.keys(out).length) return out;
  } catch (err) {
    console.warn('[values] FantasyCalc unavailable, using production-based values:', err.message);
  }
  return productionValues(metrics, weeksLeft);
}

export function productionValues(metrics, weeksLeft = 8) {
  const out = {};
  for (const m of Object.values(metrics)) {
    // Convex in ppg: one 20-ppg player is worth more than two 10-ppg players.
    if (m.ros > 0) out[m.id] = { value: Math.round(m.ros ** 1.6 * Math.max(weeksLeft, 1) * 3), trend30: null, rank: null, source: 'production' };
  }
  return out;
}
