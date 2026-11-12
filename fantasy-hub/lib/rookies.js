// Incoming rookie class: big board (KTC + DynastyProcess + optional notes file),
// rule-based scouting reports, optional college stats (CollegeFootballData), and
// a mock rookie draft in projected order (by team need or best available).
import fs from 'node:fs';
import { config } from '../config.js';
import { cached } from './cache.js';
import { fetchJson } from './http.js';
import { normName } from './sources.js';
import { getValueHub } from './valuehub.js';
import { draftSeason, leaguePicks } from './picks.js';
import { getDynastyRankings } from './dynasty.js';

const POS = new Set(['QB', 'RB', 'WR', 'TE']);
export const slugify = (name) => normName(name).replace(/ /g, '-');

function readNotes() {
  try {
    const raw = JSON.parse(fs.readFileSync(config.rookieNotesFile, 'utf8'));
    return Array.isArray(raw) ? raw : raw.players || [];
  } catch { return []; }
}

export function buildBoard({ season, ktcRookies = [], dpRookies = [], notes = [] }) {
  const map = new Map();
  const get = (name, pos) => {
    const k = normName(name);
    if (!map.has(k)) map.set(k, { slug: slugify(name), name, pos, sources: {} });
    const r = map.get(k);
    r.pos ||= pos;
    return r;
  };
  for (const r of ktcRookies.filter((x) => POS.has(x.pos))) {
    Object.assign(get(r.name, r.pos), {
      college: r.college ?? undefined, age: r.age ?? undefined, team: r.team || undefined, sleeperId: r.sleeperId ?? undefined,
      height: r.heightFeet ? r.heightFeet * 12 + (r.heightInches || 0) : undefined, weight: r.weight ?? undefined,
    });
    get(r.name, r.pos).sources.KTC = { value: r.value, rank: r.rank, posRank: r.posRank, tier: r.tier, trend: r.trend };
  }
  for (const r of dpRookies.filter((x) => POS.has(x.pos) && x.draftYear === season)) {
    const row = get(r.name, r.pos);
    row.age ??= r.age ?? undefined; row.sleeperId ??= r.sleeperId ?? undefined;
    row.sources.DP = { value: r.value, ecr: r.ecr };
  }
  for (const n of notes) {
    if (!n?.name) continue;
    const row = get(n.name, n.pos);
    Object.assign(row, Object.fromEntries(Object.entries({ college: n.college, age: n.age, height: n.height, weight: n.weight }).filter(([, v]) => v != null)));
    row.notes = n.notes ?? null; row.comps = n.comps ?? null;
    row.manualStrengths = n.strengths ?? []; row.manualConcerns = n.concerns ?? [];
    if (n.rank != null) row.sources.Notes = { rank: n.rank };
  }
  const rows = [...map.values()];
  // Board value: each source scaled so its best rookie = 100, then averaged.
  const tops = {};
  for (const s of ['KTC', 'DP']) tops[s] = Math.max(0, ...rows.map((r) => r.sources[s]?.value ?? 0));
  const noteRanks = rows.filter((r) => r.sources.Notes).length;
  for (const r of rows) {
    const vals = ['KTC', 'DP'].filter((s) => r.sources[s]?.value && tops[s]).map((s) => (100 * r.sources[s].value) / tops[s]);
    if (!vals.length && r.sources.Notes) vals.push(100 * (1 - (r.sources.Notes.rank - 1) / Math.max(noteRanks, 1)));
    r.score = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
  }
  const board = rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  // Within-class rank per source, so sources can be compared like for like.
  for (const src of ['KTC', 'DP']) {
    rows.filter((r) => r.sources[src]?.value).sort((a, b) => b.sources[src].value - a.sources[src].value)
      .forEach((r, i) => { r.sources[src].classRank = i + 1; });
  }
  const posCount = {};
  board.forEach((r, i) => { r.rank = i + 1; posCount[r.pos] = (posCount[r.pos] || 0) + 1; r.posRank = posCount[r.pos]; });
  board.forEach((r) => {
    r.tier = r.rank <= 3 ? 'Elite' : r.rank <= 8 ? 'Tier 1' : r.rank <= 14 ? 'Tier 2' : r.rank <= 26 ? 'Tier 3' : 'Depth';
  });
  return board;
}

export function getRookieBoard(ctx) {
  return cached(`rookies:${ctx.league.league_id}`, 30 * 60e3, async () => {
    const hub = await getValueHub(ctx);
    const season = draftSeason(ctx.league);
    const { ktc, dp } = hub._raw;
    const board = buildBoard({ season, ktcRookies: ktc.ok ? ktc.rookies : [], dpRookies: dp.ok ? dp.rookies : [], notes: readNotes() });
    return {
      season, format: hub.format,
      sources: [
        { short: 'KTC', name: 'KeepTradeCut rookie rankings', ok: ktc.ok && ktc.rookies.length > 0, error: ktc.error ?? (ktc.ok && !ktc.rookies.length ? 'no rookies listed' : null) },
        { short: 'DP', name: 'DynastyProcess (FantasyPros rookie ECR)', ok: dp.ok && board.some((r) => r.sources.DP), error: dp.error ?? null },
        { short: 'Notes', name: 'League notes file (data/rookies.json)', ok: readNotes().length > 0, error: null },
      ],
      board,
    };
  });
}

// ---------- college production (CollegeFootballData.com) ----------
const CFBD = 'https://api.collegefootballdata.com';
export async function collegeProfile(r, draftYear) {
  const key = config.cfbdKey || (config.mock ? 'mock' : null);
  if (!key || !r.college) return null;
  const headers = { authorization: `Bearer ${key}` };
  const years = [draftYear - 1, draftYear - 2];
  try {
    const seasons = [];
    for (const year of years) {
      const [ps, ts] = await Promise.all([
        cached(`cfbd:p:${year}:${r.college}`, 24 * 3600e3, () => fetchJson(`${CFBD}/stats/player/season?year=${year}&team=${encodeURIComponent(r.college)}`, headers)),
        cached(`cfbd:t:${year}:${r.college}`, 24 * 3600e3, () => fetchJson(`${CFBD}/stats/season?year=${year}&team=${encodeURIComponent(r.college)}`, headers)),
      ]);
      const mine = (ps || []).filter((x) => normName(x.player) === normName(r.name));
      if (!mine.length) continue;
      const st = (cat, type) => Number(mine.find((x) => x.category === cat && x.statType === type)?.stat ?? 0);
      const team = (name) => Number((ts || []).find((x) => x.statName === name)?.statValue ?? 0);
      const s = {
        year, rec: st('receiving', 'REC'), recYds: st('receiving', 'YDS'), recTd: st('receiving', 'TD'),
        car: st('rushing', 'CAR'), rushYds: st('rushing', 'YDS'), rushTd: st('rushing', 'TD'),
        passAtt: st('passing', 'ATT'), passYds: st('passing', 'YDS'), passTd: st('passing', 'TD'), int: st('passing', 'INT'),
        teamPassYds: team('netPassingYards'), teamPassTd: team('passingTDs'), teamRushYds: team('rushingYards'), teamRushTd: team('rushingTDs'),
      };
      const share = (a, b) => (b > 0 ? a / b : null);
      s.dominator = r.pos === 'RB'
        ? avg(share(s.rushYds + s.recYds, s.teamRushYds + s.teamPassYds), share(s.rushTd + s.recTd, s.teamRushTd + s.teamPassTd))
        : r.pos === 'QB' ? null : avg(share(s.recYds, s.teamPassYds), share(s.recTd, s.teamPassTd));
      s.ypa = s.passAtt ? s.passYds / s.passAtt : null;
      s.ypc = s.car ? s.rushYds / s.car : null;
      s.ypr = s.rec ? s.recYds / s.rec : null;
      seasons.push(s);
    }
    return seasons.length ? { source: 'CollegeFootballData.com', seasons } : null;
  } catch (err) {
    console.warn('[cfbd]', err.message);
    return null;
  }
}
function avg(a, b) { const v = [a, b].filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }

export function rookieReport(r, college) {
  const S = [], C = [], O = [];
  const pct = (x) => `${Math.round(x * 100)}%`;
  O.push(r.rank <= 3 ? `Elite prospect: a 1.01–1.03 type in your rookie draft.` : r.rank <= 8 ? `First-round lock (consensus #${r.rank}).`
    : r.rank <= 14 ? `Late-1st / early-2nd value (consensus #${r.rank}).` : r.rank <= 26 ? `Second-round pick (consensus #${r.rank}).` : `Day-3 dart throw (consensus #${r.rank}).`);
  O.push(`${r.pos}${r.posRank} in this class.`);
  const ktc = r.sources.KTC?.classRank, dp = r.sources.DP?.classRank;
  if (ktc && dp && Math.abs(ktc - dp) >= 4) O.push(`Markets disagree: rookie #${ktc} on KTC vs #${dp} on FantasyPros/DynastyProcess. KTC traders are ${ktc < dp ? 'higher' : 'lower'} on this prospect.`);
  if (r.sources.KTC?.trend > 0) O.push(`Rising on KTC (+${r.sources.KTC.trend} recently).`);
  if (r.sources.KTC?.trend < 0) O.push(`Falling on KTC (${r.sources.KTC.trend} recently).`);
  if (r.age != null) {
    if (['WR', 'RB'].includes(r.pos) && r.age <= 21.5) S.push(`Young for the class (${r.age}): early-declare producers hit at higher rates.`);
    if (r.age >= 23) C.push(`Older prospect (${r.age}): shorter runway and less projection left.`);
  }
  if (r.weight) {
    if (r.pos === 'RB' && r.weight >= 215) S.push(`Workhorse frame (${r.weight} lb).`);
    if (r.pos === 'RB' && r.weight < 195) C.push(`Light for a lead back (${r.weight} lb): may be a committee/receiving role.`);
    if (r.pos === 'WR' && r.weight < 175) C.push(`Slight build (${r.weight} lb).`);
    if (r.pos === 'TE' && r.weight < 235) C.push(`Undersized TE (${r.weight} lb): may play big-slot.`);
  }
  if (r.height) {
    if (r.pos === 'WR' && r.height >= 74) S.push(`Big-bodied receiver (${Math.floor(r.height / 12)}'${r.height % 12}").`);
    if (r.pos === 'QB' && r.height < 73) C.push(`Short for a QB (${Math.floor(r.height / 12)}'${r.height % 12}").`);
  }
  const last = college?.seasons?.[0];
  if (last) {
    if (last.dominator != null) {
      if (last.dominator >= 0.3) S.push(`Dominant college producer: ${pct(last.dominator)} dominator rating in ${last.year} (share of team yards + TDs).`);
      else if (last.dominator < 0.18) C.push(`Modest college market share: ${pct(last.dominator)} dominator rating in ${last.year}.`);
    }
    if (r.pos === 'QB' && last.ypa) {
      if (last.ypa >= 9) S.push(`Efficient passer: ${last.ypa.toFixed(1)} yards per attempt in ${last.year}.`);
      if (last.passAtt && last.int / last.passAtt > 0.03) C.push(`Turnover-prone: ${last.int} INTs on ${last.passAtt} attempts in ${last.year}.`);
      if (last.rushYds >= 500) S.push(`Rushing upside: ${last.rushYds} rush yards in ${last.year}. Fantasy cheat code.`);
    }
    if (r.pos === 'RB' && last.rec >= 30) S.push(`Receiving role: ${last.rec} catches in ${last.year}.`);
    if (r.pos === 'RB' && last.ypc >= 6) S.push(`Explosive: ${last.ypc.toFixed(1)} yards per carry in ${last.year}.`);
  }
  if (!r.team || r.team === 'FA' || r.team === 'RFA') O.push('Landing spot unknown until the NFL Draft: draft capital and depth chart will move this ranking.');
  S.push(...(r.manualStrengths || [])); C.push(...(r.manualConcerns || []));
  return { outlook: O, strengths: S, concerns: C };
}

// ---------- mock draft ----------
export function teamNeeds(dynTeams, superflex) {
  const pos = ['QB', 'RB', 'WR', 'TE'];
  // Next year's projected value at each position (players age; picks excluded).
  const proj = Object.fromEntries(dynTeams.map((t) => {
    const players = t.total - t.byPos.Picks;
    const f = players ? (t.projected[1] - t.byPos.Picks) / players : 1;
    return [t.rosterId, Object.fromEntries(pos.map((p) => [p, t.byPos[p] * f]))];
  }));
  const avgPos = Object.fromEntries(pos.map((p) => [p, dynTeams.reduce((s, t) => s + proj[t.rosterId][p], 0) / dynTeams.length]));
  const needs = {};
  for (const t of dynTeams) {
    needs[t.rosterId] = Object.fromEntries(pos.map((p) => {
      let n = (avgPos[p] + 1) / (proj[t.rosterId][p] + 1);
      if (p === 'QB' && !superflex) n = 1 + (n - 1) * 0.5; // one starting QB: QB need matters less
      return [p, Math.min(1.8, Math.max(0.6, n))];
    }));
  }
  return needs;
}

export function runMock({ board, picks, needs, mode }) {
  const avail = [...board];
  const need = JSON.parse(JSON.stringify(needs));
  return picks.map((pk, i) => {
    if (!avail.length) return { ...pk, overall: i + 1, player: null };
    let idx = 0, why = 'Best player available';
    if (mode === 'need' && need[pk.owner]) {
      const pool = avail.slice(0, 8);
      let best = -1;
      pool.forEach((r, j) => {
        const s = r.score * need[pk.owner][r.pos] ** 0.6;
        if (s > best) { best = s; idx = j; }
      });
      const n = need[pk.owner][avail[idx].pos], bpa = avail[0];
      why = idx === 0 ? (n > 1.1 ? `BPA and fills a ${bpa.pos} need` : 'Best player available')
        : n >= 1.05 ? `Need pick: thin at ${avail[idx].pos} (need ×${n.toFixed(2)}) over #${bpa.rank} ${bpa.name}`
        : `Fit pick: already deep at ${bpa.pos}, passes on #${bpa.rank} ${bpa.name}`;
      need[pk.owner][avail[idx].pos] *= 0.75;
    }
    const player = avail.splice(idx, 1)[0];
    return { ...pk, overall: i + 1, player, why, delta: player.rank - (i + 1) };
  });
}

export async function mockDraft(ctx, mode = 'need') {
  const [{ board, season }, picks, dyn] = await Promise.all([getRookieBoard(ctx), leaguePicks(ctx, 1), getDynastyRankings(ctx)]);
  const cur = picks.filter((p) => p.season === season).sort((a, b) => a.round - b.round || a.slot - b.slot);
  const fmt = (await getValueHub(ctx)).format;
  const needs = teamNeeds(dyn.teams, fmt.superflex);
  const results = runMock({ board, picks: cur, needs, mode });
  return {
    season, mode,
    order: 'Projected from current standings (worst record picks first; ties broken by fewer points). Traded picks applied.',
    needs: Object.fromEntries(Object.entries(needs).map(([rid, n]) => [rid, Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([p, v]) => ({ pos: p, need: Math.round(v * 100) / 100 }))])),
    picks: results.map((r) => ({
      overall: r.overall, label: r.label, round: r.round, slot: r.slot, owner: r.owner, ownerName: r.ownerName,
      via: r.orig !== r.owner ? r.origName : null, why: r.why ?? null, delta: r.delta ?? null,
      player: r.player && { slug: r.player.slug, name: r.player.name, pos: r.player.pos, college: r.player.college ?? null, rank: r.player.rank, tier: r.player.tier },
    })),
  };
}
