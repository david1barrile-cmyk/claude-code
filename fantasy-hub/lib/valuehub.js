// One table of trade values per league across every source, for players and picks.
import { cached } from './cache.js';
import { getKtc, getDynastyProcess, getFantasyCalc } from './sources.js';
import { leagueValueParams, productionValues } from './values.js';
import { leaguePicks, marketPickValue } from './picks.js';
import { projectValue } from './dynasty.js';
import { leagueDemand, standardDemand, adjustValues, consolidatedTotal, depthDiscount } from './leagueadjust.js';

const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return !v.length ? null : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };

export function leagueFormat(league) {
  const p = leagueValueParams(league);
  return { ...p, superflex: p.numQbs === 2 };
}

// Our own model: production (rest-of-season ppg), age-adjusted in dynasty leagues.
function modelSource(ctx, picks, fmt) {
  const weeksLeft = ctx.currentWeek ? Math.max(1, (ctx.league.settings?.playoff_week_start || 15) + 2 - ctx.currentWeek) : 8;
  const base = productionValues(ctx.metrics, Math.max(weeksLeft, 8));
  const players = {};
  for (const [id, v] of Object.entries(base)) {
    const p = ctx.players[id];
    if (!p || ['K', 'DEF'].includes(p.pos)) continue;
    const age = fmt.isDynasty ? projectValue(1, p.pos, p.age, 2) ** 0.5 : 1;
    players[id] = { value: Math.round(v.value * age) };
  }
  const sorted = Object.values(players).map((x) => x.value).sort((a, b) => b - a);
  const n = ctx.teams.length;
  const at = (rank) => sorted[Math.min(sorted.length - 1, rank)] || 0;
  const tierMult = { early: 1.3, mid: 1, late: 0.8 };
  const first = picks[0]?.season ?? Number(ctx.league.season) + 1;
  const pickFn = (pk) => {
    const base = pk.round > 3 ? at(n * 26) : at(n * [5, 12, 20][pk.round - 1]);
    return Math.round(base * (tierMult[pk.tier] ?? 1) * 0.9 ** Math.max(0, pk.season - first));
  };
  const pickVals = {};
  for (const pk of picks) pickVals[pk.key] = pickFn(pk);
  return { name: 'Fantasy Hub model', short: 'Model', ok: true, format: fmt.isDynasty ? 'Production + age' : 'Production', players, pickVals, pickFn };
}

export function getValueHub(ctx) {
  return cached(`hub:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const fmt = leagueFormat(ctx.league);
    const [picks, ktc, fc, dp] = await Promise.all([
      leaguePicks(ctx),
      getKtc({ superflex: fmt.superflex, players: ctx.players }),
      getFantasyCalc({ dynasty: fmt.isDynasty, numQbs: fmt.numQbs, numTeams: fmt.numTeams, ppr: fmt.ppr }),
      getDynastyProcess({ superflex: fmt.superflex, players: ctx.players }),
    ]);
    const model = modelSource(ctx, picks, fmt);
    const n = ctx.teams.length;

    // League-adjusted layer (shown alongside market values, never instead of them).
    // KTC and DynastyProcess assume a typical 12-team league, so they get the replacement-level
    // shift; FantasyCalc was already asked for this league's size and is used as-is.
    const demandLeague = leagueDemand(ctx), demandStd = standardDemand(fmt.superflex);
    const shiftOf = (src) => (src.ok ? adjustValues(Object.fromEntries(Object.entries(src.players).map(([id, x]) => [id, x.value])), ctx.players, demandLeague, demandStd) : null);
    const ktcAdj = shiftOf(ktc), dpAdj = shiftOf(dp);
    const adjIds = new Set([...Object.keys(ktcAdj?.values || {}), ...Object.keys(dpAdj?.values || {}), ...Object.keys(fc.ok ? fc.players : {})]);
    const adjPlayers = {};
    for (const id of adjIds) {
      const v = median([ktcAdj?.values[id], dpAdj?.values[id], fc.ok ? fc.players[id]?.value : null]);
      if (v != null) adjPlayers[id] = { value: Math.round(v) };
    }
    const marketPick = (src, pk) => (src.ok ? marketPickValue(src.picks, pk, n, src.short === 'FC' ? n : 12) : null);
    const adjPickVals = Object.fromEntries(picks.map((pk) => [pk.key, median([marketPick(ktc, pk), marketPick(fc, pk), marketPick(dp, pk)])]));
    const adjusted = { name: 'League-adjusted', short: 'Adj', ok: true, layer: true, format: `${n}-team lineup & depth`, players: adjPlayers, pickVals: adjPickVals };
    const sources = [ktc, fc, dp, model, adjusted];
    const value = (src, id) => src.ok ? src.players?.[id]?.value ?? null : null;
    // KTC and DynastyProcess price picks for 12-team drafts; FantasyCalc was asked for this league's size.
    const pickValue = (src, pk) => (!src.ok ? null : src.pickVals ? src.pickVals[pk.key] : marketPickValue(src.picks, pk, n, src.short === 'FC' ? n : 12));

    const playerRow = (id) => {
      const p = ctx.players[id];
      return {
        id, name: p.name, pos: p.pos, team: p.team, age: p.age, injury: p.injury,
        values: Object.fromEntries(sources.map((s) => [s.short, value(s, id)])),
        ktcTrend: ktc.ok ? ktc.players[id]?.trend ?? null : null,
      };
    };
    const teams = ctx.teams.map((t) => ({
      rosterId: t.rosterId, ownerId: t.ownerId, name: t.name, avatar: t.avatar,
      players: t.ids.filter((id) => !['K', 'DEF'].includes(ctx.players[id]?.pos)).map(playerRow)
        .sort((a, b) => (b.values.KTC ?? b.values.FC ?? b.values.Model ?? 0) - (a.values.KTC ?? a.values.FC ?? a.values.Model ?? 0)),
      picks: picks.filter((pk) => pk.owner === t.rosterId).map((pk) => ({
        ...pk, values: Object.fromEntries(sources.map((s) => [s.short, pickValue(s, pk) == null ? null : Math.round(pickValue(s, pk))])),
      })),
    }));
    return {
      format: fmt,
      sources: sources.map((s) => ({ short: s.short, name: s.name, ok: s.ok, format: s.format ?? null, error: s.error ?? null, layer: !!s.layer })),
      adjust: { demandLeague, demandStd, shifts: { KTC: ktcAdj?.shifts ?? null, DP: dpAdj?.shifts ?? null }, depthDiscount: depthDiscount(n), teams: n },
      teams,
      _raw: { ktc, dp, fc, model, picks, adjusted },
    };
  });
}

/** Compare two sides of a trade under every source. */
export function compareSides(hub, sideA, sideB) {
  const lookup = new Map();
  for (const t of hub.teams) {
    for (const p of t.players) lookup.set(p.id, { ...p, kind: 'player', label: p.name });
    for (const pk of t.picks) lookup.set(pk.key, { ...pk, kind: 'pick', label: pk.slot ? `${pk.label}` : `${pk.label}${pk.orig !== pk.owner ? ` (${pk.origName})` : ''}` });
  }
  const assets = (ids) => ids.map((id) => lookup.get(id)).filter(Boolean);
  const A = assets(sideA), B = assets(sideB);
  const perSource = hub.sources.filter((s) => s.ok && !s.layer).map((s) => {
    const tot = (xs) => xs.reduce((sum, x) => sum + (x.values[s.short] ?? 0), 0);
    const missing = [...A, ...B].filter((x) => x.values[s.short] == null).map((x) => x.label);
    const a = tot(A), b = tot(B), big = Math.max(a, b);
    // edge > 0: side A receives more value than it sends (i.e., B's assets are worth more).
    return { source: s.short, name: s.name, format: s.format, sendA: Math.round(a), sendB: Math.round(b), edgeA: big ? Math.round(((b - a) / big) * 100) : 0, missing };
  });
  const usable = perSource.filter((p) => p.sendA + p.sendB > 0);
  const consensus = usable.length ? Math.round(usable.reduce((s, p) => s + p.edgeA, 0) / usable.length) : 0;
  const abs = Math.abs(consensus);
  const verdict = !A.length || !B.length ? 'Add assets to both sides'
    : abs <= 5 ? 'Fair trade' : abs <= 15 ? `Slight edge to ${consensus > 0 ? 'side A' : 'side B'}` : `Lopsided in favor of ${consensus > 0 ? 'side A' : 'side B'}`;
  const agree = usable.length > 1 && usable.every((p) => Math.sign(p.edgeA) === Math.sign(consensus) || Math.abs(p.edgeA) <= 5);
  const consensusValue = (x) => {
    const vs = usable.map((p) => x.values[p.source]).filter((v) => v != null);
    return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0;
  };
  const all = [...A.map((x) => ({ ...x, side: 'A' })), ...B.map((x) => ({ ...x, side: 'B' }))].sort((x, y) => consensusValue(y) - consensusValue(x));
  // League-adjusted layer with the consolidation discount for uneven piece counts.
  let adjustedResult = null;
  if (hub.sources.some((s) => s.short === 'Adj' && s.ok) && A.length && B.length) {
    const n = hub.adjust?.teams ?? 12;
    const va = A.map((x) => x.values.Adj ?? 0), vb = B.map((x) => x.values.Adj ?? 0);
    const sendA = consolidatedTotal(va, vb.length, n), sendB = consolidatedTotal(vb, va.length, n);
    const big = Math.max(sendA, sendB);
    const edgeA = big ? Math.round(((sendB - sendA) / big) * 100) : 0;
    const ab = Math.abs(edgeA);
    adjustedResult = {
      sendA: Math.round(sendA), sendB: Math.round(sendB), edgeA,
      verdict: ab <= 5 ? 'Fair trade' : ab <= 15 ? `Slight edge to ${edgeA > 0 ? 'side A' : 'side B'}` : `Lopsided in favor of ${edgeA > 0 ? 'side A' : 'side B'}`,
      consolidation: va.length !== vb.length ? `Pieces beyond the ${Math.min(va.length, vb.length)} the other side sends count at ${Math.round((hub.adjust?.depthDiscount ?? 1) * 100)}% (deep waiver wire in ${[8, 11, 18].includes(n) ? 'an' : 'a'} ${n}-team league).` : null,
    };
  }
  return {
    adjusted: adjustedResult,
    perSource, consensus, verdict, sourcesAgree: agree,
    bestAsset: all[0] ? { label: all[0].label, side: all[0].side } : null,
    assets: all.map((x) => ({ id: x.id ?? x.key, label: x.label, kind: x.kind, pos: x.pos ?? 'PICK', side: x.side, values: x.values })),
  };
}
