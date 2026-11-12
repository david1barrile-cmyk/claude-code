// This-season power rankings: blend of record, all-play record (schedule-neutral)
// and current optimal-lineup strength (who is good *now*).
import { bestLineup, lineupInfo } from './lineup.js';

export function seasonPower(ctx, currentSeason) {
  const info = lineupInfo(ctx.players, ctx.metrics);
  const rows = ctx.teams.map((t) => {
    const s = currentSeason?.standings.find((x) => x.ownerId === t.ownerId);
    const g = t.wins + t.losses + t.ties;
    return {
      rosterId: t.rosterId, ownerId: t.ownerId, name: t.name, avatar: t.avatar,
      wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf,
      winPct: g ? (t.wins + t.ties / 2) / g : 0,
      apPct: s && s.apW + s.apL ? s.apW / (s.apW + s.apL) : null,
      lineup: bestLineup(t.ids, info, ctx.slots).total,
      form: s?.form ?? [],
    };
  });
  const norm = (k) => {
    const v = rows.map((r) => r[k]).filter((x) => x != null);
    const lo = Math.min(...v), hi = Math.max(...v);
    return (x) => (x == null || hi === lo ? 0.5 : (x - lo) / (hi - lo));
  };
  const nw = norm('winPct'), na = norm('apPct'), nl = norm('lineup');
  for (const r of rows) {
    r.components = { record: nw(r.winPct), allPlay: na(r.apPct ?? r.winPct), lineup: nl(r.lineup) };
    r.score = Math.round(100 * (0.25 * r.components.record + 0.35 * r.components.allPlay + 0.4 * r.components.lineup));
    r.lineup = Math.round(r.lineup * 10) / 10;
  }
  return rows.sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));
}

// P(team A outscores B) assuming a normally distributed weekly margin; spread scales with
// typical scores (deep lineups score more and swing more).
export function winProbability(projA, projB, sd = Math.max(25, 0.17 * ((projA + projB) / 2))) {
  const z = (projA - projB) / sd;
  // Abramowitz–Stegun erf approximation
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-((z / Math.SQRT2) ** 2));
  return 0.5 * (1 + Math.sign(z) * y);
}
