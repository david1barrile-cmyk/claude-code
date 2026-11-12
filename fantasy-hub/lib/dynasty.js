// Dynasty power rankings: roster + draft-pick value now, projected forward with
// position-specific age curves.
import { config } from '../config.js';
import { cached } from './cache.js';
import { fetchJson } from './http.js';
import * as S from './sleeper.js';
import { leagueValueParams } from './values.js';

// Year-over-year value multiplier by position and age (age at start of the year).
// Tuned to common dynasty aging patterns: RBs fall off fast after 26, WRs hold
// into their late 20s, QBs last into their 30s, TEs develop late.
export function ageFactor(pos, age) {
  if (age == null) return 1;
  switch (pos) {
    case 'RB': return age <= 22 ? 1.04 : age <= 24 ? 0.97 : age === 25 ? 0.9 : age === 26 ? 0.8 : age === 27 ? 0.68 : 0.55;
    case 'WR': return age <= 23 ? 1.08 : age <= 26 ? 1.0 : age === 27 ? 0.95 : age === 28 ? 0.9 : age === 29 ? 0.82 : age === 30 ? 0.72 : 0.6;
    case 'TE': return age <= 24 ? 1.1 : age <= 28 ? 1.0 : age === 29 ? 0.9 : age === 30 ? 0.8 : 0.65;
    case 'QB': return age <= 25 ? 1.06 : age <= 32 ? 1.0 : age === 33 ? 0.9 : age === 34 ? 0.8 : 0.65;
    default: return 1;
  }
}

export function projectValue(value, pos, age, years) {
  let v = value;
  for (let k = 0; k < years; k++) v *= ageFactor(pos, age == null ? null : age + k);
  return v;
}

async function dynastyValues(league) {
  const p = { ...leagueValueParams(league), isDynasty: true };
  const url = `${config.fantasyCalcBase}/values/current?isDynasty=true&numQbs=${p.numQbs}&numTeams=${p.numTeams}&ppr=${p.ppr}`;
  try {
    const rows = await cached(`fc:${url}`, config.ttl.values, () => fetchJson(url));
    const players = {}, picks = {};
    for (const r of rows) {
      const name = r.player?.name || '';
      const pm = name.match(/^(\d{4})\s+(?:Round\s+)?(\d)(?:st|nd|rd|th)?\b/i);
      if (pm && (r.player?.position === 'PICK' || /pick|round|1st|2nd|3rd|4th/i.test(name))) {
        const key = `${pm[1]}:${pm[2]}`;
        picks[key] = Math.max(picks[key] || 0, r.value); // generic "2027 1st" style entries
      } else if (r.player?.sleeperId) players[r.player.sleeperId] = r.value;
    }
    if (Object.keys(players).length) return { players, picks, source: 'FantasyCalc (dynasty)' };
  } catch (err) {
    console.warn('[dynasty] FantasyCalc unavailable:', err.message);
  }
  return null;
}

/**
 * @param {object} ctx league context from getLeagueContext
 */
export function getDynastyRankings(ctx) {
  return cached(`dyn:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const { league, players, teams } = ctx;
    const dv = await dynastyValues(league);
    // Fallback: redraft/production values (already on ctx) adjusted for age.
    const baseVal = (id) => {
      if (dv) return dv.players[id] ?? 0;
      const v = ctx.values[id]?.value ?? 0;
      const p = players[id];
      return p ? v * projectValue(1, p.pos, p.age, 2) ** 0.5 * 1.2 : v;
    };
    const sorted = Object.keys(players).map(baseVal).filter((v) => v > 0).sort((a, b) => b - a);
    const n = league.total_rosters || 12;
    // Fallback pick values: a 1st ~ the ~5th-round startup asset, 2nd ~ 12th round, 3rd ~ 20th, later ~ nothing.
    const genericPick = (round) => round > 3 ? 0 : sorted[Math.min(sorted.length - 1, n * [5, 12, 20][round - 1])] || 0;

    // Draft picks: each team owns its own picks for the next 3 drafts, then apply trades.
    const rounds = league.settings?.draft_rounds || 4;
    const firstDraft = Number(league.season) + 1;
    const owned = {};
    for (const t of teams) for (let y = firstDraft; y < firstDraft + 3; y++) for (let r = 1; r <= rounds; r++) {
      owned[`${y}:${r}:${t.rosterId}`] = t.rosterId;
    }
    const traded = await S.getTradedPicks(league.league_id).catch(() => []);
    for (const tp of traded || []) {
      const k = `${tp.season}:${tp.round}:${tp.roster_id}`;
      if (k in owned) owned[k] = tp.owner_id;
    }
    // Future picks are discounted ~10%/yr for uncertainty when estimated.
    const pickVal = (season, round) => dv?.picks[`${season}:${round}`] ?? Math.round(genericPick(round) * 0.9 ** (season - firstDraft));

    const out = teams.map((t) => {
      const assets = t.ids.map((id) => ({ id, pos: players[id]?.pos, age: players[id]?.age, value: baseVal(id) }))
        .filter((a) => a.value > 0 && ['QB', 'RB', 'WR', 'TE'].includes(a.pos));
      const picks = Object.entries(owned).filter(([, o]) => o === t.rosterId).map(([k]) => {
        const [season, round, orig] = k.split(':').map(Number);
        return { season, round, from: orig === t.rosterId ? null : teams.find((x) => x.rosterId === orig)?.name ?? `Team ${orig}`, value: pickVal(season, round) };
      });
      const byPos = { QB: 0, RB: 0, WR: 0, TE: 0, Picks: 0 };
      assets.forEach((a) => { byPos[a.pos] += a.value; });
      byPos.Picks = picks.reduce((s, p) => s + p.value, 0);
      const projected = [0, 1, 2, 3].map((y) => Math.round(
        assets.reduce((s, a) => s + projectValue(a.value, a.pos, a.age, y), 0) + byPos.Picks,
      ));
      const totalPlayers = assets.reduce((s, a) => s + a.value, 0);
      const age = totalPlayers ? assets.reduce((s, a) => s + (a.age ?? 26) * a.value, 0) / totalPlayers : null;
      return {
        rosterId: t.rosterId, ownerId: t.ownerId, name: t.name, avatar: t.avatar,
        total: projected[0], projected, byPos: Object.fromEntries(Object.entries(byPos).map(([k, v]) => [k, Math.round(v)])),
        avgAge: age && Math.round(age * 10) / 10,
        top: assets.sort((a, b) => b.value - a.value).slice(0, 4).map((a) => ({ id: a.id, name: players[a.id].name, pos: a.pos, age: a.age, value: Math.round(a.value) })),
        picks: picks.sort((a, b) => a.season - b.season || a.round - b.round),
      };
    });
    for (let y = 0; y < 4; y++) {
      [...out].sort((a, b) => b.projected[y] - a.projected[y]).forEach((t, i) => { (t.ranks ||= [])[y] = i + 1; });
    }
    return { source: dv?.source ?? 'Estimated from production + age', pickSource: dv && Object.keys(dv.picks).length ? 'FantasyCalc' : 'Estimated', teams: out.sort((a, b) => a.ranks[0] - b.ranks[0]) };
  });
}
