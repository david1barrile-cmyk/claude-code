// Draft re-grades: every completed draft in the league's history, valued at today's
// market (median of KTC, FantasyCalc, DynastyProcess). Each pick is compared with what its
// slot "should" have produced: the value of the k-th best player that draft actually yielded.
import { cached } from './cache.js';
import * as S from './sleeper.js';
import { leagueChain, getHistory } from './history.js';
import { getValueHub } from './valuehub.js';
import { letter } from './tradegrades.js';

const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return !v.length ? null : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };

export function gradeDraft(picks, valueOf) {
  const rows = picks.map((p) => ({ ...p, value: Math.round(valueOf(p.playerId) ?? 0) }));
  const expected = rows.map((r) => r.value).sort((a, b) => b - a);
  const byValue = [...rows].sort((a, b) => b.value - a.value);
  for (const r of rows) {
    r.expected = expected[r.pickNo - 1] ?? 0;
    r.surplus = r.value - r.expected;
    r.redraftPick = byValue.indexOf(r) + 1;
  }
  const teams = {};
  for (const r of rows) {
    const t = (teams[r.ownerId] ||= { ownerId: r.ownerId, team: r.team, picks: [], value: 0, expected: 0 });
    t.picks.push(r); t.value += r.value; t.expected += r.expected;
  }
  const out = Object.values(teams).map((t) => {
    const pct = t.expected ? ((t.value - t.expected) / t.expected) * 100 : 0;
    const best = [...t.picks].sort((a, b) => b.surplus - a.surplus)[0], worst = [...t.picks].sort((a, b) => a.surplus - b.surplus)[0];
    return { ...t, pct: Math.round(pct), grade: letter(64 + Math.max(-40, Math.min(40, pct)) * 0.8), best, worst, picks: t.picks.sort((a, b) => a.pickNo - b.pickNo) };
  }).sort((a, b) => b.pct - a.pct);
  return {
    teams: out,
    steals: [...rows].sort((a, b) => b.surplus - a.surplus).filter((r) => r.surplus > 0).slice(0, 5),
    busts: [...rows].sort((a, b) => a.surplus - b.surplus).filter((r) => r.surplus < 0).slice(0, 5),
    redraft: byValue.slice(0, Math.min(byValue.length, Math.max(12, out.length * 2))),
  };
}

export function getDraftGrades(ctx) {
  return cached(`draftgrades:${ctx.league.league_id}`, 6 * 3600e3, async () => {
    const [chain, hub, hist] = await Promise.all([leagueChain(ctx.league.league_id), getValueHub(ctx), getHistory(ctx.league.league_id).catch(() => null)]);
    const { ktc, fc, dp } = hub._raw;
    const valueOf = (pid) => median([ktc.ok ? ktc.players[pid]?.value : null, fc.ok ? fc.players[pid]?.value : null, dp.ok ? dp.players[pid]?.value : null]) ?? 0;
    const nameOf = (o) => ctx.teams.find((t) => t.ownerId === o)?.name ?? hist?.names[o]?.name ?? 'Former manager';
    const drafts = [];
    for (const lg of chain) {
      const [list, rosters] = await Promise.all([S.getLeagueDrafts(lg.league_id).catch(() => []), S.getRosters(lg.league_id).catch(() => [])]);
      const rid2owner = Object.fromEntries((rosters || []).map((r) => [r.roster_id, r.owner_id]));
      for (const d of list || []) {
        if (d.status !== 'complete') continue;
        const picks = await S.getDraftPicks(d.draft_id).catch(() => []);
        if (!picks?.length) continue;
        const rounds = d.settings?.rounds ?? Math.max(...picks.map((p) => p.round));
        const rows = picks.filter((p) => p.player_id).map((p) => {
          const owner = rid2owner[p.roster_id] ?? p.picked_by;
          const pl = ctx.players[p.player_id];
          const md = p.metadata || {};
          return { pickNo: p.pick_no, round: p.round, slot: p.draft_slot, label: `${p.round}.${String(p.draft_slot).padStart(2, '0')}`,
            playerId: p.player_id, player: pl?.name ?? `${md.first_name ?? ''} ${md.last_name ?? ''}`.trim(), pos: pl?.pos ?? md.position ?? '?',
            ownerId: owner, team: nameOf(owner) };
        });
        drafts.push({ id: d.draft_id, season: d.season, rounds, kind: rounds > 6 ? 'Startup draft' : 'Rookie draft', picks: rows.length, ...gradeDraft(rows, valueOf) });
      }
    }
    return { drafts: drafts.sort((a, b) => Number(b.season) - Number(a.season) || a.rounds - b.rounds) };
  });
}
