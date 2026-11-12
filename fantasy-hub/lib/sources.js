// Third-party trade-value sources, normalized to:
//   { name, players: { [sleeperId]: { value, rank, posRank, tier, trend } }, picks: [{season, round, tier, slot, value}], rookies: [...] }
// Each source is optional: a failure is logged and the source is reported as unavailable.
import { config } from '../config.js';
import { cached } from './cache.js';
import { fetchJson, fetchText } from './http.js';
import { parsePickName } from './picks.js';

const H12 = 12 * 3600e3;

export function normName(name) {
  return String(name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`]/g, '').replace(/-/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

// Index Sleeper players by normalized name (+ position) for sources without Sleeper IDs.
export function nameIndex(players) {
  const byNamePos = new Map(), byName = new Map();
  for (const p of Object.values(players)) {
    if (p.pos === 'DEF') continue;
    const n = normName(p.name);
    byNamePos.set(`${n}|${p.pos}`, p.id);
    byName.set(n, byName.has(n) ? null : p.id); // null = ambiguous
  }
  return (name, pos) => byNamePos.get(`${normName(name)}|${pos}`) ?? byName.get(normName(name)) ?? null;
}

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
}

// ---------- KeepTradeCut ----------
// KTC has no public API. Its rankings pages embed the full player list as a
// JavaScript array (`var playersArray = [...]`); we read that, at most every 12h.
export function extractJsArray(html, varName = 'playersArray') {
  const at = html.indexOf(varName);
  if (at < 0) return null;
  const start = html.indexOf('[', at);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  return null;
}

// Current KTC pages put the full list in <script id="ktc-players" type="application/json">;
// older ones assigned it straight to `var playersArray = [...]`.
export function extractKtcPlayers(html) {
  const m = html.match(/<script[^>]*\bid=["']ktc-players["'][^>]*>([\s\S]*?)<\/script>/i);
  if (m) {
    try { const a = JSON.parse(m[1]); if (Array.isArray(a)) return a; } catch { /* fall through */ }
  }
  const a = extractJsArray(html, 'playersArray');
  return a && a.length > 10 ? a : null;
}

function ktcRow(r, sf, devy = false) {
  const v = (sf ? r.superflexValues : r.oneQBValues) || {};
  return {
    // On devy pages `college` holds the hometown and `teamLongName` the school.
    name: r.playerName, pos: r.position, team: devy ? null : r.team, age: r.age || null,
    college: devy ? r.teamLongName ?? null : r.college ?? null, hometown: devy ? r.college ?? null : null,
    draftYear: r.draftYear ?? null, devy,
    rookie: !!r.rookie, ktcId: r.playerID ?? null, slug: r.slug ?? null,
    heightFeet: r.heightFeet ?? null, heightInches: r.heightInches ?? null, weight: r.weight ?? null,
    value: v.value ?? null, rank: v.rank ?? null, posRank: v.positionalRank ?? null,
    tier: v.overallTier ?? null, trend: v.overallTrend ?? v.trend ?? null,
  };
}

// DynastyProcess's public ID map links many KTC ids to Sleeper ids.
const dpIds = () => cached('dp:ids', 24 * 3600e3, async () => parseCsv(await fetchText(`${DP}/db_playerids.csv`))
  .map((r) => ({ fp: r.fantasypros_id, sleeper: r.sleeper_id, ktc: r.ktc_id }))
  .filter((r) => r.sleeper && r.sleeper !== 'NA'));

export async function getKtc({ superflex, players }) {
  if (!config.ktcEnabled) return { name: 'KeepTradeCut', short: 'KTC', ok: false, error: 'disabled (KTC_ENABLED=0)' };
  try {
    const [main, devy, ids] = await Promise.all([
      cached('ktc:dynasty', H12, async () => extractKtcPlayers(await fetchText('https://keeptradecut.com/dynasty-rankings'))),
      // College prospects (incoming classes) live on the devy board, keyed by draftYear.
      cached('ktc:devy', H12, async () => extractKtcPlayers(await fetchText('https://keeptradecut.com/devy-rankings'))).catch(() => null),
      dpIds().catch(() => []),
    ]);
    if (!main?.length) throw new Error('rankings data not found on page');
    const find = nameIndex(players);
    const byKtc = new Map(ids.filter((r) => r.ktc && r.ktc !== 'NA').map((r) => [String(r.ktc), r.sleeper]));
    const out = { name: 'KeepTradeCut', short: 'KTC', ok: true, format: superflex ? 'Superflex' : '1QB', players: {}, picks: [], rookies: [], matched: 0, unmatched: [] };
    for (const raw of main) {
      const r = ktcRow(raw, superflex);
      if (r.value == null) continue;
      if (r.pos === 'RDP' || r.pos === 'PICK') {
        const pk = parsePickName(r.name);
        if (pk) out.picks.push({ ...pk, value: r.value });
        continue;
      }
      const viaId = byKtc.get(String(r.ktcId));
      const id = viaId && players[viaId] ? viaId : find(r.name, r.pos);
      if (id) { out.players[id] = { value: r.value, rank: r.rank, posRank: r.posRank, tier: r.tier, trend: r.trend }; out.matched++; } else out.unmatched.push(r.name);
    }
    for (const raw of devy || []) {
      const r = ktcRow(raw, superflex, true);
      if (r.value != null && r.draftYear) out.rookies.push({ ...r, sleeperId: null });
    }
    return out;
  } catch (err) {
    console.warn('[ktc]', err.message);
    return { name: 'KeepTradeCut', short: 'KTC', ok: false, error: err.message };
  }
}

// ---------- DynastyProcess (open data, FantasyPros ECR-based) ----------
const DP = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files';
export async function getDynastyProcess({ superflex, players }) {
  try {
    const [vals, picks, ids] = await Promise.all([
      cached('dp:players', H12, async () => parseCsv(await fetchText(`${DP}/values-players.csv`))),
      cached('dp:picks', H12, async () => parseCsv(await fetchText(`${DP}/values-picks.csv`))).catch(() => []),
      dpIds().catch(() => []),
    ]);
    const fpToSleeper = new Map(ids.filter((r) => r.fp && r.sleeper && r.sleeper !== 'NA').map((r) => [r.fp, r.sleeper]));
    const find = nameIndex(players);
    const vk = superflex ? 'value_2qb' : 'value_1qb', ek = superflex ? 'ecr_2qb' : 'ecr_1qb';
    const out = { name: 'DynastyProcess', short: 'DP', ok: true, format: superflex ? 'Superflex' : '1QB', players: {}, picks: [], rookies: [] };
    const rank = [...vals].filter((r) => Number(r[vk]) > 0).sort((a, b) => Number(b[vk]) - Number(a[vk]));
    rank.forEach((r, i) => {
      const id = (r.fp_id && fpToSleeper.get(r.fp_id)) || find(r.player, r.pos);
      const row = { value: Math.round(Number(r[vk])), rank: i + 1, ecr: Number(r[ek]) || null, posRank: r.ecr_pos ? Number(r.ecr_pos) : null };
      if (id && players[id]) out.players[id] = row;
      out.rookies.push({ name: r.player, pos: r.pos, team: r.team, age: Number(r.age) || null, draftYear: Number(r.draft_year) || null, sleeperId: id, ...row });
    });
    // The picks file may carry only ECR (no value column): price each pick like the player at the same ECR.
    const curve = vals.filter((r) => Number(r[ek]) > 0 && Number(r[vk]) > 0).map((r) => [Number(r[ek]), Number(r[vk])]).sort((a, b) => a[0] - b[0]);
    const valueAtEcr = (e) => {
      if (!curve.length) return null;
      if (e <= curve[0][0]) return curve[0][1];
      for (let i = 1; i < curve.length; i++) {
        if (e <= curve[i][0]) { const [e0, v0] = curve[i - 1], [e1, v1] = curve[i]; return v0 + ((v1 - v0) * (e - e0)) / (e1 - e0 || 1); }
      }
      return curve.at(-1)[1];
    };
    for (const r of picks) {
      const pk = parsePickName(r.player);
      const v = Number(r[vk]) > 0 ? Number(r[vk]) : Number(r[ek]) > 0 ? valueAtEcr(Number(r[ek])) : null;
      if (pk && v > 0) out.picks.push({ ...pk, value: Math.round(v) });
    }
    return out;
  } catch (err) {
    console.warn('[dynastyprocess]', err.message);
    return { name: 'DynastyProcess', short: 'DP', ok: false, error: err.message };
  }
}

// ---------- FantasyCalc ----------
export async function getFantasyCalc({ dynasty, numQbs, numTeams, ppr }) {
  const url = `${config.fantasyCalcBase}/values/current?isDynasty=${dynasty}&numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`;
  try {
    const rows = await cached(`fc:${url}`, config.ttl.values, () => fetchJson(url));
    const out = { name: 'FantasyCalc', short: 'FC', ok: true, format: `${dynasty ? 'Dynasty' : 'Redraft'} · ${numQbs === 2 ? 'SF' : '1QB'}`, players: {}, picks: [] };
    for (const r of rows) {
      const pk = r.player?.position === 'PICK' ? parsePickName(r.player?.name) : null;
      if (pk) { out.picks.push({ ...pk, value: r.value }); continue; }
      const id = r.player?.sleeperId;
      if (id) out.players[id] = { value: r.value, rank: r.overallRank ?? null, posRank: r.positionRank ?? null, trend: r.trend30Day ?? null };
    }
    return out;
  } catch (err) {
    console.warn('[fantasycalc]', err.message);
    return { name: 'FantasyCalc', short: 'FC', ok: false, error: err.message };
  }
}
