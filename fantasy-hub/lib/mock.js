// Deterministic fake data that mimics the Sleeper, FantasyCalc and RSS
// responses, so the app can run (MOCK=1) and be tested without network access.
// Every player name here is fictional.

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(42);
const pick = (a) => a[Math.floor(R() * a.length)];
const TEAMS = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LAR MIA MIN NE NO NYG NYJ PHI PIT SF SEA TB TEN WAS'.split(' ');
const FIRST = 'Avery Blake Cam Dax Eli Finn Gus Hank Ike Jett Kade Lane Miles Nash Odell Pax Quinn Reed Sol Tate Ula Vic Wade Xavi Yuri Zeke Bo Cruz Dez Ezra'.split(' ');
const LAST = 'Ashford Brightwater Calloway Dunmore Everhart Fairbanks Galloway Holloway Ironside Jessup Kingsley Lockhart Merriweather Northcutt Oakridge Pendleton Quarles Rutherford Stonebridge Thornbury Underwood Vance Whitlock Yardley Zimmerman Blackwood Copeland Drummond Easterly Fenwick'.split(' ');

const SEASON = '2026', WEEK = 11;
const players = {}, talent = {};
let nid = 1000;
for (const team of TEAMS) {
  const layout = { QB: 2, RB: 3, WR: 4, TE: 2, K: 1 };
  for (const [pos, n] of Object.entries(layout)) {
    for (let d = 1; d <= n; d++) {
      const id = String(nid++);
      players[id] = {
        player_id: id, full_name: `${pick(FIRST)} ${pick(LAST)}`, position: pos, fantasy_positions: [pos], team, active: true,
        age: 21 + Math.floor(R() * 12), years_exp: Math.floor(R() * 10), college: pick(['State', 'Tech', 'A&M', 'Coastal', 'Northern']),
        height: String(70 + Math.floor(R() * 8)), weight: String(180 + Math.floor(R() * 70)), number: Math.floor(R() * 89) + 1,
        depth_chart_order: d, injury_status: R() < 0.06 ? pick(['Questionable', 'Out', 'IR']) : null, injury_body_part: 'Hamstring', status: 'Active',
      };
      // Talent declines with depth; a few backups "break out" mid-season.
      talent[id] = { base: (1.25 - d * 0.28) * (0.7 + R() * 0.6), breakout: d > 1 && R() < 0.12 ? 5 + Math.floor(R() * 5) : null };
    }
  }
  players[team] = { player_id: team, full_name: `${team} Defense`, position: 'DEF', fantasy_positions: ['DEF'], team, active: true };
  talent[team] = { base: 0.6 + R() * 0.6 };
}

function weekStats(week) {
  const r = rng(week * 7919);
  const out = {};
  for (const [id, p] of Object.entries(players)) {
    const t = talent[id];
    let f = t.base;
    if (t.breakout && week >= t.breakout) f = Math.max(f, 0.95 + r() * 0.2);
    if (p.injury_status === 'IR' && week > 6) continue;
    if (week === (Number(id) % 14) + 5) continue; // bye
    const g = Math.max(0.1, f * (0.6 + r() * 0.8));
    const s = { gp: 1, tm_off_snp: 65 };
    switch (p.position) {
      case 'QB': Object.assign(s, { off_snp: f > 0.8 ? 65 : 2, pass_att: Math.round(34 * g), pass_yd: Math.round(250 * g), pass_td: Math.round(1.8 * g * r() * 1.6), pass_int: r() < 0.4 ? 1 : 0, rush_att: Math.round(4 * g), rush_yd: Math.round(18 * g) }); if (f < 0.8) Object.assign(s, { pass_att: 1, pass_yd: 4, pass_td: 0, rush_att: 0, rush_yd: 0 }); break;
      case 'RB': Object.assign(s, { off_snp: Math.round(60 * Math.min(1, f)), rush_att: Math.round(17 * g), rush_yd: Math.round(75 * g), rush_td: r() < 0.45 * g ? 1 : 0, rec_tgt: Math.round(4 * g), rec: Math.round(3 * g), rec_yd: Math.round(22 * g), rec_air_yd: Math.round(4 * g), rush_rz_att: Math.round(2 * g) }); break;
      case 'WR': Object.assign(s, { off_snp: Math.round(62 * Math.min(1, f + 0.1)), rec_tgt: Math.round(9 * g), rec: Math.round(6 * g), rec_yd: Math.round(80 * g), rec_air_yd: Math.round(100 * g * (0.6 + r())), rec_td: r() < 0.4 * g ? 1 : 0, rec_rz_tgt: Math.round(1.2 * g) }); break;
      case 'TE': Object.assign(s, { off_snp: Math.round(55 * Math.min(1, f + 0.15)), rec_tgt: Math.round(6 * g), rec: Math.round(4.5 * g), rec_yd: Math.round(50 * g), rec_air_yd: Math.round(40 * g), rec_td: r() < 0.3 * g ? 1 : 0 }); break;
      case 'K': Object.assign(s, { off_snp: 0, fgm_30_39: Math.round(1.5 * g), fgm_40_49: Math.round(g), xpm: Math.round(3 * g) }); break;
      case 'DEF': Object.assign(s, { def_int: Math.round(r() * 2), def_fr: r() < 0.3 ? 1 : 0, def_sack: Math.round(3 * g), def_td: r() < 0.12 ? 1 : 0, pts_allow_14_20: 1 }); break;
    }
    out[id] = s;
  }
  return out;
}
const statCache = {};
const stats = (w) => (statCache[w] ||= weekStats(w));

const scoring = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6,
  fgm_30_39: 3, fgm_40_49: 4, xpm: 1, def_int: 2, def_fr: 2, def_sack: 1, def_td: 6, pts_allow_14_20: 1,
};
const league = {
  league_id: '9001', name: 'Mock Sunday League', season: SEASON, status: 'in_season', total_rosters: 12, avatar: null,
  settings: { type: 0, playoff_week_start: 15 }, scoring_settings: scoring,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
};
const users = Array.from({ length: 12 }, (_, i) => ({
  user_id: `u${i + 1}`, display_name: i === 0 ? 'demo' : `manager${i + 1}`,
  metadata: { team_name: ['Gridiron Ghosts', 'Fourth & Long', 'Blitz Brigade', 'Red Zone Rats', 'Hail Marys', 'Pick Six Pack', 'Two-Point Tries', 'Sack Masters', 'End Zone Elite', 'Fumble Bros', 'Audible Ready', 'Taxi Squad'][i] }, avatar: null,
}));

// Snake draft by early-season value with positional caps.
const seasonVal = (id) => { let s = 0; for (let w = 1; w <= 3; w++) { const st = stats(w)[id]; if (st) for (const [k, m] of Object.entries(scoring)) s += (st[k] || 0) * m; } return s; };
const caps = { QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1 };
const rosters = users.map((u, i) => ({ roster_id: i + 1, owner_id: u.user_id, players: [], starters: [], settings: {} }));
const pool = Object.keys(players).sort((a, b) => seasonVal(b) - seasonVal(a));
for (let round = 0; round < 16; round++) {
  const order = round % 2 ? [...rosters].reverse() : rosters;
  for (const r of order) {
    const idx = pool.findIndex((id) => r.players.filter((x) => players[x].position === players[id].position).length < caps[players[id].position]);
    r.players.push(pool.splice(idx, 1)[0]);
  }
}
const pts = (rid, w) => {
  const r = rosters[rid - 1];
  return r.players.slice(0, 10).reduce((s, id) => { const st = stats(w)[id]; if (!st) return s; let p = 0; for (const [k, m] of Object.entries(scoring)) p += (st[k] || 0) * m; return s + p; }, 0);
};
for (const r of rosters) { r.starters = r.players.slice(0, 10); }
for (let w = 1; w < WEEK; w++) {
  for (let i = 0; i < 12; i += 2) {
    const a = rosters[(i + w) % 12], b = rosters[(i + 1 + w * 3) % 12] === a ? rosters[(i + 2) % 12] : rosters[(i + 1 + w * 3) % 12];
    const pa = pts(a.roster_id, w), pb = pts(b.roster_id, w);
    for (const [x, px, py] of [[a, pa, pb], [b, pb, pa]]) {
      const s = x.settings; s.wins = (s.wins || 0) + (px > py); s.losses = (s.losses || 0) + (px < py);
      s.fpts = (s.fpts || 0) + Math.floor(px); s.fpts_against = (s.fpts_against || 0) + Math.floor(py);
    }
  }
}
for (const r of rosters) { r.settings.fpts_decimal = 0; r.settings.ties = 0; }

const free = Object.keys(players).filter((id) => !rosters.some((r) => r.players.includes(id)));
const trending = free.filter((id) => talent[id].breakout).map((id, i) => ({ player_id: id, count: 40000 - i * 3100 })).filter((t) => t.count > 0);

function matchups(week) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const r = rosters[i];
    const done = week < WEEK;
    const pp = {};
    for (const id of r.starters) {
      const st = stats(week)[id]; let p = 0;
      if (st) for (const [k, m] of Object.entries(scoring)) p += (st[k] || 0) * m;
      pp[id] = Math.round((done ? p : p * 0.4) * 100) / 100;
    }
    out.push({ roster_id: r.roster_id, matchup_id: Math.floor(i / 2) + 1, starters: r.starters, players: r.players, players_points: pp, points: +Object.values(pp).reduce((s, x) => s + x, 0).toFixed(2) });
  }
  return out;
}

function rss(source, items) {
  return `<?xml version="1.0"?><rss><channel><title>${source}</title>${items.map((it) => `<item><title><![CDATA[${it.t}]]></title><link>https://example.com/${encodeURIComponent(it.t)}</link><pubDate>${it.d}</pubDate><description><![CDATA[${it.s}]]></description></item>`).join('')}</channel></rss>`;
}
const P = Object.values(players).filter((p) => p.position !== 'DEF');
function newsXml(seed) {
  const r = rng(seed);
  const tmpl = [
    (p) => [`${p.full_name} expected to see expanded role in Week ${WEEK}`, `Coaches say ${p.full_name} has earned more snaps after a strong stretch.`],
    (p) => [`${p.full_name} limited at practice with hamstring tightness`, `${p.full_name} (${p.team}) was a limited participant Wednesday.`],
    (p) => [`Waiver wire: why ${p.full_name} is a must-add`, `Usage trends point to a breakout for ${p.full_name}.`],
    (p) => [`Film room: breaking down ${p.full_name}'s route tree`, `A closer look at how ${p.team} is deploying ${p.full_name}.`],
  ];
  return rss('Mock', Array.from({ length: 12 }, (_, i) => {
    const p = P[Math.floor(r() * P.length)];
    const [t, s] = tmpl[Math.floor(r() * tmpl.length)](p);
    return { t, s, d: new Date(Date.UTC(2026, 10, 12, 18 - i)).toUTCString() };
  }));
}
function ytXml() {
  return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${Array.from({ length: 9 }, (_, i) => {
    const p = P[(i * 37) % P.length];
    return `<entry><yt:videoId>mock${i}</yt:videoId><title>${p.full_name} highlights | Week ${WEEK - 1}</title><link rel="alternate" href="https://www.youtube.com/watch?v=mock${i}"/><published>2026-11-1${i % 3}T12:00:00Z</published></entry>`;
  }).join('')}</feed>`;
}

const fcValues = () => Object.keys(players).map((id) => {
  let s = 0, n = 0;
  for (let w = WEEK - 4; w < WEEK; w++) { const st = stats(w)[id]; if (st) { n++; for (const [k, m] of Object.entries(scoring)) s += (st[k] || 0) * m; } }
  return { player: { sleeperId: id, name: players[id].full_name }, value: Math.round((n ? s / n : 0) ** 1.6 * 25), trend30Day: Math.round((R() - 0.5) * 400) };
}).filter((r) => r.value > 0);

export function handle(url) {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/v1/, '');
  let m;
  if (u.hostname.includes('sleeper')) {
    if (p === '/state/nfl') return { season: SEASON, league_season: SEASON, week: WEEK, display_week: WEEK, season_type: 'regular' };
    if ((m = p.match(/^\/user\/([^/]+)$/))) return users.find((x) => x.display_name === decodeURIComponent(m[1]) || x.user_id === m[1]) ?? null;
    if (/^\/user\/[^/]+\/leagues\/nfl\/\d+$/.test(p)) return [league];
    if (p === '/league/9001') return league;
    if (p === '/league/9001/rosters') return rosters;
    if (p === '/league/9001/users') return users;
    if ((m = p.match(/^\/league\/9001\/matchups\/(\d+)$/))) return matchups(Number(m[1]));
    if ((m = p.match(/^\/league\/9001\/transactions\/(\d+)$/))) return Number(m[1]) !== WEEK ? [] : trending.slice(0, 3).map((t, i) => ({ transaction_id: `tx${i}`, type: 'waiver', status: 'complete', created: Date.UTC(2026, 10, 11 - i), roster_ids: [i + 2], adds: { [t.player_id]: i + 2 }, drops: { [rosters[i + 1].players[15]]: i + 2 }, settings: { waiver_bid: 12 - i * 4 } }));
    if (p === '/players/nfl') return players;
    if (p.startsWith('/players/nfl/trending/add')) return trending;
    if (p.startsWith('/players/nfl/trending/drop')) return [];
    if ((m = p.match(/^\/stats\/nfl\/regular\/\d+\/(\d+)$/))) return Number(m[1]) < WEEK ? stats(Number(m[1])) : {};
    if ((m = p.match(/^\/projections\/nfl\/regular\/\d+\/(\d+)$/))) {
      const s = stats(Number(m[1])); const out = {};
      for (const [id, st] of Object.entries(s)) out[id] = Object.fromEntries(Object.entries(st).map(([k, v]) => [k, typeof v === 'number' ? v * 0.9 : v]));
      return out;
    }
  }
  if (u.hostname.includes('fantasycalc')) return fcValues();
  if (u.hostname.includes('youtube')) return ytXml();
  if (/espn|cbs|yahoo|nbcsports|rotoballer/.test(u.hostname)) return newsXml(u.hostname.length);
  return undefined;
}
