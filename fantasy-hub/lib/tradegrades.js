// Trade report cards: grade every completed league trade for each team involved.
//
// A team's grade blends:
//   1. Value  - consensus edge across KTC / FantasyCalc / DynastyProcess / model
//               (today's values for what it received vs. what it sent, picks included)
//   2. Now    - change in its best rest-of-season lineup vs. the roster it would
//               have without the trade
//   3. Fit    - contenders get credit for points now, rebuilders for youth
// plus a "results so far" line from points scored since the trade.
import { cached } from './cache.js';
import * as S from './sleeper.js';
import { getValueHub } from './valuehub.js';
import { marketPickValue, draftSeason, tierForSlot, projectedOrder } from './picks.js';
import { bestLineup, lineupInfo } from './lineup.js';
import { consolidatedTotal } from './leagueadjust.js';
import { getPickLinks } from './picklink.js';

const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function letter(score) {
  const scale = [[90, 'A+'], [82, 'A'], [76, 'A-'], [70, 'B+'], [64, 'B'], [58, 'B-'], [53, 'C+'], [48, 'C'], [43, 'C-'], [36, 'D'], [-Infinity, 'F']];
  return scale.find(([min]) => score >= min)[1];
}

/** Grade score from components (exported for tests). */
// Even trade ≈ B; it takes roughly a 40% value gap (or a smaller gap plus a big lineup swing) to reach A+ or F.
export function gradeScore({ edge, lineupDelta, ageGain, futureShift = 0, contender }) {
  const lineupW = contender ? 1 : 0.4, youthW = contender ? 0.3 : 1;
  return 64 + clamp(edge, -40, 40) * 0.8 + lineupW * clamp(lineupDelta ?? 0, -8, 8) * 2.5
    + youthW * (clamp(ageGain ?? 0, -4, 4) * 1.5 + clamp(futureShift, -0.6, 0.6) * 10);
}

// Completed rookie drafts: (season, round, original roster) -> player taken with that pick.
async function draftedPicks(ctx) {
  const out = new Map();
  const drafts = await S.getLeagueDrafts(ctx.league.league_id).catch(() => []);
  for (const d of drafts || []) {
    if (d.status !== 'complete') continue;
    const [full, picks] = await Promise.all([S.getDraft(d.draft_id).catch(() => null), S.getDraftPicks(d.draft_id).catch(() => [])]);
    const slotOwner = full?.slot_to_roster_id || {};
    for (const p of picks || []) {
      const orig = slotOwner[p.draft_slot];
      if (orig && p.player_id) out.set(`${d.season}:${p.round}:${orig}`, { playerId: p.player_id, slot: p.draft_slot });
    }
  }
  return out;
}

async function allTrades(ctx) {
  const id = ctx.league.league_id;
  const last = ctx.currentWeek || 18;
  const lists = await Promise.all(Array.from({ length: last }, (_, i) => S.getTransactions(id, i + 1).catch(() => [])));
  const seen = new Set();
  return lists.flat()
    .filter((t) => t.type === 'trade' && t.status === 'complete' && !seen.has(t.transaction_id) && seen.add(t.transaction_id))
    .sort((a, b) => (b.status_updated || b.created) - (a.status_updated || a.created));
}

export function gradeLeagueTrades(ctx) {
  return cached(`tgrades:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const [trades, hub, usedPicks, links] = await Promise.all([allTrades(ctx), getValueHub(ctx), draftedPicks(ctx), getPickLinks(ctx).catch(() => null)]);
    const { ktc, fc, dp, model, adjusted } = hub._raw;
    const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return !v.length ? null : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
    const sources = [ktc, fc, dp, model].filter((s) => s.ok);
    const n = ctx.teams.length;
    const firstDraft = draftSeason(ctx.league);
    const order = projectedOrder(ctx.teams);
    const seasonStart = Date.parse(ctx.state.season_start_date || `${ctx.league.season}-09-01`);
    const team = (rid) => ctx.teams.find((t) => t.rosterId === rid);
    const name = (rid) => team(rid)?.name ?? `Team ${rid}`;
    const info = lineupInfo(ctx.players, ctx.metrics);
    const recordRank = (rid) => ctx.teams.findIndex((t) => t.rosterId === rid) + 1; // ctx.teams is sorted by record
    const spots = ctx.league.settings?.playoff_teams || Math.ceil(n / 2);

    const playerAsset = (pid) => {
      const p = ctx.players[pid];
      return {
        kind: 'player', id: pid, label: p?.name ?? `Player ${pid}`, pos: p?.pos ?? '?', team: p?.team ?? '', age: p?.age ?? null,
        values: Object.fromEntries(sources.map((s) => [s.short, s.players?.[pid]?.value ?? null])),
        adj: adjusted?.players?.[pid]?.value ?? null,
      };
    };
    const pickAsset = (dp_) => {
      const season = Number(dp_.season), round = dp_.round, orig = dp_.roster_id;
      const used = season < firstDraft;
      const became = usedPicks.get(`${season}:${round}:${orig}`);
      if (used && became && ctx.players[became.playerId]) {
        // A used pick is worth the player it turned into.
        const pa = playerAsset(became.playerId);
        return { ...pa, kind: 'pick', id: `${season}:${round}:${orig}`, pickLabel: `${season} ${round}.${String(became.slot).padStart(2, '0')}`, label: `${season} ${round}.${String(became.slot).padStart(2, '0')} → ${pa.label}`, playerId: became.playerId };
      }
      const slot = season === firstDraft ? order.indexOf(orig) + 1 : null;
      const pk = { season, round, slot, tier: tierForSlot(slot, n), key: `${season}:${round}:${orig}` };
      const label = `${season} ${slot ? `${round}.${String(slot).padStart(2, '0')}` : `Round ${round}`}${orig !== dp_.owner_id ? ` (${name(orig)})` : ''}`;
      const values = Object.fromEntries(sources.map((s) => [s.short, used ? null
        : s.short === 'Model' ? s.pickFn(pk) : marketPickValue(s.picks, pk, n, s.short === 'FC' ? n : 12)]));
      const link = links?.picks[pk.key];
      return { kind: 'pick', id: pk.key, label, pos: 'PICK', used, values, adj: used ? null : link ? link.value : med([values.KTC, values.FC, values.DP]), linked: link ?? null };
    };

    return trades.map((t) => {
      const ts = t.status_updated || t.created;
      const offseason = ts < seasonStart;
      const week = offseason ? 0 : t.leg;
      const rids = t.roster_ids || [];
      const sides = rids.map((rid) => {
        const recvPlayers = Object.entries(t.adds || {}).filter(([, r]) => r === rid).map(([pid]) => pid);
        const sentPlayers = Object.entries(t.drops || {}).filter(([, r]) => r === rid).map(([pid]) => pid);
        const recvPicks = (t.draft_picks || []).filter((p) => p.owner_id === rid).map(pickAsset);
        const sentPicks = (t.draft_picks || []).filter((p) => p.previous_owner_id === rid).map(pickAsset);
        const faabIn = (t.waiver_budget || []).filter((b) => b.receiver === rid).reduce((s, b) => s + b.amount, 0);
        const faabOut = (t.waiver_budget || []).filter((b) => b.sender === rid).reduce((s, b) => s + b.amount, 0);
        const received = [...recvPlayers.map(playerAsset), ...recvPicks];
        const sent = [...sentPlayers.map(playerAsset), ...sentPicks];
        // Players drafted with traded (used) picks count as part of the trade for lineup and results.
        const inPids = [...recvPlayers, ...recvPicks.filter((x) => x.playerId).map((x) => x.playerId)];
        const outPids = [...sentPlayers, ...sentPicks.filter((x) => x.playerId).map((x) => x.playerId)];

        // 1. Value edge per source, then consensus.
        const perSource = sources.map((s) => {
          const sum = (xs) => xs.reduce((a, x) => a + (x.values[s.short] ?? 0), 0);
          const inV = sum(received), outV = sum(sent), big = Math.max(inV, outV);
          return { source: s.short, name: s.name, received: Math.round(inV), sent: Math.round(outV), edge: big ? Math.round(((inV - outV) / big) * 100) : 0, usable: big > 0 };
        });
        // Market sources (KTC, FantasyCalc, DynastyProcess) decide value; the production model only
        // describes this season, which the lineup component already measures. Median resists one
        // outlier source (e.g. DynastyProcess pricing picks far below the others).
        const market = perSource.filter((p) => p.usable && p.source !== 'Model');
        const usable = market.length ? market : perSource.filter((p) => p.usable);
        for (const p of perSource) p.inGrade = usable.includes(p);
        const sortedE = usable.map((p) => p.edge).sort((x, y) => x - y);
        const edge = !sortedE.length ? 0 : sortedE.length % 2 ? sortedE[(sortedE.length - 1) / 2] : (sortedE[sortedE.length / 2 - 1] + sortedE[sortedE.length / 2]) / 2;

        // 2. Lineup now vs. the roster it would have without this trade.
        const tm = team(rid);
        let lineupDelta = null;
        const stillHere = inPids.every((pid) => tm?.ids.includes(pid));
        if (tm && ctx.currentWeek && stillHere) {
          const without = tm.ids.filter((pid) => !inPids.includes(pid)).concat(outPids.filter((pid) => ctx.players[pid] && !tm.ids.includes(pid)));
          lineupDelta = r1(bestLineup(tm.ids, info, ctx.slots).total - bestLineup(without, info, ctx.slots).total);
        }

        // 3. Youth: value-weighted age of players received vs. sent.
        const vAge = (xs) => {
          const ps = xs.filter((x) => x.kind === 'player' && x.age);
          const w = ps.map((x) => Object.values(x.values).filter((v) => v != null).reduce((a, v) => a + v, 0) || 1);
          const tot = w.reduce((a, b) => a + b, 0);
          return tot ? ps.reduce((a, x, i) => a + x.age * w[i], 0) / tot : null;
        };
        const ageIn = vAge(received), ageOut = vAge(sent);
        // Share of value that is "future" (picks and players 24 or younger), received vs. sent.
        const avgV = (x) => { const v = Object.values(x.values).filter((n) => n != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
        const futureShare = (xs) => { const tot = xs.reduce((a, x) => a + avgV(x), 0); return tot ? xs.filter((x) => x.kind === 'pick' || (x.age && x.age <= 24)).reduce((a, x) => a + avgV(x), 0) / tot : 0; };
        const futureShift = received.length && sent.length ? futureShare(received) - futureShare(sent) : 0;
        const ageGain = ageIn != null && ageOut != null ? r1(ageOut - ageIn) : 0;
        const contender = recordRank(rid) <= spots;

        // Results so far: fantasy points by acquired vs. departed players after the trade.
        const since = (pids) => r1(pids.reduce((a, pid) => a + (ctx.metrics[pid]?.log || []).filter((g) => g.week > week).reduce((s, g) => s + g.pts, 0), 0));
        const score = gradeScore({ edge, lineupDelta, ageGain, futureShift, contender });
        // League-adjusted layer: replacement-level shift + consolidation discount for extra pieces.
        const adjIn = consolidatedTotal(received.map((x) => x.adj ?? 0), sent.length, n), adjOut = consolidatedTotal(sent.map((x) => x.adj ?? 0), received.length, n);
        const adjBig = Math.max(adjIn, adjOut);
        const adjEdge = adjBig ? ((adjIn - adjOut) / adjBig) * 100 : 0;
        const adjScore = gradeScore({ edge: adjEdge, lineupDelta, ageGain, futureShift, contender });
        return {
          rosterId: rid, ownerId: tm?.ownerId ?? null, team: name(rid), avatar: tm?.avatar ?? null, grade: letter(score), score: Math.round(score), movedOn: !stillHere,
          adjusted: { grade: letter(adjScore), score: Math.round(adjScore), edge: Math.round(adjEdge) },
          contender, recordRank: recordRank(rid),
          received, sent, faabIn, faabOut,
          edge: Math.round(edge), perSource, sourcesAgree: usable.length > 1 && usable.every((p) => Math.sign(p.edge) === Math.sign(edge) || Math.abs(p.edge) <= 5),
          lineupDelta, ageIn: ageIn && r1(ageIn), ageOut: ageOut && r1(ageOut), ageGain, futureShift: Math.round(futureShift * 100) / 100,
          sincePts: { acquired: since(inPids), departed: since(outPids) },
        };
      });
      const ranked = [...sides].sort((a, b) => b.score - a.score);
      const verdict = ranked.length < 2 ? 'Graded' : ranked[0].score - ranked[1].score < 6 ? 'Fair deal' : `Edge: ${ranked[0].team}`;
      const usedPicks = sides.flatMap((s) => s.received).filter((x) => x.used && !x.playerId).map((x) => x.label);
      return {
        id: t.transaction_id, at: ts, week, offseason, teamsCount: rids.length, verdict, winner: ranked[0]?.score - (ranked[1]?.score ?? 0) >= 6 ? ranked[0].team : null,
        sides, notes: tradeNotes(sides, usedPicks, offseason, week),
      };
    });
  });
}

// Plain-language analysis bullets used by the UI and the template Gazette writer.
export function tradeNotes(sides, usedPicks, offseason, week) {
  const notes = [];
  const [a, b] = [...sides].sort((x, y) => y.edge - x.edge);
  if (a && b) {
    if (Math.abs(a.edge) <= 5) notes.push('Value is close to even across the trade-value sites.');
    else notes.push(`${a.team} comes out about ${Math.abs(a.edge)}% ahead on value (median of the trade-value sites)${a.sourcesAgree ? ', and every site agrees' : ', though the sites disagree'}.`);
  }
  for (const s of sides) {
    if (s.movedOn) notes.push(`${s.team} has since moved on from some of what it received, so the lineup impact isn't measured.`);
    else if (s.lineupDelta != null && Math.abs(s.lineupDelta) >= 1) {
      notes.push(`${s.team}'s best lineup is ${s.lineupDelta > 0 ? 'up' : 'down'} ${Math.abs(s.lineupDelta)} pts/wk because of it${s.contender && s.lineupDelta > 0 ? ', which is what a contender should want' : !s.contender && s.lineupDelta < 0 ? ' (fine for a team building for later)' : ''}.`);
    }
    if (Math.abs(s.ageGain) >= 2) notes.push(`${s.team} got ${s.ageGain > 0 ? 'younger' : 'older'} by ~${Math.abs(s.ageGain)} years in the assets that changed hands${!s.contender && s.ageGain > 0 ? ', a sensible rebuild move' : ''}.`);
    if (!s.contender && s.futureShift >= 0.25) notes.push(`${s.team} turned present value into picks and young players: right direction for a team that's building.`);
    if (s.contender && s.futureShift <= -0.25 && (s.lineupDelta ?? 0) > 0) notes.push(`${s.team} cashed in future assets to win now.`);
    if (s.faabIn) notes.push(`${s.team} also picked up $${s.faabIn} of FAAB (not counted in value).`);
  }
  if (!offseason) {
    const res = sides.filter((s) => s.sincePts.acquired || s.sincePts.departed).map((s) => `${s.team}'s new players have scored ${s.sincePts.acquired} since Week ${week}`);
    if (res.length) notes.push(`Results so far: ${res.join('; ')}.`);
  }
  if (usedPicks.length) notes.push(`Picks that were used but can't be traced to a drafted player (${usedPicks.join(', ')}) aren't valued.`);
  const traced = sides.flatMap((s) => s.received).filter((x) => x.kind === 'pick' && x.playerId);
  if (traced.length) notes.push(`Used picks are valued as the player they became (${traced.map((x) => x.label).join('; ')}).`);
  return notes;
}
