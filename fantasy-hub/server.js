import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as S from './lib/sleeper.js';
import { getLeagueContext, findTeam } from './lib/league.js';
import { bestLineup, lineupInfo } from './lib/lineup.js';
import { waiverAdvice, evaluateTrade, tradeSuggestions } from './lib/advice.js';
import { getNews, getHighlights, mentions } from './lib/feeds.js';
import { scoutingReport } from './lib/scouting.js';
import { getHistory } from './lib/history.js';
import { getDynastyRankings } from './lib/dynasty.js';
import { seasonPower, winProbability } from './lib/power.js';
import { cached } from './lib/cache.js';

const PUBLIC = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

function card(ctx, id) {
  const p = ctx.players[id];
  if (!p) return { id, name: id, pos: '?', team: '' };
  const m = ctx.metrics[id], r = ctx.ranks[id], v = ctx.values[id];
  return {
    id, name: p.name, pos: p.pos, team: p.team, injury: p.injury,
    ppg: m?.ppg ?? null, last3: m?.last3 ?? null, ros: m?.ros ?? null, proj: m?.proj ?? null,
    posRank: r ? `${p.pos}${r.rank}` : null, value: v?.value ?? null,
  };
}

function positionStrength(ctx, ids) {
  const { lineup, total } = bestLineup(ids, lineupInfo(ctx.players, ctx.metrics), ctx.slots);
  const byPos = {};
  for (const s of lineup) if (s.id) byPos[ctx.players[s.id].pos] = (byPos[ctx.players[s.id].pos] || 0) + s.pts;
  return { lineup, total, byPos };
}

function leagueNeeds(ctx, team) {
  const all = ctx.teams.map((t) => positionStrength(ctx, t.ids).byPos);
  const mine = positionStrength(ctx, team.ids);
  const out = {};
  for (const pos of new Set(all.flatMap(Object.keys))) {
    const vals = all.map((b) => b[pos] || 0).sort((a, b) => b - a);
    const avg = vals.reduce((s, x) => s + x, 0) / vals.length;
    const me = mine.byPos[pos] || 0;
    out[pos] = { pts: +me.toFixed(1), leagueAvg: +avg.toFixed(1), rank: vals.indexOf(me) + 1, of: vals.length };
  }
  return out;
}

async function currentSeasonSummary(ctx) {
  const h = await getHistory(ctx.league.league_id).catch(() => null);
  return h?.seasons.find((s) => String(s.season) === String(ctx.league.season)) ?? null;
}

const routes = [
  ['GET', /^\/api\/health$/, async () => ({ ok: true })],
  ['GET', /^\/api\/config$/, async () => {
    if (!config.leagueId) return { leagueId: null };
    const lg = await getLeagueContext(config.leagueId);
    return { leagueId: config.leagueId, leagueName: lg.league.name, teams: lg.teams.map((t) => ({ rosterId: t.rosterId, ownerId: t.ownerId, name: t.name, owner: t.owner, avatar: t.avatar })) };
  }],
  ['GET', /^\/api\/state$/, async () => S.getState()],

  ['GET', /^\/api\/user\/([^/]+)\/leagues$/, async ([username], q) => {
    const user = await S.getUser(username).catch(() => null);
    if (!user?.user_id) throw new HttpError(404, `No Sleeper user named "${username}"`);
    const state = await S.getState();
    const season = q.get('season') || state.league_season || state.season;
    const leagues = await S.getUserLeagues(user.user_id, season);
    return {
      user: { id: user.user_id, name: user.display_name, avatar: user.avatar }, season,
      leagues: (leagues || []).map((l) => ({ id: l.league_id, name: l.name, teams: l.total_rosters, status: l.status, avatar: l.avatar, season: l.season })),
    };
  }],

  ['GET', /^\/api\/league\/(\d+)$/, async ([id]) => {
    const ctx = await getLeagueContext(id);
    const L = ctx.league;
    const rec = L.scoring_settings?.rec ?? 0;
    return {
      id, name: L.name, season: L.season, status: L.status, avatar: L.avatar,
      format: `${rec === 1 ? 'PPR' : rec === 0.5 ? 'Half PPR' : rec ? `${rec} PPR` : 'Standard'}${L.roster_positions?.includes('SUPER_FLEX') ? ' · Superflex' : ''}${L.settings?.type === 2 ? ' · Dynasty' : L.settings?.type === 1 ? ' · Keeper' : ''}`,
      slots: ctx.slots, currentWeek: ctx.currentWeek, completedWeeks: ctx.completedWeeks.length,
      valueSource: Object.values(ctx.values)[0]?.source ?? null,
      teams: ctx.teams.map(({ ids, starters, reserve, taxi, ...t }) => ({ ...t, pf: +t.pf.toFixed(2), pa: +t.pa.toFixed(2) })),
    };
  }],

  ['GET', /^\/api\/league\/(\d+)\/matchups$/, async ([id], q) => {
    const ctx = await getLeagueContext(id);
    const week = Number(q.get('week')) || ctx.currentWeek || ctx.completedWeeks.at(-1) || 1;
    const rows = await S.getMatchups(id, week);
    const groups = {};
    for (const r of rows || []) {
      if (r.matchup_id == null) continue;
      const t = ctx.teams.find((x) => x.rosterId === r.roster_id);
      (groups[r.matchup_id] ||= []).push({
        rosterId: r.roster_id, name: t?.name, points: r.points ?? 0,
        projected: +(r.starters || []).reduce((s, pid) => s + (ctx.metrics[pid]?.proj ?? 0), 0).toFixed(1),
        starters: (r.starters || []).map((pid) => ({ ...card(ctx, pid), pts: r.players_points?.[pid] ?? 0 })),
      });
    }
    const mus = Object.values(groups);
    for (const pair of mus) if (pair.length === 2) {
      const p = winProbability(pair[0].projected, pair[1].projected);
      pair[0].winProb = Math.round(p * 100); pair[1].winProb = 100 - pair[0].winProb;
    }
    return { week, matchups: mus };
  }],

  ['GET', /^\/api\/league\/(\d+)\/team\/([^/]+)$/, async ([id, owner]) => {
    const ctx = await getLeagueContext(id);
    const team = findTeam(ctx, owner);
    if (!team) throw new HttpError(404, 'Team not found in this league');
    const { lineup, total } = positionStrength(ctx, team.ids);
    const benchIds = new Set(team.ids);
    lineup.forEach((s) => s.id && benchIds.delete(s.id));
    return {
      team: { rosterId: team.rosterId, name: team.name, owner: team.owner, wins: team.wins, losses: team.losses, ties: team.ties },
      optimal: { total: +total.toFixed(1), lineup: lineup.map((s) => ({ slot: s.slot, player: s.id ? card(ctx, s.id) : null })) },
      currentStarters: team.starters.filter((x) => x !== '0').map((pid) => pid),
      bench: [...benchIds].map((pid) => card(ctx, pid)).sort((a, b) => (b.ros ?? 0) - (a.ros ?? 0)),
      needs: leagueNeeds(ctx, team),
    };
  }],

  ['GET', /^\/api\/league\/(\d+)\/waivers$/, async ([id], q) => {
    const ctx = await getLeagueContext(id);
    const team = findTeam(ctx, q.get('owner'));
    if (!team) throw new HttpError(400, 'owner query param must be your Sleeper user id');
    const trending = await S.getTrending('add').catch(() => []);
    const advice = waiverAdvice({ players: ctx.players, metrics: ctx.metrics, slots: ctx.slots, myIds: team.ids, rosteredIds: ctx.rostered, trendingAdds: trending });
    const trendingFree = trending.filter((t) => !ctx.rostered.has(t.player_id) && ctx.players[t.player_id]).slice(0, 15)
      .map((t) => ({ ...card(ctx, t.player_id), adds: t.count }));
    return {
      baseline: advice.baseline,
      drop: advice.drop && { ...card(ctx, advice.drop.id), loss: advice.drop.loss },
      recs: advice.recs.map((r) => ({ ...card(ctx, r.id), ...r })),
      trending: trendingFree,
    };
  }],

  ['GET', /^\/api\/league\/(\d+)\/trades\/suggest$/, async ([id], q) => {
    const ctx = await getLeagueContext(id);
    const me = findTeam(ctx, q.get('owner'));
    if (!me) throw new HttpError(400, 'owner query param must be your Sleeper user id');
    const others = ctx.teams.filter((t) => t !== me);
    const sugg = await cached(`sugg:${id}:${me.rosterId}`, 10 * 60e3, async () =>
      tradeSuggestions({ players: ctx.players, metrics: ctx.metrics, values: ctx.values, slots: ctx.slots, myIds: me.ids, others }));
    return {
      needs: leagueNeeds(ctx, me),
      suggestions: sugg.map((s) => ({ ...s, give: s.give.map((x) => card(ctx, x)), get: s.get.map((x) => card(ctx, x)) })),
    };
  }],

  ['POST', /^\/api\/league\/(\d+)\/trades\/evaluate$/, async ([id], _q, body) => {
    const ctx = await getLeagueContext(id);
    const me = findTeam(ctx, body.owner), them = findTeam(ctx, body.partner);
    if (!me || !them) throw new HttpError(400, 'owner and partner must be roster or user ids in this league');
    const give = (body.give || []).filter((x) => me.ids.includes(x));
    const get = (body.get || []).filter((x) => them.ids.includes(x));
    return evaluateTrade({ players: ctx.players, metrics: ctx.metrics, values: ctx.values, slots: ctx.slots, mineIds: me.ids, theirIds: them.ids, give, get });
  }],

  ['GET', /^\/api\/league\/(\d+)\/roster\/([^/]+)$/, async ([id, owner]) => {
    const ctx = await getLeagueContext(id);
    const team = findTeam(ctx, owner);
    if (!team) throw new HttpError(404, 'Team not found');
    return { rosterId: team.rosterId, name: team.name, players: team.ids.map((x) => card(ctx, x)).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) };
  }],

  ['GET', /^\/api\/league\/(\d+)\/metrics$/, async ([id], q) => {
    const ctx = await getLeagueContext(id);
    const pos = q.get('pos');
    const owners = new Map(ctx.teams.flatMap((t) => t.ids.map((pid) => [pid, t.name])));
    const rows = Object.values(ctx.metrics)
      .filter((m) => m.games > 0 && (!pos || ctx.players[m.id]?.pos === pos))
      .map(({ log, ...m }) => ({ ...m, ...card(ctx, m.id), owner: owners.get(m.id) ?? null }))
      .sort((a, b) => b.ros - a.ros)
      .slice(0, Number(q.get('limit')) || 150);
    return { completedWeeks: ctx.completedWeeks.length, rows };
  }],

  ['GET', /^\/api\/league\/(\d+)\/player\/(\w+)$/, async ([id, pid]) => {
    const ctx = await getLeagueContext(id);
    const p = ctx.players[pid];
    if (!p) throw new HttpError(404, 'Unknown player');
    const m = ctx.metrics[pid] || null;
    const owner = ctx.teams.find((t) => t.ids.includes(pid));
    const [news, hl] = await Promise.all([getNews().catch(() => ({ items: [] })), getHighlights().catch(() => ({ items: [] }))]);
    return {
      player: p, metrics: m, rank: ctx.ranks[pid] || null, value: ctx.values[pid] || null,
      owner: owner ? { rosterId: owner.rosterId, name: owner.name } : null,
      report: scoutingReport({ player: p, m, rank: ctx.ranks[pid], value: ctx.values[pid] }),
      news: mentions(news.items, p.name).slice(0, 8),
      highlights: mentions(hl.items, p.name).slice(0, 6),
    };
  }],

  ['GET', /^\/api\/league\/(\d+)\/transactions$/, async ([id]) => {
    const ctx = await getLeagueContext(id);
    const wk = ctx.currentWeek || ctx.completedWeeks.at(-1) || 1;
    const lists = await Promise.all([wk, wk - 1].filter((w) => w > 0).map((w) => S.getTransactions(id, w).catch(() => [])));
    const name = (rid) => ctx.teams.find((t) => t.rosterId === rid)?.name ?? `Team ${rid}`;
    const seen = new Set();
    return lists.flat().filter((t) => t.status === 'complete' && !seen.has(t.transaction_id) && seen.add(t.transaction_id))
      .sort((a, b) => (b.status_updated || b.created) - (a.status_updated || a.created)).slice(0, 30)
      .map((t) => ({
        type: t.type, at: t.status_updated || t.created,
        teams: (t.roster_ids || []).map(name),
        adds: Object.entries(t.adds || {}).map(([pid, rid]) => ({ ...card(ctx, pid), to: name(rid) })),
        drops: Object.entries(t.drops || {}).map(([pid, rid]) => ({ ...card(ctx, pid), from: name(rid) })),
        faab: t.settings?.waiver_bid ?? null,
      }));
  }],

  ['GET', /^\/api\/league\/(\d+)\/history$/, async ([id]) => getHistory(id)],

  ['GET', /^\/api\/league\/(\d+)\/power$/, async ([id]) => {
    const ctx = await getLeagueContext(id);
    const [cur, dynasty] = await Promise.all([currentSeasonSummary(ctx), getDynastyRankings(ctx)]);
    return { season: seasonPower(ctx, cur), dynasty, draftSeason: Number(ctx.league.season) + 1 };
  }],

  ['GET', /^\/api\/league\/(\d+)\/weekly$/, async ([id]) => {
    const ctx = await getLeagueContext(id);
    const cur = await currentSeasonSummary(ctx);
    if (!cur) return { weeks: [], teams: [] };
    const weeks = [...new Set(cur.standings.flatMap((s) => s.weekly.map((w) => w.week)))].sort((a, b) => a - b);
    const avg = weeks.map((w) => {
      const v = cur.standings.flatMap((s) => s.weekly.filter((x) => x.week === w).map((x) => x.pts));
      return { week: w, pts: Math.round((v.reduce((a, b) => a + b, 0) / (v.length || 1)) * 10) / 10 };
    });
    return {
      weeks, average: avg,
      teams: cur.standings.map((s) => ({ ownerId: s.ownerId, weekly: s.weekly, apW: s.apW, apL: s.apL, form: s.form })),
    };
  }],

  ['GET', /^\/api\/news$/, async (_m, q) => {
    const data = await getNews();
    const term = q.get('q');
    return { ...data, items: (term ? mentions(data.items, term) : data.items).slice(0, 100) };
  }],
  ['GET', /^\/api\/highlights$/, async () => getHighlights()],
];

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e5) throw new HttpError(413, 'Body too large'); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'Invalid JSON'); }
}

function serveStatic(req, res, pathname) {
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => {
        res.writeHead(e2 ? 404 : 200, { 'content-type': MIME['.html'] }).end(e2 ? 'Not found' : html);
      });
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
}

function authorized(req) {
  if (!config.sitePassword) return true;
  const [scheme, b64] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !b64) return false;
  const pass = Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(config.sitePassword);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/health' && !authorized(req)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="Fantasy Hub", charset="UTF-8"' }).end('Password required (any username)');
    return;
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  for (const [method, re, fn] of routes) {
    const m = url.pathname.match(re);
    if (!m || method !== req.method) continue;
    try {
      const body = method === 'POST' ? await readBody(req) : null;
      const data = await fn(m.slice(1).map(decodeURIComponent), url.searchParams, body);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    } catch (err) {
      const code = err.code && Number.isInteger(err.code) ? err.code : 502;
      if (code >= 500) console.error(`[api] ${req.method} ${url.pathname}:`, err.message);
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  server.listen(config.port, () => {
    console.log(`Fantasy Hub on http://localhost:${config.port}${config.mock ? '  (MOCK data)' : ''}`);
  });
}
