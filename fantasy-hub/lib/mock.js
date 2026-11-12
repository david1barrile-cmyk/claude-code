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
  league_id: '9001', previous_league_id: '8001', name: 'Mock Sunday League', season: SEASON, status: 'in_season', total_rosters: 12, avatar: null,
  settings: { type: 2, playoff_week_start: 15, draft_rounds: 4 }, scoring_settings: scoring,
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

// Standings derived from the same weekly matchups the API serves.
for (const r of rosters) Object.assign(r.settings, { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0 });
for (let w = 1; w < WEEK; w++) {
  const ms = matchups(w);
  for (const a of ms) {
    const b = ms.find((x) => x.matchup_id === a.matchup_id && x !== a);
    const s = rosters[a.roster_id - 1].settings;
    s.wins += a.points > b.points; s.losses += a.points < b.points;
    s.fpts += Math.floor(a.points); s.fpts_against += Math.floor(b.points);
  }
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

// ---- Past seasons (history) ----
const past = {};
for (const [id, season, prev, shift] of [['8001', '2025', '7001', 3], ['7001', '2024', null, 7]]) {
  const lg = { ...league, league_id: id, season, previous_league_id: prev, status: 'complete' };
  const rs = users.map((u, i) => ({ roster_id: i + 1, owner_id: users[(i + shift) % 12].user_id, players: [], settings: {} }));
  const r = rng(Number(id));
  const skill = rs.map(() => 95 + r() * 35);
  const weeks = {};
  const rec = rs.map(() => ({ w: 0, pf: 0 }));
  for (let w = 1; w <= 17; w++) {
    const order = rs.map((_, i) => i).sort((a, b) => ((a * 7 + w * 5) % 12) - ((b * 7 + w * 5) % 12));
    weeks[w] = [];
    for (let k = 0; k < 12; k += 2) {
      const [a, b] = [order[k], order[k + 1]];
      const pa = +(skill[a] + (r() - 0.5) * 60).toFixed(2), pb = +(skill[b] + (r() - 0.5) * 60).toFixed(2);
      weeks[w].push({ roster_id: a + 1, matchup_id: k / 2 + 1, points: pa }, { roster_id: b + 1, matchup_id: k / 2 + 1, points: pb });
      if (w <= 14) { rec[a].pf += pa; rec[b].pf += pb; if (pa > pb) rec[a].w++; else rec[b].w++; }
    }
  }
  const seeds = rec.map((x, i) => ({ ...x, rid: i + 1 })).sort((a, b) => b.w - a.w || b.pf - a.pf).map((x) => x.rid);
  const win = (x, y) => (skill[x - 1] + (r() - 0.5) * 50 > skill[y - 1] + (r() - 0.5) * 50 ? [x, y] : [y, x]);
  const [w1, l1] = win(seeds[2], seeds[5]), [w2, l2] = win(seeds[3], seeds[4]);
  const [w3, l3] = win(seeds[0], w2), [w4, l4] = win(seeds[1], w1);
  const [ch, ru] = win(w3, w4), [t3, t4] = win(l3, l4), [f5, f6] = win(l1, l2);
  const bracket = [
    { r: 1, m: 1, t1: seeds[2], t2: seeds[5], w: w1, l: l1 }, { r: 1, m: 2, t1: seeds[3], t2: seeds[4], w: w2, l: l2 },
    { r: 2, m: 3, t1: seeds[0], t2: { w: 2 }, w: w3, l: l3 }, { r: 2, m: 4, t1: seeds[1], t2: { w: 1 }, w: w4, l: l4 },
    { r: 3, m: 5, t1: { w: 3 }, t2: { w: 4 }, w: ch, l: ru, p: 1 }, { r: 3, m: 6, t1: { l: 3 }, t2: { l: 4 }, w: t3, l: t4, p: 3 },
    { r: 2, m: 7, t1: { l: 1 }, t2: { l: 2 }, w: f5, l: f6, p: 5 },
  ];
  past[id] = { league: lg, rosters: rs, weeks, bracket };
}
// Current season: weeks already played feed history; bracket empty until playoffs.
const tradedPicks = [
  { season: '2027', round: 1, roster_id: 7, owner_id: 1, previous_owner_id: 7 },
  { season: '2027', round: 2, roster_id: 1, owner_id: 4, previous_owner_id: 1 },
  { season: '2028', round: 1, roster_id: 12, owner_id: 3, previous_owner_id: 12 },
];

// ---- Value sources & rookie class (fictional) ----
const RR = rng(2027);
const RLAST = 'Ashby Brennan Castillo Delacroix Ellsworth Fontaine Granger Hartwell Ingram Jameson Kensington Lindqvist Montague Nakamura Okafor Prescott Quintero Ramsey Sinclair Tolliver'.split(' ');
const COLLEGES = ['Lakeside', 'Riverton', 'Summit State', 'Bayview', 'Ironwood', 'Northern Tech', 'Coastal A&M', 'Pinecrest'];
const rookieClass = Array.from({ length: 36 }, (_, i) => {
  const pos = ['WR', 'RB', 'WR', 'QB', 'RB', 'TE', 'WR', 'RB'][i % 8];
  return {
    name: `${FIRST[(i * 7 + 3) % FIRST.length]} ${RLAST[i % RLAST.length]}${i >= RLAST.length ? ' Jr.' : ''}`, pos,
    college: COLLEGES[i % COLLEGES.length], age: +(20.5 + RR() * 2.5).toFixed(1),
    heightFeet: 6, heightInches: Math.floor(RR() * 5), weight: pos === 'RB' ? 190 + Math.floor(RR() * 35) : pos === 'TE' ? 235 + Math.floor(RR() * 20) : 175 + Math.floor(RR() * 40),
    ktc: Math.round(7600 * Math.exp(-i / 11) * (0.9 + RR() * 0.2)), dp: Math.round(9000 * Math.exp(-i / 12) * (0.85 + RR() * 0.3)),
  };
});
function ktcArray(rookiesOnly) {
  const vets = rookiesOnly ? [] : fcValues().map((r, i) => {
    const p = players[r.player.sleeperId];
    if (!['QB', 'RB', 'WR', 'TE'].includes(p.position)) return null;
    return { playerName: p.full_name, playerID: 10000 + i, position: p.position, team: p.team, age: p.age, rookie: false,
      oneQBValues: { value: Math.min(9999, Math.round(r.value * 1.7)), rank: 0, overallTrend: Math.round((R() - 0.5) * 300) }, superflexValues: { value: Math.round(r.value * 1.8), rank: 0 } };
  }).filter(Boolean);
  const rook = rookieClass.map((r, i) => ({ playerName: r.name, playerID: 50000 + i, position: r.pos, team: 'RFA', age: r.age, college: r.college, rookie: true,
    heightFeet: r.heightFeet, heightInches: r.heightInches, weight: r.weight,
    oneQBValues: { value: r.ktc, rank: i + 1, positionalRank: 0, overallTrend: Math.round((RR() - 0.4) * 200) }, superflexValues: { value: r.ktc, rank: i + 1 } }));
  const pk = rookiesOnly ? [] : ['2027', '2028', '2029'].flatMap((y) => ['Early', 'Mid', 'Late'].flatMap((t, ti) => [1, 2, 3].map((rd) => ({
    playerName: `${y} ${t} ${['1st', '2nd', '3rd'][rd - 1]}`, playerID: `${y}${t}${rd}`, position: 'RDP', team: '', rookie: false,
    oneQBValues: { value: Math.round([6200, 2900, 1300][rd - 1] * [1.25, 1, 0.82][ti] * (y === '2027' ? 1 : 0.92)) }, superflexValues: { value: 1 } }))));
  return [...vets, ...rook, ...pk];
}
const ktcHtml = (rookiesOnly) => `<html><script>var foo = 1; var playersArray = ${JSON.stringify(ktcArray(rookiesOnly))};\nvar other = [];</script></html>`;
const csv = (rows) => [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','))].join('\n');
function dpPlayersCsv() {
  const vets = fcValues().filter((r) => ['QB', 'RB', 'WR', 'TE'].includes(players[r.player.sleeperId].position)).map((r, i) => {
    const p = players[r.player.sleeperId];
    return { player: p.full_name, pos: p.position, team: p.team, age: p.age, draft_year: 2026 - p.years_exp, ecr_1qb: i + 1, ecr_2qb: i + 1, ecr_pos: 1, value_1qb: Math.round(r.value * 1.9), value_2qb: Math.round(r.value * 2), scrape_date: '2026-11-10', fp_id: `fp${p.player_id}` };
  });
  const rook = rookieClass.slice(0, 30).map((r, i) => ({ player: r.name, pos: r.pos, team: 'FA', age: r.age, draft_year: 2027, ecr_1qb: 150 + i * 4, ecr_2qb: 150 + i * 4, ecr_pos: i, value_1qb: r.dp, value_2qb: r.dp, scrape_date: '2026-11-10', fp_id: '' }));
  return csv([...vets, ...rook]);
}
const dpPicksCsv = () => csv(['2027', '2028'].flatMap((y) => [1, 2, 3].flatMap((rd) => (y === '2027'
  ? Array.from({ length: 12 }, (_, s) => ({ player: `${y} Pick ${rd}.${String(s + 1).padStart(2, '0')}`, pos: 'PICK', value_1qb: Math.round([7800, 3300, 1500][rd - 1] * (1 - s * 0.035)), value_2qb: 1 }))
  : [{ player: `${y} ${['1st', '2nd', '3rd'][rd - 1]}`, pos: 'PICK', value_1qb: [6500, 2800, 1200][rd - 1], value_2qb: 1 }]))));
const dpIdsCsv = () => csv(Object.values(players).filter((p) => p.position !== 'DEF').slice(0, 200).map((p) => ({ fantasypros_id: `fp${p.player_id}`, sleeper_id: p.player_id, name: p.full_name })));
function cfbd(u) {
  const team = u.searchParams.get('team'), year = Number(u.searchParams.get('year'));
  const r = rng(year + team.length);
  if (u.pathname === '/stats/season') return [
    { statName: 'netPassingYards', statValue: 3200 + Math.round(r() * 800) }, { statName: 'passingTDs', statValue: 26 + Math.round(r() * 10) },
    { statName: 'rushingYards', statValue: 1900 + Math.round(r() * 700) }, { statName: 'rushingTDs', statValue: 18 + Math.round(r() * 10) }];
  return rookieClass.filter((x) => x.college === team).flatMap((x) => {
    const g = 0.5 + r() * 0.6, row = (category, statType, stat) => ({ player: x.name, team, category, statType, stat: String(Math.round(stat)) });
    if (x.pos === 'QB') return [row('passing', 'ATT', 380 * g + 60), row('passing', 'YDS', 3300 * g), row('passing', 'TD', 28 * g), row('passing', 'INT', 4 + r() * 10), row('rushing', 'CAR', 90 * g), row('rushing', 'YDS', 600 * g), row('rushing', 'TD', 6 * g)];
    if (x.pos === 'RB') return [row('rushing', 'CAR', 200 * g), row('rushing', 'YDS', 1250 * g), row('rushing', 'TD', 13 * g), row('receiving', 'REC', 35 * g), row('receiving', 'YDS', 300 * g), row('receiving', 'TD', 2 * g)];
    return [row('receiving', 'REC', 70 * g), row('receiving', 'YDS', 1100 * g), row('receiving', 'TD', 10 * g)];
  });
}

export function handle(url) {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/v1/, '');
  let m;
  if (u.hostname.includes('sleeper')) {
    if (p === '/state/nfl') return { season: SEASON, league_season: SEASON, week: WEEK, display_week: WEEK, season_type: 'regular' };
    if ((m = p.match(/^\/user\/([^/]+)$/))) return users.find((x) => x.display_name === decodeURIComponent(m[1]) || x.user_id === m[1]) ?? null;
    if (/^\/user\/[^/]+\/leagues\/nfl\/\d+$/.test(p)) return [league];
    if (p === '/league/9001') return league;
    if (p === '/league/9001/winners_bracket') return [];
    if (p === '/league/9001/traded_picks') return tradedPicks;
    if ((m = p.match(/^\/league\/(8001|7001)(\/.*)?$/))) {
      const P = past[m[1]], sub = m[2] || '';
      if (!sub) return P.league;
      if (sub === '/rosters') return P.rosters;
      if (sub === '/users') return users;
      if (sub === '/winners_bracket') return P.bracket;
      if (sub === '/traded_picks') return [];
      const w = sub.match(/^\/matchups\/(\d+)$/);
      if (w) return P.weeks[Number(w[1])] || [];
    }
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
  if (u.hostname.includes('keeptradecut')) return ktcHtml(u.pathname.includes('rookie'));
  if (u.hostname.includes('githubusercontent')) return p.endsWith('values-players.csv') ? dpPlayersCsv() : p.endsWith('values-picks.csv') ? dpPicksCsv() : p.endsWith('db_playerids.csv') ? dpIdsCsv() : undefined;
  if (u.hostname.includes('collegefootballdata')) return cfbd(u);
  if (u.hostname.includes('youtube')) return ytXml();
  if (/espn|cbs|yahoo|nbcsports|rotoballer/.test(u.hostname)) return newsXml(u.hostname.length);
  return undefined;
}
