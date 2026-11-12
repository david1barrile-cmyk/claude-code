// Draft-pick ownership and projected slots for upcoming rookie drafts.
import * as S from './sleeper.js';

export function draftSeason(league) {
  // Before/while the league's own draft runs, the class is this season's; otherwise next year's.
  return ['pre_draft', 'drafting'].includes(league.status) ? Number(league.season) : Number(league.season) + 1;
}

// Projected order: worst record first (tiebreak lower points-for). Linear rookie draft.
export function projectedOrder(teams) {
  return [...teams]
    .sort((a, b) => (a.wins + a.ties / 2) - (b.wins + b.ties / 2) || a.pf - b.pf)
    .map((t) => t.rosterId);
}

export function tierForSlot(slot, n) {
  if (!slot) return 'mid';
  return slot <= Math.ceil(n / 3) ? 'early' : slot <= Math.ceil((2 * n) / 3) ? 'mid' : 'late';
}

const pad = (x) => String(x).padStart(2, '0');

/** All picks for the next `years` drafts with current owner and projected slot. */
export async function leaguePicks(ctx, years = 3) {
  const { league, teams } = ctx;
  const first = draftSeason(league);
  const rounds = league.settings?.draft_rounds || 4;
  const order = projectedOrder(teams);
  const n = teams.length;
  const traded = await S.getTradedPicks(league.league_id).catch(() => []);
  const owner = {};
  for (const tp of traded || []) owner[`${tp.season}:${tp.round}:${tp.roster_id}`] = tp.owner_id;
  const name = (rid) => teams.find((t) => t.rosterId === rid)?.name ?? `Team ${rid}`;
  const picks = [];
  for (let season = first; season < first + years; season++) {
    for (let round = 1; round <= rounds; round++) {
      for (const t of teams) {
        const key = `${season}:${round}:${t.rosterId}`;
        const slot = season === first ? order.indexOf(t.rosterId) + 1 : null;
        const own = owner[key] ?? t.rosterId;
        picks.push({
          key, season, round, slot, orig: t.rosterId, owner: own, tier: tierForSlot(slot, n),
          label: slot ? `${season} ${round}.${pad(slot)}` : `${season} Round ${round}`,
          origName: name(t.rosterId), ownerName: name(own),
        });
      }
    }
  }
  return picks.sort((a, b) => a.season - b.season || a.round - b.round || (a.slot ?? 0) - (b.slot ?? 0));
}

// Parse a pick name from any value source into {season, round, tier, slot}.
export function parsePickName(name) {
  const s = String(name || '').trim();
  let m = s.match(/^(\d{4})\s+pick\s+(\d+)\.(\d+)/i) || s.match(/^(\d{4})\s+(\d+)\.(\d+)$/);
  if (m) return { season: +m[1], round: +m[2], slot: +m[3], tier: null };
  m = s.match(/^(\d{4})\s+(early|mid|late)\s+(\d)(?:st|nd|rd|th)/i);
  if (m) return { season: +m[1], round: +m[3], tier: m[2].toLowerCase(), slot: null };
  m = s.match(/^(\d{4})\s+(\d)(?:st|nd|rd|th)\s*\((early|mid|late)\)$/i); // FantasyCalc: "2027 1st (Early)"
  if (m) return { season: +m[1], round: +m[2], tier: m[3].toLowerCase(), slot: null };
  m = s.match(/^(\d{4})\s+(?:round\s+)?(\d)(?:st|nd|rd|th)?(?:\s+round)?(?:\s+pick)?$/i);
  if (m) return { season: +m[1], round: +m[2], tier: null, slot: null };
  return null;
}

/** Value of one of our picks from a source's pick table [{season, round, tier, slot, value}]. */
export function resolvePickValue(table, pick, n) {
  if (!table?.length) return null;
  const seasons = [...new Set(table.map((p) => p.season))].sort((a, b) => a - b);
  // Sources only list a few drafts; fall back to the nearest listed year.
  const season = seasons.includes(pick.season) ? pick.season : seasons.reduce((b, s) => (Math.abs(s - pick.season) < Math.abs(b - pick.season) ? s : b), seasons[0]);
  const rows = table.filter((p) => p.season === season && p.round === pick.round);
  if (!rows.length) return null;
  if (pick.slot) {
    const exact = rows.find((p) => p.slot === pick.slot);
    if (exact) return exact.value;
  }
  const tier = rows.find((p) => p.tier === (pick.tier || tierForSlot(pick.slot, n)));
  if (tier) return tier.value;
  const generic = rows.find((p) => !p.tier && !p.slot);
  if (generic) return generic.value;
  const tiers = rows.filter((p) => p.tier);
  if (tiers.length) return tiers.reduce((s, p) => s + p.value, 0) / tiers.length;
  const slots = rows.filter((p) => p.slot);
  return slots.length ? slots.reduce((s, p) => s + p.value, 0) / slots.length : null;
}
