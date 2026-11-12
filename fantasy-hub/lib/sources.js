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

function ktcRow(r, sf) {
  const v = (sf ? r.superflexValues : r.oneQBValues) || {};
  return {
    name: r.playerName, pos: r.position, team: r.team, age: r.age ?? null, college: r.college ?? null,
    rookie: !!r.rookie, ktcId: r.playerID ?? null, slug: r.slug ?? null,
    heightFeet: r.heightFeet ?? null, heightInches: r.heightInches ?? null, weight: r.weight ?? null,
    value: v.value ?? null, rank: v.rank ?? null, posRank: v.positionalRank ?? null,
    tier: v.overallTier ?? null, trend: v.overallTrend ?? v.trend ?? null,
  };
}

export async function getKtc({ superflex, players }) {
  if (!config.ktcEnabled) return { name: 'KeepTradeCut', ok: false, error: 'disabled (KTC_ENABLED=0)' };
  try {
    const [main, rook] = await Promise.all([
      cached('ktc:dynasty', H12, async () => extractJsArray(await fetchText('https://keeptradecut.com/dynasty-rankings'))),
      cached('ktc:rookies', H12, async () => extractJsArray(await fetchText('https://keeptradecut.com/dynasty-rankings/rookie-rankings'))).catch(() => null),
    ]);
    if (!main?.length) throw new Error('rankings data not found on page');
    const find = nameIndex(players);
    const out = { name: 'KeepTradeCut', short: 'KTC', ok: true, format: superflex ? 'Superflex' : '1QB', players: {}, picks: [], rookies: [] };
    const seen = new Set();
    for (const raw of [...main, ...(rook || [])]) {
      const r = ktcRow(raw, superflex);
      if (r.value == null || seen.has(r.ktcId ?? r.name)) continue;
      seen.add(r.ktcId ?? r.name);
      if (r.pos === 'RDP' || r.pos === 'PICK') {
        const pk = parsePickName(r.name);
        if (pk) out.picks.push({ ...pk, value: r.value });
        continue;
      }
      const id = find(r.name, r.pos);
      if (id) out.players[id] = { value: r.value, rank: r.rank, posRank: r.posRank, tier: r.tier, trend: r.trend };
      if (r.rookie) out.rookies.push({ ...r, sleeperId: id });
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
      cached('dp:ids', 24 * 3600e3, async () => parseCsv(await fetchText(`${DP}/db_playerids.csv`)).map((r) => ({ fp: r.fantasypros_id, sleeper: r.sleeper_id }))).catch(() => []),
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
    for (const r of picks) {
      const pk = parsePickName(r.player);
      if (pk && Number(r[vk]) > 0) out.picks.push({ ...pk, value: Math.round(Number(r[vk])) });
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
