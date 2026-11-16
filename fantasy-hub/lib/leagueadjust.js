// League-adjusted values: an extra layer on top of market values (never a replacement).
//
// Market values (KTC, DynastyProcess, mostly FantasyCalc) assume a typical 12-team league.
// What a player is worth to *this* league depends on replacement level: how good the
// last startable player at the position is. We count how many players at each position
// actually start in this league (every team's best lineup, flex and superflex included)
// and compare with a typical 12-team league. Each player's value is then shifted by the
// difference between the two replacement players' values:
//
//   adjusted = market value - (value of this league's replacement - value of 12-team replacement)
//
// e.g. in an 8-team superflex league only ~16 QBs start (vs ~24), so a startable QB is
// easier to find and every QB is shifted down; with two TE slots ~16 TEs start (vs ~14),
// so TEs are shifted up. Picks are not shifted.
import { bestLineup, lineupInfo } from './lineup.js';

const POS = ['QB', 'RB', 'WR', 'TE'];

/** Starters per position in a typical 12-team league (what market values assume). */
export function standardDemand(superflex) {
  return superflex ? { QB: 24, RB: 30, WR: 42, TE: 14 } : { QB: 13, RB: 32, WR: 44, TE: 14 };
}

/** Starters per position in this league: count positions across every team's best lineup. */
export function leagueDemand(ctx) {
  const info = lineupInfo(ctx.players, ctx.metrics);
  const out = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const t of ctx.teams) {
    for (const s of bestLineup(t.ids, info, ctx.slots).lineup) {
      const pos = s.id && ctx.players[s.id]?.pos;
      if (pos in out) out[pos]++;
    }
  }
  return out;
}

/**
 * Shift values for one source.
 * @param {Record<string, number>} values  player id -> market value
 * @returns {{ values: Record<string, number>, shifts: Record<string, object> }}
 */
export function adjustValues(values, players, demandLeague, demandStd) {
  const byPos = Object.fromEntries(POS.map((p) => [p, []]));
  for (const [id, v] of Object.entries(values)) {
    const pos = players[id]?.pos;
    if (byPos[pos] && v > 0) byPos[pos].push(v);
  }
  const shifts = {};
  for (const p of POS) {
    const vs = byPos[p].sort((a, b) => b - a);
    const at = (rank) => (vs.length ? vs[Math.min(vs.length - 1, Math.max(0, rank - 1))] : 0);
    const repLeague = at(demandLeague[p]), repStd = at(demandStd[p]);
    shifts[p] = { leagueStarters: demandLeague[p], standardStarters: demandStd[p], repLeague: Math.round(repLeague), repStd: Math.round(repStd), shift: Math.round(repLeague - repStd) };
  }
  const out = {};
  for (const [id, v] of Object.entries(values)) {
    const s = shifts[players[id]?.pos]?.shift ?? 0;
    // Never below 5% of market value: a deep backup still has some trade value.
    out[id] = Math.round(Math.max(v * 0.05, v - s));
  }
  return { values: out, shifts };
}

/** Shift a single value of a known position (used for college prospects with no Sleeper id). */
export const shiftValue = (v, pos, shifts) => Math.round(Math.max(v * 0.05, v - (shifts?.[pos]?.shift ?? 0)));

/**
 * Consolidation: in a shallow league the waiver wire is deep, so extra pieces are worth less.
 * Pieces beyond the number the other side sends count at a discount that scales with league
 * size (60% in 8 teams, 80% in 10, none in 12+).
 */
export function depthDiscount(teams) {
  return Math.max(0.6, Math.min(1, 1 - 0.1 * (12 - teams)));
}

export function consolidatedTotal(values, otherCount, teams) {
  const d = depthDiscount(teams);
  return [...values].sort((a, b) => b - a).reduce((s, v, i) => s + (i < Math.max(1, otherCount) ? v : v * d), 0);
}
