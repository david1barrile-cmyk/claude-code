// Prospect-linked pick values (part of the league-adjusted layer).
//
// Market sites price a "2027 Early 1st" generically. In this league we can do better for the
// next rookie draft:
//   1. Where will the pick land? The season simulation gives the original owner's chance of
//      finishing in each place; draft order is reverse regular-season standings, so finishing
//      last = 1.01.
//   2. Who goes there? The rookie board in best-available order: overall pick k gets the
//      k-th prospect.
//   3. Expected value = sum over slots of P(slot) x (league-adjusted) value of that prospect.
// Prospect rankings and NFL landing spots are still uncertain, so the result is blended with
// the market pick value: 50/50 before the NFL Draft, 90/10 after it.
import { cached } from './cache.js';
import { getOdds } from './odds.js';
import { getRookieBoard } from './rookies.js';
import { getValueHub } from './valuehub.js';
import { draftSeason, projectedOrder, leaguePicks } from './picks.js';
import { shiftValue } from './leagueadjust.js';

/** Chance of each draft slot (1..n) for every original roster, from the simulation. */
export function slotChances(teams, odds) {
  const n = teams.length;
  const out = {};
  if (odds?.teams?.length) {
    for (const t of odds.teams) {
      const rid = teams.find((x) => x.ownerId === t.ownerId)?.rosterId;
      if (rid == null) continue;
      // finishDist[place-1] -> slot n+1-place (worst record picks first)
      out[rid] = t.finishDist.map((p, place) => ({ slot: n - place, p: p / 100 })).filter((x) => x.p > 0).sort((a, b) => a.slot - b.slot);
    }
  }
  // Fallback (no simulation available): current projected order, with certainty.
  const order = projectedOrder(teams);
  for (const t of teams) if (!out[t.rosterId]) out[t.rosterId] = [{ slot: order.indexOf(t.rosterId) + 1, p: 1 }];
  return out;
}

/**
 * @param {object[]} chances [{slot, p}] for the pick's original roster
 * @param {object[]} board   rookies in best-available order, each with `value` (league-adjusted)
 */
export function expectedPick({ round, chances, board, n, market, weight }) {
  let linked = 0, mass = 0;
  const outcomes = [];
  for (const { slot, p } of chances) {
    const pr = board[(round - 1) * n + slot - 1];
    if (!pr) continue;
    linked += p * pr.value; mass += p;
    outcomes.push({ slot, label: `${round}.${String(slot).padStart(2, '0')}`, prob: Math.round(p * 1000) / 10, prospect: { name: pr.name, pos: pr.pos, slug: pr.slug, value: Math.round(pr.value) } });
  }
  if (!mass) return null;
  linked /= mass; // renormalize if the board runs out for some slots
  const blended = market == null ? linked : weight * linked + (1 - weight) * market;
  return { linked: Math.round(linked), market: market == null ? null : Math.round(market), weight, value: Math.round(blended), outcomes: outcomes.sort((a, b) => b.prob - a.prob) };
}

/** pick key "season:round:origRosterId" -> linked info, for the next rookie draft only. */
export function getPickLinks(ctx) {
  return cached(`picklinks:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const [hub, rook, odds, picks] = await Promise.all([getValueHub(ctx), getRookieBoard(ctx), getOdds(ctx).catch(() => null), leaguePicks(ctx, 1)]);
    const season = draftSeason(ctx.league);
    const n = ctx.teams.length;
    // Before the NFL Draft the class is still college prospects (no NFL team on the board).
    const afterNflDraft = season === Number(ctx.league.season);
    const weight = afterNflDraft ? 0.9 : 0.5;
    const shifts = hub.adjust?.shifts?.KTC;
    const top = Math.max(0, ...rook.board.map((r) => r.sources.KTC?.value ?? 0));
    // League-adjusted prospect values on KTC's scale, drafted in league-adjusted order
    // (in this layer a team takes the best prospect for *this* league at its slot).
    const board = rook.board.map((r) => {
      const raw = r.sources.KTC?.value ?? (top * r.score) / 100;
      return { ...r, value: shiftValue(raw, r.pos, shifts) };
    }).sort((a, b) => (a.adjRank ?? a.rank + 1000) - (b.adjRank ?? b.rank + 1000));
    const chances = slotChances(ctx.teams, odds);
    // Blend against KTC's own value for the pick so both halves share one scale.
    const marketPick = Object.fromEntries(hub.teams.flatMap((t) => t.picks).map((pk) => [pk.key, pk.values.KTC ?? pk.values.Adj]));
    const out = {};
    for (const pk of picks.filter((p) => p.season === season)) {
      const info = expectedPick({ round: pk.round, chances: chances[pk.orig] || [], board, n, market: marketPick[pk.key] ?? null, weight });
      if (info) out[pk.key] = { ...info, season, orig: pk.orig };
    }
    return { season, weight, afterNflDraft, picks: out };
  });
}

/** Hub copy whose league-adjusted pick values use the prospect-linked values. */
export async function hubWithPickLinks(ctx) {
  const [hub, links] = await Promise.all([getValueHub(ctx), getPickLinks(ctx).catch(() => null)]);
  if (!links) return hub;
  return {
    ...hub,
    pickLinks: { season: links.season, weight: links.weight, afterNflDraft: links.afterNflDraft },
    teams: hub.teams.map((t) => ({
      ...t,
      picks: t.picks.map((pk) => {
        const l = links.picks[pk.key];
        return l ? { ...pk, values: { ...pk.values, Adj: l.value }, linked: l } : pk;
      }),
    })),
  };
}
