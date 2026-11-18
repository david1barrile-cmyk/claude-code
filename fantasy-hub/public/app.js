// Fantasy Hub front end: hash-routed views over the /api endpoints.
import { esc, columns, lines, hbars, stackedHbars, scatter, sparkline, legend, finishColor, divColor } from './charts.js';

const root = document.getElementById('root');
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
let session = store.get('fh.session'); // { userId, username, leagueId, leagueName, teamName, avatar }
let siteConfig = { leagueId: null };
let routeQuery = new URLSearchParams();

const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const sign = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${fmt(x, d)}`);
const k = (v) => (v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 10000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString());
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const ago = (t) => {
  if (!t) return '';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const trendCls = (x) => (x > 0.5 ? 'up' : x < -0.5 ? 'down' : '');

async function api(path, opts) {
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const L = (p = '') => `/league/${session.leagueId}${p}`;

// ---------- images (Sleeper CDN) with initials fallback ----------
const initials = (s) => String(s || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const FALLBACK = "this.replaceWith(Object.assign(document.createElement('span'),{className:this.className,textContent:this.alt}))";
function img(src, label, cls = '') {
  if (!src) return `<span class="av ${cls}">${esc(initials(label))}</span>`;
  return `<img class="av ${cls}" src="${esc(src)}" alt="${esc(initials(label))}" loading="lazy" onerror="${FALLBACK}">`;
}
const teamAv = (t, cls) => img(t?.avatar ? `https://sleepercdn.com/avatars/thumbs/${t.avatar}` : null, t?.name, cls);
const playerAv = (p, cls = 'sm') => img(p.pos === 'DEF' ? `https://sleepercdn.com/images/team_logos/nfl/${String(p.team || p.id).toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/thumb/${p.id}.jpg`, p.name, `player ${cls}`);

const posTag = (pos) => `<span class="pos" data-p="${esc(pos)}">${esc(pos)}</span>`;
const pname = (p) => `<a href="#/player/${esc(p.id)}">${esc(p.name)}</a>${p.injury ? `<span class="inj" title="${esc(p.injury)}">${esc(p.injury === 'Questionable' ? 'Q' : p.injury === 'Doubtful' ? 'D' : p.injury)}</span>` : ''}`;
const ptag = (p) => `<span class="who">${playerAv(p)}<span class="t"><span>${pname(p)}</span><small>${posTag(p.pos)} ${esc(p.team || '')}</small></span></span>`;
const teamTag = (t, sub) => `<span class="who">${teamAv(t, 'sm')}<span class="t"><span>${esc(t.name)}</span>${sub ? `<small>${sub}</small>` : ''}</span></span>`;
const form = (f = []) => `<span class="form">${f.map((r) => `<i class="${r}">${r}</i>`).join('')}</span>`;
const head = (title, sub, right = '') => `<div class="page-head"><div><div class="eyebrow">${esc(session?.leagueName || '')}</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${right}</div>`;
const card = (title, body, { span = 12, note = '', id = '' } = {}) => `<section class="card span-${span}" ${id ? `id="${id}"` : ''}><div class="card-head"><h2>${title}</h2>${note ? `<span class="muted">${note}</span>` : ''}</div>${body}</section>`;
const POS_COLORS = { QB: 'var(--qb)', RB: 'var(--rb)', WR: 'var(--wr)', TE: 'var(--te)', Picks: 'var(--pick)' };

function sortableTable(el) {
  el?.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const tbody = el.querySelector('tbody');
    const idx = [...th.parentNode.children].indexOf(th);
    const dir = th.dataset.dir === 'desc' ? 1 : -1;
    th.dataset.dir = dir === 1 ? 'asc' : 'desc';
    const val = (tr) => { const t = tr.children[idx].dataset.v ?? tr.children[idx].textContent; const n = parseFloat(t); return Number.isNaN(n) ? t : n; };
    [...tbody.rows].sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; }).forEach((r) => tbody.appendChild(r));
  }));
}

// ---------- shell ----------
const ICONS = {
  '': '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  power: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  history: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  team: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  waivers: '<path d="M12 5v14M5 12h14"/>',
  analyzer: '<path d="M12 3v18M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
  trades: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  rookies: '<path d="M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.5 6.5 19.5l1-6.3L3 8.9 9 8z"/>',
  metrics: '<path d="M3 3v18h18M7 15l4-4 3 3 6-6"/>',
  news: '<path d="M4 5h13v14H5a1 1 0 0 1-1-1zM17 9h3v9a1 1 0 0 1-1 1h-2M7 9h7M7 13h7M7 16h4"/>',
  grades: '<path d="M9 3h6l1 2h3v16H5V5h3zM9 3v3h6V3M8.5 13l2 2 4.5-5"/>',
  gazette: '<path d="M3 6h15v13H4a1 1 0 0 1-1-1zM18 10h3v8a1 1 0 0 1-2 0v-8M6 9h9M6 12h4M6 15h4M12 12h3v3h-3z"/>',
};
const GROUPS = [
  { name: 'League', icon: '', items: [['', 'Dashboard'], ['gazette', 'League Gazette'], ['awards', 'Awards'], ['power', 'Power Rankings'], ['history', 'League History'], ['rivalry', 'Rivalries'], ['wrapped', 'Season Wrapped']] },
  { name: 'My Team', icon: 'team', items: [['team', 'My Team'], ['waivers', 'Waivers']] },
  { name: 'Trades', icon: 'analyzer', items: [['analyzer', 'Trade Analyzer'], ['grades', 'Trade Grades'], ['decks', 'Pitch Decks'], ['trades', 'Trade Finder']] },
  { name: 'Players', icon: 'rookies', items: [['rookies', 'Rookies'], ['drafts', 'Draft Grades'], ['metrics', 'Metrics'], ['news', 'News & Highlights']] },
];
ICONS.status = '<path d="M3 12h4l3-8 4 16 3-8h4"/>';
ICONS.awards = '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>';
ICONS.rivalry = '<path d="M5 19 19 5M9 5H5v4M19 15v4h-4M15 9l4-4M5 19l4-4"/>';
ICONS.wrapped = '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 11h18M12 7v14M12 7c-2-4-6-4-6-1s4 1 6 1c2 0 6 2 6-1s-4-3-6 1"/>';
ICONS.decks = '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M12 16v4M8 20h8M7 12l3-3 2 2 4-4"/>';
ICONS.drafts = '<path d="M4 4h16v16H4zM4 9h16M9 4v16"/>';
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

function renderShell(active) {
  const group = GROUPS.find((g) => g.items.some(([h]) => h === active)) || GROUPS[0];
  root.innerHTML = `<div class="shell">
    <aside class="side">
      <a href="#/" class="brand"><span class="ball">🏈</span>Fantasy Hub</a>
      <nav class="nav-full">${GROUPS.map((g) => `<div class="nav-group">${esc(g.name)}</div>${g.items.map(([h, label]) => `<a href="#/${h}" class="${h === active ? 'active' : ''}">${icon(h)}${label}</a>`).join('')}`).join('')}</nav>
      <nav class="nav-sub">${group.items.map(([h, label]) => `<a href="#/${h}" class="${h === active ? 'active' : ''}">${label}</a>`).join('')}</nav>
      <div class="grow"></div>
      <a class="status-link" href="#/status">${icon('status')}Data status</a>
      <div class="me">${teamAv({ name: session.teamName || session.username, avatar: session.avatar })}<div><b>${esc(session.teamName || session.username)}</b><small>${esc(session.leagueName)}</small></div></div>
      <div class="side-actions"><button id="theme" title="Toggle light/dark">◐</button><button id="switch">Switch</button></div>
    </aside>
    <main class="main" id="app"><div class="grid">${'<div class="skeleton span-6"></div>'.repeat(4)}</div></main>
    <nav class="tabbar">${GROUPS.map((g) => `<a href="#/${g.items[0][0]}" class="${g === group && active !== 'status' ? 'active' : ''}">${icon(g.icon)}<span>${esc(g.name)}</span></a>`).join('')}</nav>
  </div>`;
  document.getElementById('switch').onclick = () => { store.del('fh.session'); session = null; location.hash = '#/connect'; route(); };
  document.getElementById('theme').onclick = () => {
    const cur = document.documentElement.dataset.theme;
    const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('fh.theme', next); } catch { /* ignore */ }
    route();
  };
  return document.getElementById('app');
}

// ---------- connect ----------
async function viewConnect() {
  root.innerHTML = `<div class="connect-wrap"><div class="card connect" id="cc"><p class="muted">Loading…</p></div></div>`;
  const cc = document.getElementById('cc');
  const finish = (s) => { session = s; store.set('fh.session', s); location.hash = '#/'; route(); };

  if (siteConfig.leagueId) {
    cc.innerHTML = `<div class="eyebrow">Welcome to</div><h1>${esc(siteConfig.leagueName)}</h1>
      <p class="muted">Pick your team to personalize waiver, trade and lineup advice.</p>
      <div class="team-pick">${siteConfig.teams.map((t) => `<button data-o="${esc(t.ownerId)}">${teamAv(t, 'sm')}<span><b>${esc(t.name)}</b><br><small class="muted">${esc(t.owner || '')}</small></span></button>`).join('')}</div>`;
    cc.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', () => {
      const t = siteConfig.teams.find((x) => x.ownerId === b.dataset.o);
      finish({ userId: t.ownerId, username: t.owner, leagueId: siteConfig.leagueId, leagueName: siteConfig.leagueName, teamName: t.name, avatar: t.avatar });
    }));
    return;
  }
  cc.innerHTML = `<div class="eyebrow">Fantasy Hub</div><h1>Connect your Sleeper league</h1>
    <p class="muted">Enter your Sleeper username. No password or API key needed: Sleeper's league data is public and read-only.</p>
    <form id="f" class="row"><input id="u" placeholder="Sleeper username" autocomplete="username" value="${esc(session?.username || '')}" required><button class="primary">Find leagues</button></form>
    <div id="out"></div>`;
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = document.getElementById('out');
    out.innerHTML = '<p class="muted">Looking up leagues…</p>';
    try {
      const d = await api(`/user/${encodeURIComponent(document.getElementById('u').value.trim())}/leagues`);
      if (!d.leagues.length) { out.innerHTML = `<p class="err">No ${esc(d.season)} NFL leagues found for ${esc(d.user.name)}.</p>`; return; }
      out.innerHTML = `<div class="leagues"><h3>${esc(d.season)} leagues for ${esc(d.user.name)}</h3>${d.leagues.map((l) =>
        `<button data-id="${esc(l.id)}" data-name="${esc(l.name)}">${teamAv({ name: l.name, avatar: l.avatar }, 'sm')}<span><b>${esc(l.name)}</b> <span class="muted">· ${l.teams} teams</span></span></button>`).join('')}</div>`;
      out.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
        const lg = await api(`/league/${b.dataset.id}`);
        const me = lg.teams.find((t) => t.ownerId === d.user.id);
        finish({ userId: d.user.id, username: d.user.name, leagueId: b.dataset.id, leagueName: b.dataset.name, teamName: me?.name, avatar: me?.avatar ?? d.user.avatar });
      }));
    } catch (err) { out.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  });
}

// ---------- dashboard ----------
async function viewDashboard($) {
  const gz = api(L('/gazette')).catch(() => null);
  const [lg, mu, weekly, power, wv, tx, news] = await Promise.all([
    api(L()), api(L('/matchups')), api(L('/weekly')).catch(() => null), api(L('/power')).catch(() => null),
    api(L(`/waivers?owner=${session.userId}`)).catch(() => null), api(L('/transactions')).catch(() => []), api('/news').catch(() => ({ items: [] })),
  ]);
  const me = lg.teams.find((t) => t.ownerId === session.userId);
  const standRank = lg.teams.indexOf(me) + 1;
  const pfRank = [...lg.teams].sort((a, b) => b.pf - a.pf).indexOf(me) + 1;
  const pr = power?.season.find((t) => t.ownerId === session.userId);
  const dyn = power?.dynasty.teams.find((t) => t.ownerId === session.userId);
  const myMu = mu.matchups.find((m) => m.some((x) => x.rosterId === me?.rosterId));
  const [a, b] = myMu ? (myMu[0].rosterId === me.rosterId ? myMu : [myMu[1], myMu[0]]) : [];
  const opp = b && lg.teams.find((t) => t.rosterId === b.rosterId);
  const wk = weekly?.teams.find((t) => t.ownerId === session.userId);
  const apByOwner = Object.fromEntries((weekly?.teams || []).map((t) => [t.ownerId, t]));

  $.innerHTML = `<div class="grid">
    <section class="card hero span-7">
      <div class="hero-team">${teamAv(me, 'lg')}<div><div class="eyebrow">${esc(lg.name)} · ${esc(lg.format)}</div><h1>${esc(me?.name || session.teamName || '')}</h1></div></div>
      <div class="hero-stats">
        <div><b>${me ? `${me.wins}-${me.losses}${me.ties ? `-${me.ties}` : ''}` : '—'}</b><span>Record · ${standRank ? ordinal(standRank) : '—'}</span></div>
        <div><b>${pr ? `#${pr.rank}` : '—'}</b><span>Power rank</span></div>
        <div><b>${dyn ? `#${dyn.ranks[0]}` : '—'}</b><span>Dynasty rank</span></div>
        ${power?.odds ? (() => { const o = power.odds.teams.find((t) => t.ownerId === session.userId); return o ? `<div><b>${o.playoffOdds >= 99.95 ? '>99' : o.playoffOdds < 0.5 ? '<1' : Math.round(o.playoffOdds)}%</b><span>Playoff odds</span></div>` : ''; })() : ''}
        <div><b>${me ? k(me.pf) : '—'}</b><span>Points for · ${pfRank ? ordinal(pfRank) : ''}</span></div>
        ${wk ? `<div><b>${wk.apW}-${wk.apL}</b><span>All-play</span></div>` : ''}
      </div>
    </section>
    <section class="card span-5">
      <div class="card-head"><h2>Week ${mu.week} matchup</h2><span class="muted">projection-based</span></div>
      ${a && b ? `<div class="mu">${teamTag(me, 'You')}<div class="vs">VS</div><span class="who side-b">${teamAv(opp, 'sm')}<span class="t"><span>${esc(opp?.name)}</span><small>${opp ? `${opp.wins}-${opp.losses}` : ''}</small></span></span></div>
        <div class="mu" style="margin-top:10px"><div class="score">${fmt(a.points, 1)}</div><div></div><div class="score" style="justify-self:end">${fmt(b.points, 1)}</div></div>
        <div class="row small muted" style="justify-content:space-between"><span>Proj ${fmt(a.projected)}</span><span>Proj ${fmt(b.projected)}</span></div>
        <div class="prob"><div class="bar"><i style="width:${a.winProb}%"></i><i style="width:${b.winProb}%"></i></div>
        <div class="lbl"><span><b>${a.winProb}%</b> win probability</span><span>${b.winProb}%</span></div></div>` : '<p class="muted">No matchup this week.</p>'}
    </section>

    <section class="card span-12" id="gz-card" style="display:none"></section>
    ${card('Scoring by week', '<div id="c-weekly"></div>', { span: 8, note: 'Your team vs league average' })}
    ${card('Power rankings', `<div id="c-power"></div><p class="small"><a href="#/power">Full rankings & dynasty outlook →</a></p>`, { span: 4, note: 'record + all-play + lineup' })}

    ${card('Standings', `<div class="scroll"><table>
      <thead><tr><th></th><th>Team</th><th class="num">W-L</th><th class="num">PF</th><th class="num">All-play</th><th class="num" title="Actual wins minus all-play expected wins">Luck</th><th>Last 5</th></tr></thead>
      <tbody>${lg.teams.map((t, i) => {
        const ap = apByOwner[t.ownerId];
        const g = t.wins + t.losses + t.ties;
        const exp = ap && ap.apW + ap.apL ? (ap.apW / (ap.apW + ap.apL)) * g : null;
        const luck = exp == null ? null : t.wins + t.ties / 2 - exp;
        return `<tr class="${t.ownerId === session.userId ? 'me' : ''}"><td class="rank">${i + 1}</td><td>${teamTag(t, esc(t.owner || ''))}</td>
          <td class="num"><b>${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}</b></td><td class="num">${fmt(t.pf)}</td>
          <td class="num">${ap ? `${ap.apW}-${ap.apL}` : '—'}</td><td class="num ${trendCls(luck)}">${sign(luck)}</td><td>${form(ap?.form)}</td></tr>`;
      }).join('')}</tbody></table></div>`, { span: 8 })}
    ${card(`Week ${mu.week} around the league`, mu.matchups.filter((m) => m.length === 2).map(([x, y]) => `<div class="mini-mu">
        <div>${esc(x.name)}<br><b>${fmt(x.points)}</b> <span class="muted small">${x.winProb}%</span></div><span class="muted small">vs</span>
        <div class="b">${esc(y.name)}<br><span class="muted small">${y.winProb}%</span> <b>${fmt(y.points)}</b></div></div>`).join(''), { span: 4 })}

    ${card('Top waiver targets for you', wv ? wv.recs.slice(0, 5).map((r) => `<div class="li row" style="justify-content:space-between">${ptag(r)}
        ${r.kind === 'upgrade' ? `<span class="chip good">+${fmt(r.gain)} pts/wk</span>` : '<span class="chip warn">Stash</span>'}</div>`).join('') + '<p class="small"><a href="#/waivers">All waiver advice →</a></p>' : '<p class="muted">Unavailable</p>', { span: 4 })}
    ${card('League activity', tx.length ? tx.slice(0, 6).map((t) => `<div class="li"><div class="row small"><span class="chip ${t.type === 'trade' ? 'warn' : ''}">${esc(t.type.replace('_', ' '))}</span><span class="muted">${ago(t.at)}${t.faab != null ? ` · $${t.faab} FAAB` : ''}</span></div>
        ${t.adds.map((x) => `<div class="row" style="margin-top:6px"><span class="up">＋</span>${ptag(x)}<span class="muted small">→ ${esc(x.to)}</span></div>`).join('')}
        ${t.drops.map((x) => `<div class="row" style="margin-top:4px"><span class="down">－</span>${ptag(x)}</div>`).join('')}</div>`).join('') : '<p class="muted">No recent transactions.</p>', { span: 4 })}
    ${card('Latest news', news.items.slice(0, 7).map((n) => `<div class="li"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="small muted">${esc(n.source)} · ${ago(n.published)}</div></div>`).join('') + '<p class="small"><a href="#/news">News & highlights →</a></p>', { span: 4 })}
  </div>`;

  gz.then((g) => {
    const el = document.getElementById('gz-card');
    if (!el || !g?.edition) return;
    const e = g.edition;
    el.style.display = '';
    el.innerHTML = `<div class="card-head"><h2>📰 From the League Gazette · Week ${e.week}</h2><a class="small" href="#/gazette">Read the full edition →</a></div>
      <div style="font:700 12px/1 var(--font);letter-spacing:.12em;text-transform:uppercase;color:var(--bad-ink)">${esc(e.lead.kicker)}</div>
      <div style="font:900 26px/1.15 'Playfair Display',Georgia,serif;margin:6px 0">${esc(e.lead.headline)}</div>
      <div class="muted" style="font-family:'Source Serif 4',Georgia,serif;font-size:15px">${esc(e.lead.body)}</div>`;
  });
  if (weekly?.weeks.length && wk) {
    const byWeek = Object.fromEntries(wk.weekly.map((w) => [w.week, w.pts]));
    lines(document.getElementById('c-weekly'), {
      xs: weekly.weeks, xFmt: (w) => `W${w}`, xLabel: 'Week', yFmt: (v) => fmt(v, 0),
      series: [
        { label: 'You', color: 'var(--series-me)', values: weekly.weeks.map((w) => ({ y: byWeek[w] ?? null })) },
        { label: 'Avg', color: 'var(--series-ref)', dashed: true, dots: false, values: weekly.average.map((a) => ({ y: a.pts })) },
      ],
    });
    document.getElementById('c-weekly').insertAdjacentHTML('beforebegin', legend([{ label: 'Your team', color: 'var(--series-me)', line: true }, { label: 'League average', color: 'var(--series-ref)', line: true, dashed: true }]));
  } else document.getElementById('c-weekly').innerHTML = '<p class="muted">No completed weeks yet.</p>';
  if (power) {
    hbars(document.getElementById('c-power'), {
      rows: power.season.map((t) => ({ label: `${t.rank}. ${t.name}`, value: t.score, highlight: t.ownerId === session.userId, t })),
      max: 100, labelW: 150, rowH: 26, fmt: (v) => v,
      tipFn: (r) => `<b>${esc(r.t.name)}</b>Score ${r.t.score} · ${r.t.wins}-${r.t.losses}<br>All-play ${pct(r.t.apPct)} · Lineup ${fmt(r.t.lineup)} pts`,
    });
  }
}

// ---------- power rankings ----------
async function viewPower($) {
  const d = await api(L('/power'));
  const adjMode = routeQuery.get('values') === 'adj' && d.dynastyAdj;
  const dyn = (adjMode ? d.dynastyAdj : d.dynasty).teams;
  if (adjMode) d.dynasty = d.dynastyAdj;
  const season = d.season;
  const yearLbl = (y) => (y === 0 ? 'Now' : `${Number(d.draftSeason) - 1 + y}`);
  const move = (a, b) => (b < a ? `<span class="rankmove up">▲${a - b}</span>` : b > a ? `<span class="rankmove down">▼${b - a}</span>` : '<span class="rankmove muted">–</span>');
  const tier = (t) => {
    const cur = season.find((s) => s.ownerId === t.ownerId);
    const now = cur ? cur.rank <= season.length / 2 : false;
    const fut = t.ranks[3] <= dyn.length / 2;
    return now && fut ? ['Dynasty', 'good'] : now ? ['Win now', 'warn'] : fut ? ['Rising', 'good'] : ['Rebuild', 'bad'];
  };

  $.innerHTML = `${head('Power Rankings', `Two views of the league. <b>This season</b> blends record (25%), all-play record (35%) and current lineup strength (40%). <b>Dynasty</b> totals roster and draft-pick trade value (${esc(d.dynasty.source)}; picks valued by ${esc(d.dynasty.pickSource === 'Estimated' ? 'an estimate' : d.dynasty.pickSource)}) and projects it 1–3 years out with position-specific age curves.`)}
  <div class="grid">
    ${d.odds ? card('Projected season finish', `<div class="grid" style="gap:24px">
        <div class="span-12"><h3 style="margin-top:0">Chance of each final standing</h3><div id="c-finish"></div></div>
        <div class="span-12"><h3 style="margin-top:0">Projected final wins</h3><div id="c-wins" style="max-width:760px"></div>
          <div class="legend" style="margin-top:8px"><span><i style="background:var(--bar-muted)"></i>80% range</span><span><i style="background:var(--series-me);border-radius:50%"></i>Average</span><span><i style="background:var(--ink);width:2px"></i>Wins today</span></div></div></div>
      <p class="small muted">${d.odds.sims.toLocaleString()} simulated seasons over the remaining ${d.odds.remaining.length} week${d.odds.remaining.length === 1 ? '' : 's'} (${d.odds.remaining.length ? `weeks ${d.odds.remaining[0]}–${d.odds.remaining.at(-1)}` : 'none left'}) on your real schedule${d.odds.gamesTotal > d.odds.throughWeek + d.odds.remaining.length ? ', including the weekly game against the median' : ''}. Each team's weekly score is drawn around its strength (best lineup today blended with points per week so far) with its own week-to-week swing. Top ${d.odds.spots} make the playoffs${d.odds.byes ? `; top ${d.odds.byes} get a bye` : ''}; the bracket is simulated too, for final and title odds.</p>`, { span: 12, note: 'playoff odds by simulation' }) : ''}
    ${card('This season', `<div id="c-season"></div>`, { span: 5, note: 'score 0–100' })}
    ${card('Contender or rebuilder?', `<div id="c-quad"></div>`, { span: 7, note: 'current strength vs. long-term value' })}
    ${d.dynastyAdj ? `<section class="span-12 row" style="justify-content:space-between">
      <div class="seg" id="valmode"><button data-v="" class="${adjMode ? '' : 'on'}">Market values</button><button data-v="adj" class="${adjMode ? 'on' : ''}">League-adjusted</button></div>
      <span class="small muted">Applies to the dynasty sections below. Market = trade-value sites as-is; league-adjusted = re-priced for this league's lineup and size.</span></section>` : ''}
    ${adjMode && d.adjust ? card('How the league adjustment works', `<p class="small" style="margin-top:0">Trade-value sites assume a typical 12-team league. Here, a player's value also depends on how easy it is to find a startable replacement. We count the players who actually start at each position across this league's ${d.adjust.teams} best lineups (flex and superflex included), compare with a typical 12-team league, and shift every player at the position by the value gap between the two replacement-level players. FantasyCalc is already asked for this league's size and is used as-is; the layer is the median of KTC adjusted, DynastyProcess adjusted and FantasyCalc.</p>
      <div class="scroll"><table><thead><tr><th>Position</th><th class="num">Starters here</th><th class="num">Typical 12-team</th><th class="num">KTC shift</th><th class="num">DP shift</th><th>Effect</th></tr></thead><tbody>
      ${['QB', 'RB', 'WR', 'TE'].map((p) => { const k2 = d.adjust.shifts.KTC?.[p], dp2 = d.adjust.shifts.DP?.[p]; const sh = k2?.shift ?? 0;
        return `<tr><td>${posTag(p)}</td><td class="num">${d.adjust.demandLeague[p]}</td><td class="num">${d.adjust.demandStd[p]}</td><td class="num ${sh > 0 ? 'down' : sh < 0 ? 'up' : ''}">${sh > 0 ? '−' : '+'}${Math.abs(sh).toLocaleString()}</td><td class="num">${dp2 ? `${dp2.shift > 0 ? '−' : '+'}${Math.abs(dp2.shift).toLocaleString()}` : '—'}</td>
          <td class="small">${sh > 300 ? 'Easier to replace here: worth less' : sh < -150 ? 'Harder to replace here: worth more' : 'About the same'}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="small muted">Trades also discount extra pieces: anything beyond the number of assets the other side sends counts at ${Math.round(d.adjust.depthDiscount * 100)}%, because ${[8, 11, 18].includes(d.adjust.teams) ? 'an' : 'a'} ${d.adjust.teams}-team waiver wire is deep. Picks are valued by overall pick number (your 2.05 is overall pick ${(2 - 1) * d.adjust.teams + 5}).</p>
      <p class="small muted"><b>Next year's picks are tied to prospects.</b> Each pick's chance of landing in each slot comes from the season simulation (draft order = reverse regular-season standings), and each slot is matched to the prospect the rookie board has there. The expected value is blended with the market pick value: 50/50 until the NFL Draft, 90/10 after, because rankings and landing spots still move.</p>`, { span: 12 }) : ''}
    ${card('Dynasty value by position', `<div class="row" style="justify-content:space-between;margin-bottom:6px">${legend(Object.entries(POS_COLORS).map(([label, color]) => ({ label, color })))}
      <div class="seg" id="yr">${[0, 1, 2, 3].map((y) => `<button data-y="${y}" class="${y ? '' : 'on'}">${yearLbl(y)}</button>`).join('')}</div></div><div id="c-dyn"></div>`, { span: 12 })}
    ${card('Dynasty outlook', `<div class="scroll"><table id="dyn-t">
      <thead><tr><th>#</th><th>Team</th><th>Tier</th><th class="num">Value</th><th>3-yr trend</th>${[1, 2, 3].map((y) => `<th class="num">${yearLbl(y)}</th>`).join('')}<th class="num">Avg age</th><th>Top assets</th><th class="num">Picks</th></tr></thead>
      <tbody>${dyn.map((t) => { const [tl, tc] = tier(t); return `<tr class="${t.ownerId === session.userId ? 'me' : ''}">
        <td class="rank">${t.ranks[0]}</td><td>${teamTag(t)}</td><td><span class="chip ${tc}">${tl}</span></td><td class="num"><b>${k(t.total)}</b></td>
        <td>${sparkline(t.projected, { color: t.ownerId === session.userId ? 'var(--series-me)' : 'var(--series-ref)' })} <span class="small ${trendCls(t.projected[3] - t.projected[0])}">${sign(Math.round(((t.projected[3] - t.projected[0]) / t.projected[0]) * 100), 0)}%</span></td>
        ${[1, 2, 3].map((y) => `<td class="num">#${t.ranks[y]} ${move(t.ranks[0], t.ranks[y])}</td>`).join('')}
        <td class="num">${fmt(t.avgAge)}</td>
        <td class="small">${t.top.slice(0, 3).map((p) => `<div style="white-space:nowrap;line-height:1.9">${posTag(p.pos)} <a href="#/player/${esc(p.id)}">${esc(p.name)}</a> <span class="muted">${p.age ?? ''}</span></div>`).join('')}</td>
        <td class="num" title="${esc(t.picks.map((p) => `${p.season} R${p.round}${p.from ? ` (from ${p.from})` : ''}`).join(', '))}">${t.picks.filter((p) => p.round === 1).length} 1sts · ${k(t.byPos.Picks)}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="small muted">Hover the Picks column to see each team's picks. Tiers compare this season's power rank with the projected dynasty rank 3 years out.</p>`, { span: 12 })}
    ${card('Season power table', `<div class="scroll"><table>
      <thead><tr><th>#</th><th>Team</th><th class="num">Score</th><th class="num">Record</th><th class="num">All-play</th><th class="num">Best lineup</th><th>Last 5</th></tr></thead>
      <tbody>${season.map((t) => `<tr class="${t.ownerId === session.userId ? 'me' : ''}"><td class="rank">${t.rank}</td><td>${teamTag(t)}</td><td class="num"><b>${t.score}</b></td>
        <td class="num">${t.wins}-${t.losses}</td><td class="num">${pct(t.apPct)}</td><td class="num">${fmt(t.lineup)}</td><td>${form(t.form)}</td></tr>`).join('')}</tbody></table></div>`, { span: 12 })}
  </div>`;

  if (d.odds) renderOdds(d.odds);
  document.querySelectorAll('#valmode button').forEach((b) => b.addEventListener('click', () => { location.hash = `#/power${b.dataset.v ? '?values=adj' : ''}`; }));
  hbars(document.getElementById('c-season'), {
    rows: season.map((t) => ({ label: `${t.rank}. ${t.name}`, value: t.score, highlight: t.ownerId === session.userId, t })), max: 100, fmt: (v) => v,
    tipFn: (r) => `<b>${esc(r.t.name)}</b>Record ${pct(r.t.components.record)} · All-play ${pct(r.t.components.allPlay)} · Lineup ${pct(r.t.components.lineup)} (percentile within league)`,
  });
  scatter(document.getElementById('c-quad'), {
    points: dyn.map((t) => ({ x: season.find((s) => s.ownerId === t.ownerId)?.lineup ?? 0, y: t.projected[2], label: t.name, highlight: t.ownerId === session.userId })),
    xLabel: 'Best lineup now (pts/wk)', yLabel: 'Dynasty value in 2 yrs', xFmt: (v) => fmt(v), yFmt: k,
    quadrants: ['Rising', 'Dynasty', 'Rebuild', 'Win now'],
  });
  const drawDyn = (y) => {
    const scale = (t) => (t.total ? t.projected[y] / t.total : 1);
    const rows = [...dyn].sort((a, b) => b.projected[y] - a.projected[y]).map((t) => {
      // Picks hold value; player positions shrink/grow with the age projection.
      const playerTot = t.total - t.byPos.Picks, projPlayers = t.projected[y] - t.byPos.Picks;
      const f = playerTot ? projPlayers / playerTot : scale(t);
      return { label: t.name, highlight: t.ownerId === session.userId, parts: { QB: t.byPos.QB * f, RB: t.byPos.RB * f, WR: t.byPos.WR * f, TE: t.byPos.TE * f, Picks: t.byPos.Picks } };
    });
    const el = document.getElementById('c-dyn'); el._w = null;
    stackedHbars(el, { rows, keys: Object.keys(POS_COLORS), colors: POS_COLORS, fmt: k, labelW: 160 });
  };
  drawDyn(0);
  document.querySelectorAll('#yr button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#yr button').forEach((x) => x.classList.toggle('on', x === b));
    drawDyn(Number(b.dataset.y));
  }));
}

function renderOdds(o) {
  const teams = [...o.teams].sort((a, b) => b.projWins - a.projWins);
  const maxW = o.gamesTotal || Math.max(...teams.map((t) => t.winsP90), 1);
  const x = (w) => `${(w / maxW) * 100}%`;
  document.getElementById('c-wins').innerHTML = teams.map((t) => {
    const me = t.ownerId === session.userId;
    return `<div class="bullet" style="grid-template-columns:120px 1fr 64px" data-tip="${esc(`<b>${esc(t.name)}</b>Projected ${t.projWins} wins (80%: ${t.winsP10}–${t.winsP90})<br>Now ${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''} · Playoffs ${t.playoffOdds}%`)}">
      <span class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${me ? '<b>' : ''}${esc(t.name)}${me ? '</b>' : ''}</span>
      <div class="track" style="background:var(--surface-2)">
        <div style="position:absolute;top:2px;bottom:2px;left:${x(t.winsP10)};width:calc(${x(t.winsP90)} - ${x(t.winsP10)});min-width:4px;background:var(--bar-muted);border-radius:4px"></div>
        <div class="mark" style="left:${x(t.wins)}"></div>
        <div style="position:absolute;top:50%;left:${x(t.projWins)};width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:${me ? 'var(--series-me)' : 'var(--series-ref)'};border:2px solid var(--surface)"></div>
      </div>
      <span class="small num" style="text-align:right"><b>${fmt(t.projWins)}</b> W</span></div>`;
  }).join('') + `<div class="small muted" style="display:flex;justify-content:space-between;margin-left:130px;margin-right:74px"><span>0</span><span>${maxW} games</span></div>`;
  const n = o.teams.length;
  const cellColor = (p) => {
    if (p < 0.5) return ['transparent', 'var(--muted)'];
    const steps = ['--seq-7', '--seq-6', '--seq-5', '--seq-4', '--seq-3', '--seq-2', '--seq-1'];
    const k = Math.min(steps.length - 1, Math.floor((p / 70) * steps.length));
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    return [`var(${steps[k]})`, (dark ? k <= 3 : k >= 4) ? '#ffffff' : 'var(--ink)'];
  };
  document.getElementById('c-finish').innerHTML = `<div class="scroll"><table class="heat">
    <thead><tr><th>Team</th>${Array.from({ length: n }, (_, i) => `<th class="rot">${ordinal(i + 1)}</th>`).join('')}<th class="num">Playoffs</th>${o.byes ? '<th class="num">Bye</th>' : ''}<th class="num" title="Chance to reach the championship game">Final</th><th class="num" title="Chance to win the title">Title</th></tr></thead>
    <tbody>${o.teams.map((t) => `<tr class="${t.ownerId === session.userId ? 'me' : ''}"><td>${teamTag({ name: t.name, avatar: t.avatar }, `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`)}</td>
      ${t.finishDist.map((p, i) => { const [bg, fg] = cellColor(p); return `<td class="cell" style="background:${bg};color:${fg}" data-tip="${esc(`<b>${esc(t.name)}</b>${p}% chance to finish ${ordinal(i + 1)}`)}">${p >= 0.5 ? Math.round(p) : ''}</td>`; }).join('')}
      <td class="num"><span class="chip ${t.playoffOdds >= 75 ? 'good' : t.playoffOdds <= 25 ? 'bad' : 'warn'}">${t.playoffOdds >= 99.95 ? 'Clinched*' : t.playoffOdds < 0.05 ? 'Out*' : `${fmt(t.playoffOdds)}%`}</span></td>
      ${o.byes ? `<td class="num">${fmt(t.byeOdds)}%</td>` : ''}<td class="num">${t.finalOdds != null ? `${fmt(t.finalOdds)}%` : '—'}</td><td class="num"><b>${t.titleOdds != null ? `${fmt(t.titleOdds)}%` : '—'}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Cells: % chance of finishing in that place (darker = likelier). *In every simulation; not an official clinch.</p>`;
}

// ---------- history ----------
async function viewHistory($) {
  const h = await api(L('/history'));
  const name = (id) => h.names[id]?.name || id;
  const tm = (id) => ({ name: name(id), avatar: h.names[id]?.avatar });
  const seasons = [...h.seasons].reverse(); // oldest → newest for columns
  const n = Math.max(...h.seasons.map((s) => s.standings.length));
  const owners = h.owners;
  const R = h.records;
  const champs = h.seasons.filter((s) => s.champion);

  $.innerHTML = `${head('League History', `${h.seasons.length} season${h.seasons.length === 1 ? '' : 's'} on Sleeper (${esc(seasons[0]?.season)}–${esc(seasons.at(-1)?.season)}). Regular-season records; finishes include playoffs.`)}
  <div class="grid">
    ${card('Champions', champs.length ? `<div class="trophies">${champs.map((s) => `<div class="trophy"><span class="yr">${esc(s.season)}</span>${teamAv(tm(s.champion), 'sm')}<div><b>${esc(name(s.champion))}</b><div class="small muted">def. ${esc(name(s.runnerUp))}</div></div></div>`).join('')}</div>` : '<p class="muted">No completed seasons yet.</p>', { span: 12 })}
    ${card('All-time standings', `<div class="scroll"><table id="at">
      <thead><tr><th>Team</th><th class="num" data-sort>🏆</th><th class="num" data-sort>Seasons</th><th class="num" data-sort>W-L</th><th class="num" data-sort>Win %</th><th class="num" data-sort>All-play %</th><th class="num" data-sort title="Actual wins minus all-play expected wins">Luck</th><th class="num" data-sort>Playoffs</th><th class="num" data-sort>PF</th></tr></thead>
      <tbody>${owners.map((o) => `<tr class="${o.ownerId === session.userId ? 'me' : ''}"><td>${teamTag({ name: o.name, avatar: o.avatar }, esc(o.user || ''))}</td>
        <td class="num" data-v="${o.titles}">${o.titles ? '🏆'.repeat(o.titles) : '—'}</td><td class="num">${o.seasons}</td><td class="num" data-v="${o.wins}">${o.wins}-${o.losses}${o.ties ? `-${o.ties}` : ''}</td>
        <td class="num" data-v="${o.winPct}"><b>${pct(o.winPct)}</b></td><td class="num" data-v="${o.apPct}">${pct(o.apPct)}</td><td class="num ${trendCls(o.luck)}" data-v="${o.luck}">${sign(o.luck)}</td>
        <td class="num">${o.playoffs}</td><td class="num" data-v="${o.pf}">${k(o.pf)}</td></tr>`).join('')}</tbody></table></div>`, { span: 12 })}
    ${card('All-time win %', '<div id="c-winpct"></div>', { span: 6, note: 'regular season' })}
    ${card('Luck: wins above expectation', '<div id="c-luck"></div>', { span: 6, note: 'actual wins − all-play expected wins' })}
    ${card('Finish by season', `<div class="scroll"><table class="heat">
      <thead><tr><th>Team</th>${seasons.map((s) => `<th class="rot">${esc(s.season)}${s.complete ? '' : '*'}</th>`).join('')}<th class="num">Avg</th></tr></thead>
      <tbody>${[...owners].sort((a, b) => avgFinish(a) - avgFinish(b)).map((o) => `<tr class="${o.ownerId === session.userId ? 'me' : ''}"><td>${teamTag({ name: o.name, avatar: o.avatar })}</td>
        ${seasons.map((s) => { const f = o.finishes[s.season]; const [bg, fg] = finishColor(f, n); const champ = s.champion === o.ownerId;
          return `<td class="cell" style="background:${bg};color:${fg}" data-tip="${esc(`<b>${esc(o.name)} · ${esc(s.season)}</b>${f ? `Finished ${ordinal(f)}${champ ? ' 🏆 Champion' : ''}` : 'Did not play'}`)}">${f ? `${champ ? '🏆' : ordinal(f)}` : '—'}</td>`; }).join('')}
        <td class="num">${fmt(avgFinish(o))}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Darker = better finish. * season in progress (current regular-season rank).</p>`, { span: 12 })}
    ${card('Head-to-head', `<div class="scroll"><table class="heat">
      <thead><tr><th>Row team's record vs →</th>${owners.map((o) => `<th class="rot" title="${esc(o.name)}">${teamAv({ name: o.name, avatar: o.avatar }, 'sm')}</th>`).join('')}</tr></thead>
      <tbody>${owners.map((a) => `<tr class="${a.ownerId === session.userId ? 'me' : ''}"><td>${teamTag({ name: a.name, avatar: a.avatar })}</td>${owners.map((b) => {
        if (a.ownerId === b.ownerId) return '<td class="cell" style="background:var(--surface-2)"></td>';
        const c = h.h2h[a.ownerId]?.[b.ownerId];
        const g = c ? c.w + c.l + c.t : 0;
        const p = g ? (c.w + c.t / 2) / g : null;
        const [bg, fg] = divColor(p);
        return `<td class="cell" style="background:${bg};color:${fg};cursor:pointer" onclick="location.hash='#/rivalry?a=${encodeURIComponent(a.ownerId)}&b=${encodeURIComponent(b.ownerId)}'" data-tip="${esc(`<b>${esc(a.name)} vs ${esc(b.name)}</b>${g ? `${c.w}-${c.l}${c.t ? `-${c.t}` : ''} all-time` : 'Never played'}<br>Click for the rivalry page`)}">${g ? `${c.w}-${c.l}` : ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="small muted">Blue = row team has the edge, red = column team does, gray = even.</p>`, { span: 12 })}
    ${card('League records', `<div class="kpis">
      ${R.high ? `<div class="record"><span class="eyebrow">Highest score</span><b>${fmt(R.high.pts, 2)}</b>${esc(name(R.high.ownerId))}<div class="small muted">${esc(R.high.season)} · Week ${R.high.week}</div></div>` : ''}
      ${R.low ? `<div class="record"><span class="eyebrow">Lowest score</span><b>${fmt(R.low.pts, 2)}</b>${esc(name(R.low.ownerId))}<div class="small muted">${esc(R.low.season)} · Week ${R.low.week}</div></div>` : ''}
      ${R.blowout ? `<div class="record"><span class="eyebrow">Biggest blowout</span><b>${fmt(R.blowout.margin, 2)}</b>${esc(name(R.blowout.winner))} over ${esc(name(R.blowout.loser))}<div class="small muted">${fmt(R.blowout.wp, 2)}–${fmt(R.blowout.lp, 2)} · ${esc(R.blowout.season)} W${R.blowout.week}</div></div>` : ''}
      ${R.closest ? `<div class="record"><span class="eyebrow">Closest game</span><b>${fmt(R.closest.margin, 2)}</b>${R.closest.margin === 0 ? 'Tie: ' : ''}${esc(name(R.closest.winner))} vs ${esc(name(R.closest.loser))}<div class="small muted">${fmt(R.closest.wp, 2)}–${fmt(R.closest.lp, 2)} · ${esc(R.closest.season)} W${R.closest.week}</div></div>` : ''}
    </div>`, { span: 12 })}
  </div>`;
  sortableTable(document.getElementById('at'));
  const byWin = [...owners].sort((a, b) => b.winPct - a.winPct);
  hbars(document.getElementById('c-winpct'), { rows: byWin.map((o) => ({ label: o.name, value: Math.round(o.winPct * 1000) / 10, highlight: o.ownerId === session.userId, o })), max: 100, fmt: (v) => `${fmt(v)}%`,
    tipFn: (r) => `<b>${esc(r.o.name)}</b>${r.o.wins}-${r.o.losses} · ${r.o.seasons} seasons` });
  const byLuck = [...owners].sort((a, b) => b.luck - a.luck);
  columnsLuck(document.getElementById('c-luck'), byLuck);
}
function avgFinish(o) { const v = Object.values(o.finishes).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 99; }

// Diverging bars around zero for luck.
function columnsLuck(el, owners) {
  const max = Math.max(1, ...owners.map((o) => Math.abs(o.luck)));
  el.innerHTML = owners.map((o) => {
    const w = (Math.abs(o.luck) / max) * 50;
    const pos = o.luck >= 0;
    return `<div class="bullet" style="grid-template-columns:140px 1fr 52px" data-tip="${esc(`<b>${esc(o.name)}</b>${sign(o.luck)} wins vs. all-play expectation`)}">
      <span class="small ${o.ownerId === session.userId ? '' : 'muted'}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.ownerId === session.userId ? '<b>' : ''}${esc(o.name)}${o.ownerId === session.userId ? '</b>' : ''}</span>
      <div class="track" style="background:transparent"><div class="mark" style="left:50%;background:var(--muted);width:1px"></div>
        <div style="position:absolute;top:0;bottom:0;${pos ? `left:50%;border-radius:0 4px 4px 0;background:var(--div-pos-2)` : `right:50%;border-radius:4px 0 0 4px;background:var(--div-neg-2)`};width:${w}%"></div></div>
      <span class="num small ${trendCls(o.luck)}" style="text-align:right">${sign(o.luck)}</span></div>`;
  }).join('');
}

// ---------- my team ----------
async function viewTeam($) {
  const [t, power] = await Promise.all([api(L(`/team/${session.userId}`)), api(L('/power')).catch(() => null)]);
  const dyn = power?.dynasty.teams.find((x) => x.ownerId === session.userId);
  const needRows = Object.entries(t.needs).filter(([p]) => !['K', 'DEF'].includes(p));
  $.innerHTML = `${head(esc(t.team.name), `${t.team.wins}-${t.team.losses} · Your optimal lineup projects <b>${fmt(t.optimal.total)}</b> pts/wk on rest-of-season form.`)}
  <div class="grid">
    ${t.thisWeek ? card(`This week: Week ${t.thisWeek.week} start/sit`, `<div class="kpis" style="margin-bottom:12px">
        <div class="kpi"><b>${fmt(t.thisWeek.currentPts)}</b><span>Your Sleeper lineup (projected)</span></div>
        <div class="kpi"><b>${fmt(t.thisWeek.bestPts)}</b><span>Best possible lineup</span></div>
        <div class="kpi"><b class="${t.thisWeek.bestPts - t.thisWeek.currentPts > 0.5 ? 'up' : ''}">${sign(t.thisWeek.bestPts - t.thisWeek.currentPts)}</b><span>Points you'd add</span></div></div>
      ${t.thisWeek.swaps.length ? `<h3>Suggested swaps</h3>${t.thisWeek.swaps.map((x) => `<div class="li row"><span class="chip good">Start</span>${ptag(x.start)}<span class="muted small">${fmt(x.start.proj)}</span>
        ${x.sit ? `<span class="chip">Sit</span>${ptag(x.sit)}<span class="muted small">${fmt(x.sit.proj)}</span>` : ''}<b class="up" style="margin-left:auto">+${fmt(x.gain)}</b></div>`).join('')}` : '<p class="small"><span class="chip good">✓</span> Your Sleeper lineup is already the best by this week\'s projections.</p>'}
      ${t.thisWeek.warnings.length ? `<h3>Check these starters</h3>${t.thisWeek.warnings.map((w) => `<div class="li row">${ptag(w.player)}<span class="chip warn">⚠ ${esc(w.issue)}</span></div>`).join('')}` : ''}
      <details><summary>Best lineup by this week's projections</summary><div class="scroll"><table><tbody>${t.thisWeek.lineup.map((s2) => `<tr><td>${posTag(s2.slot.replace('SUPER_FLEX', 'SF').replace('REC_FLEX', 'FLEX').replace('WRRB_FLEX', 'FLEX'))}</td><td>${s2.player ? ptag(s2.player) : '<span class="muted">empty</span>'}</td><td class="num"><b>${fmt(s2.player?.proj)}</b></td><td>${s2.player && !s2.starting ? '<span class="chip warn">not in your lineup</span>' : ''}</td></tr>`).join('')}</tbody></table></div></details>
      <p class="small muted">Projections from Sleeper, scored with your league's settings. Players ruled Out or on IR count as 0; taxi and IR slots are excluded.</p>`, { span: 12 }) : ''}
    ${card('Optimal lineup (rest of season)', `<div class="scroll"><table>
      <thead><tr><th>Slot</th><th>Player</th><th class="num">RoS</th><th class="num">Proj</th><th class="num">L3</th><th></th></tr></thead>
      <tbody>${t.optimal.lineup.map((s) => `<tr><td>${posTag(s.slot.replace('SUPER_FLEX', 'SF').replace('REC_FLEX', 'FLEX').replace('WRRB_FLEX', 'FLEX'))}</td>
        <td>${s.player ? ptag(s.player) : '<span class="muted">empty</span>'}</td>
        <td class="num"><b>${fmt(s.player?.ros)}</b></td><td class="num">${fmt(s.player?.proj)}</td><td class="num ${trendCls((s.player?.last3 ?? 0) - (s.player?.ppg ?? 0))}">${fmt(s.player?.last3)}</td>
        <td>${s.player && !t.currentStarters.includes(s.player.id) ? '<span class="chip warn" title="Not in your current Sleeper starting lineup">⚠ Not starting</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`, { span: 7 })}
    ${card('Positional strength', `<div id="c-pos"></div><p class="small muted">Bar = your starters' pts/wk at the position; tick = league average.</p>`, { span: 5, note: 'starting lineup vs league' })}
    ${dyn ? card('Dynasty profile', `<div class="kpis"><div class="kpi"><b>#${dyn.ranks[0]}</b><span>Dynasty rank now</span></div><div class="kpi"><b>#${dyn.ranks[3]}</b><span>Projected in 3 yrs</span></div><div class="kpi"><b>${fmt(dyn.avgAge)}</b><span>Value-weighted age</span></div><div class="kpi"><b>${dyn.picks.filter((p) => p.round === 1).length}</b><span>1st-round picks</span></div></div>
      <h3>Value mix</h3><div id="c-mix"></div>${legend(Object.entries(POS_COLORS).map(([label, color]) => ({ label, color })))}
      <h3>Draft capital</h3><div class="small">${dyn.picks.map((p) => `<span class="chip" style="margin:2px">${p.season} R${p.round}${p.from ? ` · via ${esc(p.from)}` : ''}</span>`).join('')}</div>`, { span: 5 }) : ''}
    ${card('Bench', `<div class="scroll"><table>
      <thead><tr><th>Player</th><th class="num">Pos rank</th><th class="num">RoS</th><th class="num">Season</th><th class="num">L3</th><th class="num">Value</th></tr></thead>
      <tbody>${t.bench.map((p) => `<tr><td>${ptag(p)}</td><td class="num">${esc(p.posRank || '—')}</td><td class="num"><b>${fmt(p.ros)}</b></td><td class="num">${fmt(p.ppg)}</td><td class="num ${trendCls((p.last3 ?? 0) - (p.ppg ?? 0))}">${fmt(p.last3)}</td><td class="num">${k(p.value)}</td></tr>`).join('')}</tbody></table></div>`, { span: dyn ? 7 : 12 })}
  </div>`;
  const max = Math.max(...needRows.flatMap(([, n]) => [n.pts, n.leagueAvg]), 1);
  document.getElementById('c-pos').innerHTML = needRows.map(([pos, n]) => `<div class="bullet" data-tip="${esc(`<b>${pos}</b>You ${fmt(n.pts)} · League avg ${fmt(n.leagueAvg)}<br>Rank ${n.rank} of ${n.of}`)}">
    ${posTag(pos)}<div class="track"><div class="fill" style="width:${(n.pts / max) * 100}%;background:${POS_COLORS[pos]}"></div><div class="mark" style="left:${(n.leagueAvg / max) * 100}%"></div></div>
    <span class="small num"><span class="chip ${n.rank <= n.of / 3 ? 'good' : n.rank > (2 * n.of) / 3 ? 'bad' : ''}">${ordinal(n.rank)}</span></span></div>`).join('');
  if (dyn) stackedHbars(document.getElementById('c-mix'), { rows: [{ label: 'Your roster', parts: dyn.byPos }], keys: Object.keys(POS_COLORS), colors: POS_COLORS, fmt: k, labelW: 0, rowH: 34 });
}

// ---------- waivers ----------
async function viewWaivers($) {
  const w = await api(L(`/waivers?owner=${session.userId}`));
  const ups = w.recs.filter((r) => r.kind === 'upgrade'), stash = w.recs.filter((r) => r.kind !== 'upgrade');
  const table = (rows) => `<div class="scroll"><table>
    <thead><tr><th>Player</th><th class="num">Lineup gain</th><th class="num">RoS</th><th class="num">L3</th><th class="num">Adds 48h</th><th>Why</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${ptag(r)}</td><td class="num">${r.kind === 'upgrade' ? `<span class="chip good">+${fmt(r.gain)}</span>` : '<span class="chip warn">Stash</span>'}</td>
      <td class="num"><b>${fmt(r.ros)}</b></td><td class="num ${trendCls((r.last3 ?? 0) - (r.ppg ?? 0))}">${fmt(r.last3)}</td><td class="num">${r.adds ? r.adds.toLocaleString() : '—'}</td>
      <td class="wrap" style="min-width:280px"><ul class="reasons">${r.why.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></td></tr>`).join('')}</tbody></table></div>`;
  $.innerHTML = `${head('Waiver Wire', `Free agents ranked by how much they improve <i>your</i> best lineup, plus usage trends and Sleeper-wide add activity.${w.drop ? ` If you need a roster spot, ${esc(w.drop.name)} is your most expendable player (costs ${fmt(w.drop.loss)} pts/wk).` : ''}`)}
  <div class="grid">
    ${card('Lineup upgrades available', '<div id="c-gain"></div>', { span: 7, note: 'pts/wk added to your best lineup' })}
    ${card('Hottest adds on Sleeper', '<div id="c-trend"></div>', { span: 5, note: 'adds in last 48h · available in your league' })}
    ${card('Immediate upgrades', ups.length ? table(ups) : '<p class="muted">No free agent beats one of your starters right now.</p>', { span: 12 })}
    ${card('Stash candidates', stash.length ? table(stash) : '<p class="muted">None.</p>', { span: 12, note: 'rising usage, not yet better than your starters' })}
  </div>`;
  if (ups.length) hbars(document.getElementById('c-gain'), { rows: ups.slice(0, 10).map((r) => ({ label: `${r.pos} ${r.name}`, value: r.gain, highlight: true, r })), fmt: (v) => `+${fmt(v)}`, labelW: 170,
    tipFn: (x) => `<b>${esc(x.r.name)}</b>${x.r.why.map(esc).join('<br>')}` });
  else document.getElementById('c-gain').innerHTML = '<p class="muted">Your lineup is set: no free agent beats a starter.</p>';
  hbars(document.getElementById('c-trend'), { rows: w.trending.slice(0, 10).map((t) => ({ label: `${t.pos} ${t.name}`, value: t.adds, t })), labelW: 170,
    tipFn: (x) => `<b>${esc(x.t.name)}</b>${x.t.adds.toLocaleString()} adds · ${fmt(x.t.ros)} RoS ppg` });
}

// ---------- trade finder ----------
async function viewTrades($) {
  const [lg, sug] = await Promise.all([api(L()), api(L(`/trades/suggest?owner=${session.userId}`))]);
  const me = lg.teams.find((t) => t.ownerId === session.userId);
  const weakest = Object.entries(sug.needs).filter(([p]) => !['K', 'DEF'].includes(p)).sort((a, b) => b[1].rank - a[1].rank).slice(0, 2);
  const link = (s) => `#/analyzer?a=${me.rosterId}&b=${s.rosterId}&ga=${s.give.map((p) => p.id).join(',')}&gb=${s.get.map((p) => p.id).join(',')}`;
  $.innerHTML = `${head('Trade Finder', `Your weakest starting spots: ${weakest.map(([p, n]) => `${posTag(p)} <b>${ordinal(n.rank)}</b> of ${n.of}`).join(' · ')}. These deals improve <b>both</b> starting lineups at roughly even trade value. Open one in the <a href="#/analyzer">Trade Analyzer</a> to check it against KTC and the other value sites.`)}
  <div class="grid">
    ${card('Suggested win-win trades', sug.suggestions.length ? `<div class="scroll"><table><thead><tr><th>Partner</th><th>You give</th><th>You get</th><th class="num">Your lineup</th><th class="num">Their lineup</th><th></th></tr></thead><tbody>
      ${sug.suggestions.map((s) => `<tr><td>${esc(s.owner)}</td><td>${s.give.map(ptag).join('<br>')}</td><td>${s.get.map(ptag).join('<br>')}</td>
        <td class="num up"><b>+${fmt(s.myDelta)}</b></td><td class="num ${trendCls(s.theirDelta)}">${sign(s.theirDelta)}</td>
        <td><a class="chip" href="${link(s)}">Analyze →</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No win-win deals found right now.</p>', { span: 12, note: 'lineup change in pts/wk' })}
  </div>`;
}

// ---------- trade analyzer ----------
// "→ 1.01 Jeremiah Smith (85%)" for picks linked to likely prospects, with all outcomes on hover.
const linkedNote = (l) => {
  if (!l?.outcomes?.length) return '';
  const top = l.outcomes[0];
  const tip = `Likely outcomes:\n${l.outcomes.slice(0, 5).map((o) => `${o.label} ${o.prospect.name} (${o.prospect.pos}): ${o.prob}%`).join('\n')}\n\nProspect-linked ${l.linked.toLocaleString()}${l.market != null ? `, market ${l.market.toLocaleString()}` : ''} → league-adjusted ${l.value.toLocaleString()} (${Math.round(l.weight * 100)}% prospect-linked)`;
  return ` <span class="small muted" title="${esc(tip)}">→ ${esc(top.label)} ${esc(top.prospect.name)} (${top.prob}%)</span>`;
};
const shiftTxt = (adj, pos) => {
  const sh = adj?.shifts?.KTC?.[pos];
  if (!sh) return 'n/a';
  return `${adj.demandLeague[pos]} starters vs ${adj.demandStd[pos]} in a typical league (${sh.shift > 0 ? '−' : '+'}${Math.abs(sh.shift).toLocaleString()} KTC)`;
};
const SRC_LABEL = { KTC: 'KeepTradeCut', FC: 'FantasyCalc', DP: 'DynastyProcess', Model: 'Fantasy Hub model' };
const consensusVal = (values, sources) => {
  const v = sources.map((s) => values[s]).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};
async function viewAnalyzer($) {
  const hub = await api(L('/values'));
  const okSrc = hub.sources.filter((s) => s.ok && !s.layer).map((s) => s.short);
  const hasAdj = hub.sources.some((s) => s.layer && s.ok);
  const me = hub.teams.find((t) => t.ownerId === session.userId) || hub.teams[0];
  const q = routeQuery;
  const state = {
    a: Number(q.get('a')) || me.rosterId,
    b: Number(q.get('b')) || hub.teams.find((t) => t.rosterId !== (Number(q.get('a')) || me.rosterId)).rosterId,
    A: new Set((q.get('ga') || '').split(',').filter(Boolean)),
    B: new Set((q.get('gb') || '').split(',').filter(Boolean)),
    filter: { A: '', B: '' },
  };
  const team = (rid) => hub.teams.find((t) => t.rosterId === rid);
  const assetsOf = (t) => [...t.players.map((p) => ({ ...p, kind: 'player', key: p.id })), ...t.picks.map((pk) => ({ ...pk, kind: 'pick', id: pk.key, name: pk.slot ? pk.label : `${pk.label}${pk.orig !== pk.owner ? ` (${pk.origName})` : ''}`, pos: 'PICK' }))];

  $.innerHTML = `${head('Trade Analyzer', `Pick players and draft picks from any two teams to compare value across ${okSrc.length} sources. Dynasty sources (KTC, DynastyProcess) are used even in redraft leagues. Use FantasyCalc and the model for redraft context.`,
    `<div class="row">${hub.sources.map((s) => `<span class="chip ${s.ok ? 'good' : 'bad'}" title="${esc(s.ok ? `${s.name} · ${s.format || ''}` : `${s.name}: ${s.error || 'unavailable'}`)}">${s.ok ? '✓' : '✕'} ${esc(s.short)}</span>`).join('')}</div>`)}
  <div class="grid">
    <section class="card span-6" id="side-A"></section>
    <section class="card span-6" id="side-B"></section>
    <section class="card span-12" id="result"><p class="muted">Select assets on both sides to see the verdict.</p></section>
  </div>`;

  function renderSide(k) {
    const rid = k === 'A' ? state.a : state.b, other = k === 'A' ? state.b : state.a;
    const t = team(rid), sel = state[k];
    const list = assetsOf(t).filter((x) => !state.filter[k] || `${x.name} ${x.pos}`.toLowerCase().includes(state.filter[k].toLowerCase()));
    const chosen = assetsOf(t).filter((x) => sel.has(x.id));
    const total = chosen.reduce((s, x) => s + consensusVal(x.values, okSrc), 0);
    const el = document.getElementById(`side-${k}`);
    el.innerHTML = `<div class="card-head"><h2>${k === 'A' ? 'Side A sends' : 'Side B sends'}</h2><span class="muted">${chosen.length} asset${chosen.length === 1 ? '' : 's'} · ${k2(total)} avg value</span></div>
      <div class="row"><select data-team="${k}">${hub.teams.map((x) => `<option value="${x.rosterId}" ${x.rosterId === rid ? 'selected' : ''} ${x.rosterId === other ? 'disabled' : ''}>${esc(x.name)}${x.ownerId === session.userId ? ' (you)' : ''}</option>`).join('')}</select>
        <input data-filter="${k}" placeholder="Search players or picks…" value="${esc(state.filter[k])}" style="flex:1;min-width:140px"></div>
      <div class="row" style="margin:10px 0;min-height:28px">${chosen.map((x) => `<span class="chip" style="gap:6px">${x.kind === 'pick' ? '🎟' : posTag(x.pos)} ${esc(x.name)} <button class="link" data-rm="${k}" data-id="${esc(x.id)}" aria-label="Remove">✕</button></span>`).join('') || '<span class="muted small">Nothing selected</span>'}</div>
      <div style="max-height:360px;overflow:auto;border-top:1px solid var(--border)">${list.map((x) => `<label class="pick"><input type="checkbox" data-side="${k}" value="${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''}>
        ${x.kind === 'pick' ? `<span class="pos" data-p="PICK" style="--pc:var(--pick)">PICK</span> <span>${esc(x.name)}${linkedNote(x.linked)}</span>` : `${posTag(x.pos)} <span>${esc(x.name)}</span> <span class="muted small">${esc(x.team || '')}${x.age ? ` · ${x.age}` : ''}</span>`}
        <span class="small num" style="margin-left:auto;white-space:nowrap" title="${esc(okSrc.map((s) => `${SRC_LABEL[s]}: ${x.values[s] == null ? '—' : Math.round(x.values[s]).toLocaleString()}`).join('\n'))}"><b>${k2(consensusVal(x.values, okSrc))}</b> <span class="muted">avg</span></span></label>`).join('')}</div>
      <p class="small muted" style="margin:8px 0 0">Value shown is the average across sources; hover for each site's number.</p>`;
    el.querySelector('select').onchange = (e) => { if (k === 'A') state.a = Number(e.target.value); else state.b = Number(e.target.value); state[k].clear(); renderAll(); };
    el.querySelector('[data-filter]').oninput = (e) => { state.filter[k] = e.target.value; renderSide(k); const i = el.querySelector('[data-filter]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    el.querySelectorAll('input[type=checkbox]').forEach((c) => c.onchange = () => { c.checked ? sel.add(c.value) : sel.delete(c.value); renderSide(k); evaluate(); });
    el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = (e) => { e.preventDefault(); sel.delete(b.dataset.id); renderSide(k); evaluate(); });
  }
  const k2 = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v));

  let seq = 0;
  async function evaluate() {
    const my = ++seq;
    const ids = (k, rid) => { const t = team(rid); const keys = new Set(t.picks.map((p) => p.key)); const all = [...state[k]]; return { rosterId: rid, players: all.filter((x) => !keys.has(x)), picks: all.filter((x) => keys.has(x)) }; };
    history.replaceState(null, '', `#/analyzer?a=${state.a}&b=${state.b}&ga=${[...state.A].join(',')}&gb=${[...state.B].join(',')}`);
    const out = document.getElementById('result');
    if (!state.A.size || !state.B.size) { out.innerHTML = '<p class="muted">Select assets on both sides to see the verdict.</p>'; return; }
    const r = await api(L('/analyze'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: ids('A', state.a), b: ids('B', state.b) }) });
    if (my !== seq) return;
    const nA = team(state.a).name, nB = team(state.b).name;
    const verdict = r.verdict.replace('side A', nA).replace('side B', nB);
    const edgeBar = (e) => {
      const w = Math.min(50, Math.abs(e) / 2);
      return `<div class="track" style="position:relative;height:12px;background:var(--surface-2);border-radius:4px;min-width:140px"><div style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:var(--muted)"></div>
        <div style="position:absolute;top:0;bottom:0;${e >= 0 ? `left:50%;border-radius:0 4px 4px 0` : `right:50%;border-radius:4px 0 0 4px`};width:${w}%;background:${e >= 0 ? 'var(--div-pos-2)' : 'var(--div-neg-2)'}"></div></div>`;
    };
    const who = (e) => (Math.abs(e) <= 5 ? 'even' : `${e > 0 ? esc(nA) : esc(nB)} +${Math.abs(e)}%`);
    out.innerHTML = `<div class="card-head"><h2>Verdict</h2><span class="muted">${r.sourcesAgree ? '✓ sources agree' : '⚠ sources disagree'}</span></div>
      <div class="verdict" style="margin-top:0">${esc(verdict)}</div>
      <div class="row" style="margin:-4px 0 12px;gap:8px"><span class="small muted">Make the pitch deck:</span>${[[state.a, nA], [state.b, nB]].map(([rid, nm]) => `<a class="chip" href="#/deck/proposal?a=${state.a}&b=${state.b}&ga=${encodeURIComponent([...state.A].join(','))}&gb=${encodeURIComponent([...state.B].join(','))}&owner=${encodeURIComponent(team(rid).ownerId)}">📊 ${esc(nm)}'s pitch</a>`).join('')}</div>
      <div class="row small muted" style="justify-content:space-between;max-width:620px"><span>◀ better for ${esc(nB)}</span><span>better for ${esc(nA)} ▶</span></div>
      <div style="max-width:620px">${edgeBar(r.consensus)}</div>
      <p class="small muted">Consensus value edge: <b>${who(r.consensus)}</b>${r.bestAsset ? ` · Best single asset: <b>${esc(r.bestAsset.label)}</b> (${esc(r.bestAsset.side === 'A' ? nB : nA)} receives it)` : ''}</p>
      ${r.adjusted ? `<div class="card" style="background:var(--surface-2);box-shadow:none;margin:14px 0 4px;max-width:720px">
        <div class="row" style="justify-content:space-between"><b>League-adjusted view</b><span class="small muted">extra layer, not part of the verdict above</span></div>
        <div class="row" style="margin-top:6px"><b>${esc(r.adjusted.verdict.replace('side A', nA).replace('side B', nB))}</b><span class="small ${Math.abs(r.adjusted.edgeA) <= 5 ? '' : r.adjusted.edgeA > 0 ? 'up' : 'down'}">${who(r.adjusted.edgeA)}</span></div>
        <div style="margin-top:6px">${edgeBar(r.adjusted.edgeA)}</div>
        <p class="small muted" style="margin:6px 0 0">Market values re-priced for this league's lineup and ${hub.adjust?.teams ?? ''}-team depth: QB ${shiftTxt(hub.adjust, 'QB')}, TE ${shiftTxt(hub.adjust, 'TE')}.${r.adjusted.consolidation ? ` ${esc(r.adjusted.consolidation)}` : ''}${r.assets.some((x) => x.linked) ? ` ${hub.pickLinks?.season ?? ''} picks are valued by the prospects they're likely to become (${Math.round((hub.pickLinks?.weight ?? 0.5) * 100)}% prospect-linked, the rest market).` : ''} <a href="#/power?values=adj">How it works →</a></p></div>` : ''}
      <h3>By source</h3><div class="scroll"><table><thead><tr><th>Source</th><th class="hide-sm">Format</th><th class="num">${esc(nA)} sends</th><th class="num">${esc(nB)} sends</th><th>Edge</th><th></th></tr></thead><tbody>
        ${r.perSource.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="muted small hide-sm">${esc(p.format || '')}</td><td class="num">${p.sendA.toLocaleString()}</td><td class="num">${p.sendB.toLocaleString()}</td>
          <td>${edgeBar(p.edgeA)}</td><td class="small ${Math.abs(p.edgeA) <= 5 ? '' : p.edgeA > 0 ? 'up' : 'down'}">${who(p.edgeA)}${p.missing.length ? ` <span class="muted" title="${esc(p.missing.join(', '))}">· ${p.missing.length} unvalued</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${r.lineup ? `<h3>Weekly lineup impact (rest of season)</h3><div class="kpis">
        <div class="kpi"><b class="${trendCls(r.lineup.you.delta)}">${sign(r.lineup.you.delta)}</b><span>${esc(nA)} pts/wk</span></div>
        <div class="kpi"><b class="${trendCls(r.lineup.them.delta)}">${sign(r.lineup.them.delta)}</b><span>${esc(nB)} pts/wk</span></div></div>` : ''}
      <h3>Assets in this deal</h3><div class="scroll"><table><thead><tr><th>Asset</th><th>Goes to</th>${okSrc.map((s) => `<th class="num">${s}</th>`).join('')}${hasAdj ? '<th class="num" title="League-adjusted layer">League-adj</th>' : ''}</tr></thead><tbody>
        ${r.assets.map((x) => `<tr><td>${x.kind === 'pick' ? '🎟 ' : `${posTag(x.pos)} `}${x.kind === 'player' ? `<a href="#/player/${esc(x.id)}">${esc(x.label)}</a>` : `${esc(x.label)}${linkedNote(x.linked)}`}</td><td>${esc(x.side === 'A' ? nB : nA)}</td>
          ${okSrc.map((s) => `<td class="num">${x.values[s] == null ? '—' : x.values[s].toLocaleString()}</td>`).join('')}${hasAdj ? `<td class="num muted">${x.values.Adj == null ? '—' : x.values.Adj.toLocaleString()}</td>` : ''}</tr>`).join('')}</tbody></table></div>
      <p class="small muted">Each source uses its own scale, so compare edges, not raw numbers. DynastyProcess prices picks much lower than KTC, so pick-heavy deals often split the sources. Picks are valued at their projected slot (current standings) for next year's draft and at "mid" for later years.</p>`;
  }
  function renderAll() { renderSide('A'); renderSide('B'); evaluate(); }
  renderAll();
}

// ---------- rookies ----------
const POS4 = { QB: 'var(--qb)', RB: 'var(--rb)', WR: 'var(--wr)', TE: 'var(--te)' };
const height = (h) => (h ? `${Math.floor(h / 12)}'${h % 12}"` : '—');
const tierChip = (t) => `<span class="chip ${t === 'Tier 1' || t === 'Tier 2' ? 'good' : t === 'Depth' ? '' : 'warn'}">${esc(t)}</span>`;

async function viewRookies($) {
  const tab = routeQuery.get('view') === 'mock' ? 'mock' : 'board';
  const mode = routeQuery.get('mode') === 'bpa' ? 'bpa' : 'need';
  const posF = routeQuery.get('pos') || '';
  const d = await api(L('/rookies'));
  const go = (o) => { const p = new URLSearchParams({ view: tab, mode, pos: posF, values: routeQuery.get('values') || '', ...o }); location.hash = `#/rookies?${p}`; };
  const srcChips = `<div class="row">${d.sources.map((x) => `<span class="chip ${x.ok ? 'good' : ''}" title="${esc(x.ok ? x.name : `${x.name}: ${x.error || 'not available'}`)}">${x.ok ? '✓' : '–'} ${esc(x.short)}</span>`).join('')}</div>`;
  $.innerHTML = `${head(`${d.season} Rookie Class`, `${d.board.length} prospects ranked by consensus of ${d.sources.filter((x) => x.ok).map((x) => x.short).join(' + ') || 'no sources'} (${d.format.superflex ? 'Superflex' : '1QB'} values). Click a name for a scouting profile.`, srcChips)}
    <div class="row" style="margin-bottom:16px;justify-content:space-between">
      <div class="seg"><button data-tab="board" class="${tab === 'board' ? 'on' : ''}">Big board</button><button data-tab="mock" class="${tab === 'mock' ? 'on' : ''}">Mock draft</button></div>
      ${tab === 'mock' ? `<div class="seg"><button data-mode="need" class="${mode === 'need' ? 'on' : ''}">By team need</button><button data-mode="bpa" class="${mode === 'bpa' ? 'on' : ''}">Straight rankings (BPA)</button></div>`
        : `<div class="seg">${['', 'QB', 'RB', 'WR', 'TE'].map((p) => `<button data-pos="${p}" class="${p === posF ? 'on' : ''}">${p || 'All'}</button>`).join('')}</div>`}
    </div><div id="rk"></div>`;
  $.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => go({ view: b.dataset.tab }));
  $.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => go({ mode: b.dataset.mode }));
  $.querySelectorAll('[data-pos]').forEach((b) => b.onclick = () => go({ pos: b.dataset.pos }));
  const rk = document.getElementById('rk');
  if (!d.board.length) {
    rk.innerHTML = card('No rookie rankings available', `<p>None of the rookie sources could be reached. KTC: ${esc(d.sources[0].error || '—')}; DynastyProcess: ${esc(d.sources[1].error || 'no ' + d.season + ' class listed yet')}.</p><p class="muted">You can add prospects yourself in <code>data/rookies.json</code> (see <code>data/rookies.example.json</code>).</p>`);
    return;
  }
  return tab === 'mock' ? renderMock(rk, d, mode) : renderBoard(rk, d, posF);
}

function renderBoard(el, d, posF) {
  const adjMode = routeQuery.get('values') === 'adj' && d.board.some((r) => r.adjRank);
  const base = adjMode ? [...d.board].filter((r) => r.adjRank).sort((a, b) => a.adjRank - b.adjRank) : d.board;
  const rows = base.filter((r) => !posF || r.pos === posF);
  const tiers = [...new Set(d.board.map((r) => r.tier))].filter((t) => t !== 'Depth');
  const range = (t) => { const rs = d.board.filter((r) => r.tier === t).map((r) => r.rank); return rs.length ? `#${rs[0]}${rs.length > 1 ? `–${rs.at(-1)}` : ''}` : ''; };
  const breaks = d.board.slice(0, 36).map((r, i) => (i > 0 && r.tier !== d.board[i - 1].tier && r.tier !== 'Depth' ? i : null)).filter((x) => x != null);
  el.innerHTML = `<div class="grid">
    ${card('Value curve', `${legend(Object.entries(POS4).map(([label, color]) => ({ label, color })))}<div id="c-curve"></div>`, { span: 8, note: 'consensus score by rank (top 36) · dashed lines mark value cliffs (tier breaks)' })}
    ${card('Position mix by tier', `<div id="c-tiers"></div>${legend(Object.entries(POS4).map(([label, color]) => ({ label, color })))}<p class="small muted">Draftable range only: your rookie draft has ${d.draftable} picks. Tiers break where value drops off sharply.</p>`, { span: 4 })}
    ${d.board.some((r) => r.adjRank) ? `<section class="span-12 row" style="justify-content:space-between"><div class="seg" id="rk-vals"><button data-v="" class="${adjMode ? '' : 'on'}">Market ranking</button><button data-v="adj" class="${adjMode ? 'on' : ''}">League-adjusted</button></div>
      <span class="small muted">${adjMode ? 'Re-ranked for this league: values shifted by replacement level at each position (fewer QBs start here, more TEs). "Market #" shows the original rank.' : 'Switch to League-adjusted to re-rank for this league\'s lineup and size.'}</span></section>` : ''}
    ${card(posF ? `${posF} rankings` : adjMode ? 'Big board: league-adjusted' : 'Big board', `<div class="scroll"><table id="bb">
      <thead><tr><th class="num" data-sort>#</th>${adjMode ? '<th class="num" data-sort>Market #</th>' : ''}<th data-sort>Prospect</th><th data-sort>College</th><th class="num" data-sort>Age</th><th class="num">Size</th><th data-sort>Tier</th><th class="num" data-sort>KTC</th><th class="num" data-sort title="FantasyPros overall rank among all players">FP ECR</th><th class="num" data-sort>Score</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="rank num" data-v="${adjMode ? r.adjRank : r.rank}">${adjMode ? r.adjRank : r.rank}</td>${adjMode ? `<td class="num small" data-v="${r.rank}">#${r.rank} ${r.rank > r.adjRank ? `<span class="up">▲${r.rank - r.adjRank}</span>` : r.rank < r.adjRank ? `<span class="down">▼${r.adjRank - r.rank}</span>` : ''}</td>` : ''}
        <td><a href="#/rookie/${esc(r.slug)}"><b>${esc(r.name)}</b></a><br><small>${posTag(r.pos)} <span class="muted">${r.pos}${r.posRank}</span></small></td>
        <td>${esc(r.college || '—')}</td><td class="num">${fmt(r.age)}</td><td class="num small">${height(r.height)}${r.weight ? ` · ${r.weight}` : ''}</td><td>${tierChip(r.tier)}</td>
        <td class="num" data-v="${r.sources.KTC?.value ?? -1}">${r.sources.KTC ? `${r.sources.KTC.value.toLocaleString()} <span class="muted small">#${r.sources.KTC.rank}</span>` : '—'}</td>
        <td class="num" data-v="${r.sources.DP?.ecr ?? 9999}">${r.sources.DP?.ecr ? Math.round(r.sources.DP.ecr) : '—'}</td>
        <td class="num" data-v="${adjMode ? r.adjScore : r.score}"><span style="display:inline-block;width:60px;height:8px;border-radius:4px;background:var(--surface-2);vertical-align:middle;margin-right:6px;overflow:hidden"><span style="display:block;height:100%;width:${adjMode ? r.adjScore : r.score}%;background:${POS4[r.pos]}"></span></span>${fmt(adjMode ? r.adjScore : r.score, 0)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Score = each source's value scaled to its #1 rookie (=100), averaged. FP ECR = FantasyPros overall rank via DynastyProcess.</p>`, { span: 12 })}
  </div>`;
  sortableTable(document.getElementById('bb'));
  el.querySelectorAll('#rk-vals button').forEach((b) => b.addEventListener('click', () => {
    const q2 = new URLSearchParams(routeQuery); if (b.dataset.v) q2.set('values', 'adj'); else q2.delete('values'); location.hash = `#/rookies?${q2}`;
  }));
  const top = d.board.slice(0, 36);
  columns(document.getElementById('c-curve'), { data: top.map((r) => ({ x: r.rank, y: r.score, color: POS4[r.pos], r })), height: 220, yFmt: (v) => fmt(v, 0), breaks,
    tipFn: (x) => `<b>#${x.r.rank} ${esc(x.r.name)}</b>${x.r.pos}${x.r.posRank} · ${esc(x.r.college || '')} · ${esc(x.r.tier)}<br>Score ${fmt(x.r.score, 0)}` });
  stackedHbars(document.getElementById('c-tiers'), {
    rows: tiers.map((t) => ({ label: `${t} ${range(t)}`, parts: Object.fromEntries(Object.keys(POS4).map((p) => [p, d.board.filter((r) => r.tier === t && r.pos === p).length])) })).filter((r) => Object.values(r.parts).some(Boolean)),
    keys: Object.keys(POS4), colors: POS4, fmt: (v) => Math.round(v), labelW: 96, rowH: 30,
  });
}

async function renderMock(el, d, mode) {
  el.innerHTML = '<div class="skeleton"></div>';
  const [m, lg] = await Promise.all([api(L(`/rookies/mock?mode=${mode}`)), api(L())]);
  const teams = Object.fromEntries(lg.teams.map((t) => [t.rosterId, t]));
  const me = lg.teams.find((t) => t.ownerId === session.userId);
  const mine = m.picks.filter((p) => p.owner === me?.rosterId);
  const rounds = [...new Set(m.picks.map((p) => p.round))];
  const deltaChip = (p) => (p.delta == null ? '' : p.delta >= 3 ? `<span class="chip good" title="Consensus #${p.player.rank}, went ${p.overall}">▲ value +${p.delta}</span>` : p.delta <= -3 ? `<span class="chip warn" title="Consensus #${p.player.rank}, went ${p.overall}">▼ reach ${p.delta}</span>` : '');
  const pickCard = (p) => `<div class="card" style="padding:12px;${p.owner === me?.rosterId ? 'box-shadow:inset 0 0 0 2px var(--accent)' : ''}">
    <div class="row" style="justify-content:space-between"><b class="num" style="font:700 20px/1 var(--font-display)">${esc(p.label.split(' ')[1])}</b>${deltaChip(p)}</div>
    <div style="margin:8px 0">${teamTag(teams[p.owner] || { name: p.ownerName }, p.via ? `via ${esc(p.via)}` : '')}</div>
    ${p.player ? `<div><a href="#/rookie/${esc(p.player.slug)}"><b>${esc(p.player.name)}</b></a></div><div class="small">${posTag(p.player.pos)} <span class="muted">${esc(p.player.college || '')} · #${p.player.rank}</span></div>
      ${mode === 'need' && p.why ? `<div class="small muted" style="margin-top:6px">${esc(p.why)}</div>` : ''}` : '<span class="muted">No prospect left on the board</span>'}</div>`;
  el.innerHTML = `<p class="muted small" style="margin-top:-6px">${esc(m.order)} ${mode === 'need' ? 'Each team picks from the top 8 available, weighted toward positions where its roster is projected to be weak next season.' : 'Every team takes the highest-ranked prospect available.'}</p>
    ${mine.length ? card('Your picks', `<div class="kpis">${mine.map((p) => `<div class="kpi"><span class="eyebrow">${esc(p.label)}${p.via ? ` · via ${esc(p.via)}` : ''}</span><b style="font-size:20px">${p.player ? `<a href="#/rookie/${esc(p.player.slug)}">${esc(p.player.name)}</a>` : '—'}</b><span>${p.player ? `${posTag(p.player.pos)} #${p.player.rank} · ${esc(p.player.college || '')}` : ''}</span></div>`).join('')}</div>`, { span: 12 }) : ''}
    ${rounds.map((r) => `<h3 style="margin-top:22px">Round ${r}</h3><div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">${m.picks.filter((p) => p.round === r).map(pickCard).join('')}</div>`).join('')}
    ${mode === 'need' ? `<h3 style="margin-top:26px">Biggest roster needs (projected next season)</h3><div class="card"><div class="scroll"><table><thead><tr><th>Team</th><th>Top needs</th></tr></thead><tbody>
      ${lg.teams.map((t) => `<tr class="${t.ownerId === session.userId ? 'me' : ''}"><td>${teamTag(t)}</td><td>${(m.needs[t.rosterId] || []).map((n) => `${posTag(n.pos)} <span class="muted small">×${n.need.toFixed(2)}</span>`).join(' &nbsp; ')}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Need = league-average projected value at the position ÷ this team's (higher = weaker room). QB need is damped in 1QB leagues.</p></div>` : ''}`;
}

async function viewRookie($, slug) {
  const d = await api(L(`/rookie/${slug}`));
  const r = d.rookie, c = d.college;
  const notes = (title, list, cls) => (list.length ? `<h3>${title}</h3><ul class="reasons">${list.map((x) => `<li class="${cls}">${esc(x)}</li>`).join('')}</ul>` : '');
  const mockLine = (m, label) => (m ? `<div class="li"><span class="eyebrow">${label}</span><div><b>${esc(m.label)}</b> to ${esc(m.ownerName)}${m.via ? ` (via ${esc(m.via)})` : ''}</div></div>` : `<div class="li"><span class="eyebrow">${label}</span><div class="muted">Not selected</div></div>`);
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${r.name} ${r.college || ''} highlights`)}`;
  const statRow = (s) => r.pos === 'QB'
    ? `<td>${s.year}</td><td class="num">${s.passYds.toLocaleString()}</td><td class="num">${s.passTd}</td><td class="num">${s.int}</td><td class="num">${fmt(s.ypa)}</td><td class="num">${s.rushYds}</td><td class="num">${s.rushTd}</td>`
    : r.pos === 'RB' ? `<td>${s.year}</td><td class="num">${s.car}</td><td class="num">${s.rushYds.toLocaleString()}</td><td class="num">${fmt(s.ypc)}</td><td class="num">${s.rushTd}</td><td class="num">${s.rec}</td><td class="num">${s.recYds}</td><td class="num">${pct(s.dominator)}</td>`
    : `<td>${s.year}</td><td class="num">${s.rec}</td><td class="num">${s.recYds.toLocaleString()}</td><td class="num">${fmt(s.ypr)}</td><td class="num">${s.recTd}</td><td class="num">${pct(s.dominator)}</td>`;
  const statHead = r.pos === 'QB' ? '<th>Year</th><th class="num">Pass yds</th><th class="num">TD</th><th class="num">INT</th><th class="num">Y/A</th><th class="num">Rush yds</th><th class="num">Rush TD</th>'
    : r.pos === 'RB' ? '<th>Year</th><th class="num">Car</th><th class="num">Rush yds</th><th class="num">YPC</th><th class="num">TD</th><th class="num">Rec</th><th class="num">Rec yds</th><th class="num">Dominator</th>'
    : '<th>Year</th><th class="num">Rec</th><th class="num">Yds</th><th class="num">Y/R</th><th class="num">TD</th><th class="num">Dominator</th>';
  $.innerHTML = `<p class="small"><a href="#/rookies">← ${d.season} rookie class</a></p>
  <div class="grid">
    <section class="card hero span-12"><div class="hero-team"><span class="av lg">${esc(initials(r.name))}</span><div>
      <div class="eyebrow">${posTag(r.pos)} ${esc(r.college || '')}${r.age ? ` · Age ${r.age}` : ''}${r.height ? ` · ${height(r.height)}` : ''}${r.weight ? `, ${r.weight} lb` : ''}</div>
      <h1>${esc(r.name)}</h1><div class="muted">${d.season} rookie class · ${esc(r.tier)}${r.comps ? ` · Comp: ${esc(r.comps)}` : ''}</div></div></div>
      <div class="hero-stats">
        <div><b>#${r.rank}</b><span>Consensus rank</span></div><div><b>${r.pos}${r.posRank}</b><span>Position rank</span></div>
        <div><b>${r.sources.KTC ? r.sources.KTC.value.toLocaleString() : '—'}</b><span>KTC value${r.sources.KTC?.rank ? ` · #${r.sources.KTC.rank}` : ''}</span></div>
        <div><b>${r.sources.DP?.ecr ? Math.round(r.sources.DP.ecr) : '—'}</b><span>FantasyPros ECR</span></div>
        <div><b>${fmt(r.score, 0)}</b><span>Board score</span></div>
      </div></section>
    ${card('Scouting report', notes('Outlook', d.report.outlook, '') + notes('Strengths', d.report.strengths, 'up') + notes('Concerns', d.report.concerns, 'down') + (r.notes ? `<h3>League notes</h3><p>${esc(r.notes)}</p>` : ''), { span: 7 })}
    ${card('Mock draft landing spot', mockLine(d.mock.need, 'Team-need mock') + mockLine(d.mock.bpa, 'Best-available mock') + `<h3>Similar prospects</h3>${d.neighbors.map((n) => `<div class="li small"><a href="#/rookie/${esc(n.slug)}">${esc(n.name)}</a> <span class="muted">#${n.rank} · ${esc(n.college || '')}</span></div>`).join('') || '<p class="muted small">None nearby.</p>'}`, { span: 5 })}
    ${card('College production', c ? `${r.pos !== 'QB' ? '<div id="c-dom"></div>' : ''}<div class="scroll"><table><thead><tr>${statHead}</tr></thead><tbody>${c.seasons.map((s) => `<tr>${statRow(s)}</tr>`).join('')}</tbody></table></div>
      <p class="small muted">Source: ${esc(c.source)}. Dominator = average of the player's share of team ${r.pos === 'RB' ? 'scrimmage' : 'receiving'} yards and touchdowns; 30%+ is elite. The current season is partial.</p>`
      : '<p class="muted">College stats appear here when the server has a free <code>CFBD_API_KEY</code> from collegefootballdata.com.</p>', { span: 7 })}
    ${card('Film & links', `<div class="li"><a href="${yt}" target="_blank" rel="noopener">▶ ${esc(r.name)} highlights on YouTube</a></div>
      <div class="li"><a href="https://www.google.com/search?q=${encodeURIComponent(`${r.name} ${r.college || ''} scouting report`)}" target="_blank" rel="noopener">Scouting reports (web search)</a></div>
      ${r.sources.KTC ? `<div class="li"><a href="https://keeptradecut.com/devy-rankings" target="_blank" rel="noopener">KeepTradeCut devy rankings</a></div>` : ''}`, { span: 5 })}
  </div>`;
  if (c && r.pos !== 'QB' && document.getElementById('c-dom')) {
    columns(document.getElementById('c-dom'), { data: [...c.seasons].reverse().map((s) => ({ x: s.year, y: Math.round((s.dominator ?? 0) * 1000) / 10, s })), height: 160, color: POS4[r.pos], yFmt: (v) => `${v}%`,
      tipFn: (x) => `<b>${x.s.year}</b>Dominator ${pct(x.s.dominator)}` });
  }
}

// ---------- trade report cards ----------
const gradeCls = (g) => `grade g-${String(g)[0].toLowerCase()}`;
const when = (t) => (t.offseason ? 'Offseason' : `Week ${t.week}`) + ` · ${new Date(t.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
function assetLine(x) {
  const v = Object.values(x.values).filter((n) => n != null);
  const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  const tip = Object.entries(x.values).map(([k2, n]) => `${k2}: ${n == null ? '—' : Math.round(n).toLocaleString()}`).join('\n');
  return `<li>${x.kind === 'pick' ? '<span class="pos" style="--pc:var(--pick)">PICK</span>' : posTag(x.pos)}
    ${x.kind === 'player' ? `<a href="#/player/${esc(x.id)}">${esc(x.label)}</a>${x.age ? ` <span class="muted">${x.age}</span>` : ''}` : `${esc(x.label)}${linkedNote(x.linked)}`}
    <span class="muted num" style="margin-left:auto" title="${esc(tip)}">${x.used ? 'used' : avg == null ? '—' : k(avg)}</span></li>`;
}
function tradeCard(t) {
  return `<article class="tcard">
    <div class="row" style="justify-content:space-between"><div class="row"><b>${t.teamsCount > 2 ? `${t.teamsCount}-team trade` : 'Trade'}</b><span class="muted small">${esc(when(t))}</span></div>
      <span class="chip ${t.winner ? 'warn' : 'good'}">${esc(t.verdict)}</span></div>
    <div class="sides">${t.sides.map((s) => `<div class="tside ${t.winner === s.team ? "won" : ""}">
      <div class="row"><span class="who">${teamAv({ name: s.team, avatar: s.avatar }, 'sm')}<span class="t"><span><b>${esc(s.team)}</b></span><small>${s.contender ? 'Contender' : 'Building'} · ${ordinal(s.recordRank)} in standings</small></span></span>
        <span style="display:flex;flex-direction:column;align-items:center;gap:4px"><span class="${gradeCls(s.grade)}" title="Market grade · score ${s.score}">${esc(s.grade)}</span>
          ${s.adjusted ? `<span class="small muted" title="League-adjusted grade: replacement level for this league + consolidation discount (edge ${s.adjusted.edge > 0 ? '+' : ''}${s.adjusted.edge}%)">Adj <b>${esc(s.adjusted.grade)}</b></span>` : ''}</span></div>
      ${s.ownerId ? `<a class="small deck-link" href="#/deck/${esc(t.id)}?owner=${esc(s.ownerId)}">📊 ${esc(s.team)}'s pitch deck</a>` : ''}
      <div class="small muted" style="margin-top:8px">Receives</div>
      <ul class="gets">${s.received.map(assetLine).join('') || '<li class="muted">FAAB only</li>'}${s.faabIn ? `<li>💵 $${s.faabIn} FAAB</li>` : ''}</ul>
      <div class="small muted" style="margin-top:6px">Sends: ${s.sent.map((x) => esc(x.label)).join(', ') || '—'}${s.faabOut ? `${s.sent.length ? ', ' : ''}$${s.faabOut} FAAB` : ''}</div>
      <div class="stats">
        <span title="Consensus value received vs. sent">Value <b class="${trendCls(s.edge)}">${s.edge > 0 ? '+' : ''}${s.edge}%</b></span>
        <span title="Change in best rest-of-season lineup">Lineup <b class="${trendCls(s.lineupDelta ?? 0)}">${s.lineupDelta == null ? '—' : `${s.lineupDelta > 0 ? '+' : ''}${s.lineupDelta}/wk`}</b></span>
        ${s.ageGain ? `<span>Age <b>${s.ageGain > 0 ? '−' : '+'}${Math.abs(s.ageGain)} yrs</b></span>` : ''}
        ${!t.offseason ? `<span title="Fantasy points by acquired players since the trade">Since trade <b>${s.sincePts.acquired}</b> pts</span>` : ''}
      </div></div>`).join('')}</div>
    <ul class="reasons">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    <details><summary>Value by source</summary><div class="scroll"><table><thead><tr><th>Source</th>${t.sides.map((s) => `<th class="num">${esc(s.team)} edge</th>`).join('')}</tr></thead>
      <tbody>${t.sides[0].perSource.map((p, i) => `<tr><td>${esc(p.name)}${p.inGrade ? '' : ' <span class="muted small">(shown, not graded)</span>'}</td>${t.sides.map((s) => `<td class="num ${trendCls(s.perSource[i].edge)}">${s.perSource[i].usable ? `${s.perSource[i].edge > 0 ? '+' : ''}${s.perSource[i].edge}%` : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>
  </article>`;
}

async function viewGrades($) {
  const d = await api(L('/trade-grades'));
  const mineOnly = routeQuery.get('mine') === '1';
  const me = session.teamName;
  const list = d.trades.filter((t) => !mineOnly || t.sides.some((s) => s.team === me));
  const tally = {};
  const adjTally = {};
  for (const t of d.trades) for (const s of t.sides) { (tally[s.team] ||= []).push(s.score); (adjTally[s.team] ||= []).push(s.adjusted?.score ?? s.score); }
  const avgOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const gpa = Object.entries(tally).map(([team, xs]) => ({ team, n: xs.length, avg: avgOf(xs), adj: avgOf(adjTally[team]) })).sort((a, b) => b.avg - a.avg);
  $.innerHTML = `${head('Trade Grades', `Report cards for all ${d.trades.length} league trades this year, newest first. Each team's grade blends value (the median edge across ${d.sources.filter((s) => s.ok && s.short !== 'Model').map((s) => s.short).join(', ')}), the change in its best lineup now, and whether the deal fits a contender or a rebuild. "Adj" is a second grade from league-adjusted values (re-priced for this league's lineup and depth, extra pieces discounted). Grades use <b>today's</b> values (hindsight), so they update as players rise and fall; used draft picks count as the player they became.`,
    `<div class="seg"><button data-mine="0" class="${mineOnly ? '' : 'on'}">All trades</button><button data-mine="1" class="${mineOnly ? 'on' : ''}">My trades</button></div>`)}
  <div class="grid">
    <section class="span-8">${list.map(tradeCard).join('') || '<div class="card"><p class="muted">No trades yet.</p></div>'}</section>
    <aside class="span-4">${card('Trader report card', `<p class="small muted">Average trade grade per team this year.</p>${gpa.map((g) => `<div class="li row" style="justify-content:space-between"><span>${g.team === me ? '<b>' : ''}${esc(g.team)}${g.team === me ? '</b>' : ''} <span class="muted small">${g.n} trade${g.n === 1 ? '' : 's'}</span></span><span class="row" style="gap:6px"><span class="${gradeCls(gradeFromScore(g.avg))} sm" title="Market">${gradeFromScore(g.avg)}</span><span class="small muted" title="League-adjusted">Adj ${gradeFromScore(g.adj)}</span></span></div>`).join('')}`, { span: 12 })}</aside>
  </div>`;
  $.querySelectorAll('[data-mine]').forEach((b) => b.onclick = () => { location.hash = `#/grades${b.dataset.mine === '1' ? '?mine=1' : ''}`; });
}
function gradeFromScore(x) { return [[90, 'A+'], [82, 'A'], [76, 'A-'], [70, 'B+'], [64, 'B'], [58, 'B-'], [53, 'C+'], [48, 'C'], [43, 'C-'], [36, 'D'], [-1e9, 'F']].find(([m]) => x >= m)[1]; }

// ---------- gazette ----------
async function viewGazette($) {
  const want = routeQuery.get('week');
  $.innerHTML = '<div class="paper"><p class="muted">The presses are running…</p></div>';
  const d = await api(L(`/gazette${want ? `?week=${encodeURIComponent(want)}` : ''}`));
  if (!d.edition) {
    $.innerHTML = `<div class="paper"><div class="flag">The ${esc(session.leagueName)} Gazette</div><p class="tag">The first edition goes to print after Week 1 is final.</p></div>`;
    return;
  }
  const e = d.edition;
  const i = d.weeks.indexOf(e.week);
  const prev = d.weeks[i - 1], next = d.weeks[i + 1];
  const flag = d.masthead || `The ${e.league} Gazette`;
  const mine = (txt) => session.teamName && txt.includes(session.teamName);
  const story = (s) => `<article class="story">${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ''}<h3>${esc(s.headline)}</h3><p>${esc(s.body)}</p>${mine(s.headline + s.body) ? '<div class="small" style="margin-top:4px"><span class="chip warn">📣 That’s you</span></div>' : ''}</article>`;
  $.innerHTML = `<div class="paper">
    <div class="topline"><span>Vol. ${esc(e.season)} · No. ${e.week}</span><span>Week ${e.week} Edition</span><span>Price: $1 FAAB</span></div>
    <div class="flag">${esc(flag)}</div>
    <div class="tag">All the news that's fit to roast · <a href="#/awards">Special edition: the Awards issue →</a></div>
    <div class="weeknav">
      ${prev ? `<a class="chip" href="#/gazette?week=${prev}">← Week ${prev}</a>` : '<span></span>'}
      <select id="gz-week" aria-label="Edition">${d.weeks.map((w) => `<option value="${w}" ${w === e.week ? 'selected' : ''}>Week ${w}</option>`).join('')}</select>
      ${next ? `<a class="chip" href="#/gazette?week=${next}">Week ${next} →</a>` : '<span></span>'}
    </div>
    <hr class="rule">
    <section class="lead">
      <div><div class="kicker">${esc(e.lead.kicker)}</div><h2>${esc(e.lead.headline)}</h2><p>${esc(e.lead.body)}</p></div>
      <aside><div class="sb-title">Final scores, Week ${e.week}</div><div id="gz-sb"></div>
        ${e.median != null ? `<div class="small muted" style="font-family:var(--font)">Dashed line: league median (${fmt(e.median)})${e.medianGames ? ' · beat it for an extra win' : ''}</div>` : ''}</aside>
    </section>
    <section class="cols">${e.stories.map(story).join('')}</section>
    ${e.interview ? `<section class="desk"><div class="section-title">The Locker Room</div>
      <div class="item" style="grid-template-columns:minmax(0,1fr)"><div>
        <div class="kicker">Exclusive interview${e.interview.voiceLabel ? ` · ${esc(e.interview.voiceLabel)}` : ''}</div>
        <h3>${esc(e.interview.team)}${e.interview.nickname ? `, a.k.a. ${esc(e.interview.nickname)},` : ''} Takes Our Questions</h3>
        ${e.interview.qa.map((x) => `<p style="margin:10px 0 2px"><b>GAZETTE:</b> ${esc(x.q)}</p><p style="margin:0"><b>${esc(e.interview.team.toUpperCase())}:</b> ${esc(x.a)}</p>`).join('')}
        <p class="small muted" style="font-family:var(--font);margin-top:8px">Satire. Quotes are invented in the team's Gazette persona; no managers were harmed or actually interviewed.</p></div></div></section>` : ''}
    <section class="desk" id="gz-desk"></section>
    <section class="lower">
      <div><div class="section-title">Around the League</div><ul class="briefs">${e.briefs.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
      <div class="ahead"><div class="section-title">Looking Ahead</div>${e.lookahead.length ? e.lookahead.map((x) => `<h4>${esc(x.headline)}</h4><p>${esc(x.body)}</p>`).join('') : '<p>The regular season is over. Pray for your playoff matchup.</p>'}</div>
    </section>
    ${e.cast?.length ? `<section class="desk"><div class="section-title">Meet the Cast</div>
      <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));padding-top:6px">${e.cast.map((c) => `<div>
        <div class="kicker">${esc(c.archetype)}</div><h3 style="font-size:18px;margin-bottom:2px">${esc(c.team)}</h3>
        <div class="small" style="font-family:var(--font);margin-bottom:4px"><i>${esc(c.nickname)}</i> · ${esc(c.voiceLabel)}</div>
        <p style="font-size:14px">${esc(c.bio)}</p>
        <p class="small" style="font-family:var(--font);margin-top:4px">Catchphrase: “${esc(c.catchphrase)}”${c.rival ? `<br>Rival: ${esc(c.rival)}` : ''}${c.mascot ? `<br>Mascot: ${esc(c.mascot)}` : ''}</p></div>`).join('')}</div>
      <p class="small muted" style="font-family:var(--font)">Personas are generated from how each team plays; managers can write their own (data/personas.json).</p></section>` : ''}
    <div class="fine">Satire. Scores and stats are real; quotes, sources and experts are not. Any resemblance to competent management is coincidental.<br>
      ${e.generator === 'claude' ? `Written by Claude (${esc(e.model || 'AI')}) from this week's league data.` : "Written by the Gazette's in-house joke machine."}</div>
  </div>`;
  document.getElementById('gz-week').onchange = (ev) => { location.hash = `#/gazette?week=${ev.target.value}`; };
  const desk = document.getElementById('gz-desk');
  const deskItem = (headline, body, sides, extra = '') => `<div class="item"><div>${extra}<h3>${esc(headline)}</h3><p>${esc(body)}</p></div>
    <div class="grades">${sides.map((x) => `<div class="g"><span class="${gradeCls(x.grade)} sm">${esc(x.grade)}</span>${esc(x.team)}</div>`).join('')}</div></div>`;
  if (e.tradeDesk?.length) {
    desk.innerHTML = `<div class="section-title">The Trade Desk · Week ${e.week}</div>${e.tradeDesk.map((t) => deskItem(t.headline, t.body, t.card.sides)).join('')}
      <p class="small" style="font-family:var(--font)"><a href="#/grades">Full report cards →</a></p>`;
  } else {
    api(L('/trade-grades')).then((g) => {
      const t = g.trades[0];
      if (!t) { desk.remove(); return; }
      desk.innerHTML = `<div class="section-title">The Trade Desk</div>${deskItem(`No trades in Week ${e.week}. The most recent deal still gets graded:`, t.notes.slice(0, 3).join(' '), t.sides, `<div class="kicker">${esc(when(t))}${t.winner ? ` · ${esc(t.verdict)}` : ''}</div>`)}
        <p class="small" style="font-family:var(--font)"><a href="#/grades">All trade report cards →</a></p>`;
    }).catch(() => desk.remove());
  }
  const sb = document.getElementById('gz-sb');
  const max = Math.max(...e.scoreboard.map((x) => x.points), 1);
  sb.innerHTML = `<div style="position:relative">${e.scoreboard.map((x) => `<div class="bullet" style="grid-template-columns:118px 1fr 50px;font-family:var(--font)" data-tip="${esc(`<b>${esc(x.team)}</b>${fmt(x.points)} pts${e.median != null ? ` · ${x.aboveMedian ? 'above' : 'below'} median` : ''}`)}">
      <span class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.owner === session.userId ? '<b>' : ''}${esc(x.team)}${x.owner === session.userId ? '</b>' : ''}</span>
      <div class="track"><div class="fill" style="width:${(x.points / max) * 100}%;background:${x.owner === session.userId ? 'var(--series-me)' : 'var(--bar-muted)'}"></div>
        ${e.median != null ? `<div class="mark" style="left:${(e.median / max) * 100}%;background:none;border-left:2px dashed var(--ink);width:0"></div>` : ''}</div>
      <span class="small num" style="text-align:right">${fmt(x.points)}</span></div>`).join('')}</div>`;
}

// ---------- metrics ----------
async function viewMetrics($, pos = 'WR') {
  const d = await api(L(`/metrics?pos=${pos}`));
  const recv = ['WR', 'TE', 'RB'].includes(pos);
  $.innerHTML = `${head('Advanced Metrics', `Usage and efficiency over ${d.completedWeeks} completed weeks, scored with your league's settings. Click a column to sort.`,
    `<div class="seg">${['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => `<button class="${p === pos ? 'on' : ''}" data-pos="${p}">${p}</button>`).join('')}</div>`)}
  <div class="grid">
    ${recv ? card('Opportunity vs. production', '<div id="c-opp"></div>', { span: 12, note: `top 40 ${pos}s · ${pos === 'RB' ? 'touches' : 'target share'} vs PPG · your players highlighted` }) : ''}
    ${card(`${pos} leaderboard`, `<div class="scroll"><table id="mt">
      <thead><tr><th data-sort>Player</th><th data-sort>Owner</th><th class="num" data-sort>G</th><th class="num" data-sort>PPG</th><th class="num" data-sort>L3</th><th class="num" data-sort>RoS</th><th class="num" data-sort>Snap%</th><th class="num" data-sort>Snap% L3</th>
        ${recv ? '<th class="num" data-sort>Tgt%</th><th class="num" data-sort title="Share of team air yards on catches">Air%*</th><th class="num" data-sort title="Weighted opportunity rating">WOPR*</th><th class="num" data-sort>Y/Rec</th><th class="num" data-sort>Y/Tgt</th>' : ''}
        ${pos === 'RB' ? '<th class="num" data-sort>Touch/G</th><th class="num" data-sort>YPC</th>' : ''}
        <th class="num" data-sort>RZ opp</th><th class="num" data-sort>StDev</th></tr></thead>
      <tbody>${d.rows.map((r) => `<tr class="${r.owner === session.teamName ? 'me' : ''}"><td>${ptag(r)}</td><td>${r.owner ? esc(r.owner) : '<span class="chip good">FA</span>'}</td>
        <td class="num">${r.games}</td><td class="num">${fmt(r.ppg)}</td><td class="num ${trendCls(r.trend)}">${fmt(r.last3)}</td><td class="num"><b>${fmt(r.ros)}</b></td>
        <td class="num" data-v="${r.snapShare ?? -1}">${pct(r.snapShare)}</td><td class="num" data-v="${r.snapShareL3 ?? -1}">${pct(r.snapShareL3)}</td>
        ${recv ? `<td class="num" data-v="${r.tgtShare ?? -1}">${pct(r.tgtShare)}</td><td class="num" data-v="${r.airShare ?? -1}">${pct(r.airShare)}</td><td class="num">${fmt(r.wopr, 2)}</td><td class="num">${fmt(r.ypr)}</td><td class="num">${fmt(r.ypt)}</td>` : ''}
        ${pos === 'RB' ? `<td class="num">${fmt(r.touchesPg)}</td><td class="num">${fmt(r.ypc)}</td>` : ''}
        <td class="num">${r.rzOpps}</td><td class="num">${fmt(r.stdev)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">WOPR = 1.5 × target share + 0.7 × air-yards share. *Sleeper only reports air yards on completed catches, so Air% and WOPR understate deep targets that fell incomplete. Team shares use each player's current team. RoS blends season, last-3 and next-week projection.</p>`, { span: 12 })}
  </div>`;
  $.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/metrics/${b.dataset.pos}`; }));
  sortableTable(document.getElementById('mt'));
  if (recv) {
    const rows = d.rows.filter((r) => r.games >= 3).slice(0, 40);
    scatter(document.getElementById('c-opp'), {
      points: rows.map((r) => ({ x: pos === 'RB' ? r.touchesPg ?? 0 : (r.tgtShare ?? 0) * 100, y: r.ppg, label: r.name, highlight: r.owner === session.teamName })),
      xLabel: pos === 'RB' ? 'Touches per game' : 'Target share %', yLabel: 'Fantasy PPG', xFmt: (v) => fmt(v), yFmt: (v) => fmt(v),
      quadrants: ['Efficient', 'Elite volume', 'Low usage', 'Buy-low: volume > output'], height: 420,
    });
  }
}

// ---------- news ----------
async function viewNews($) {
  const [n, h] = await Promise.all([api('/news'), api('/highlights').catch(() => ({ items: [], status: [] }))]);
  const failed = n.status.filter((x) => !x.ok).map((x) => x.source);
  const tile = (i, video) => `<a class="item" href="${esc(i.link)}" target="_blank" rel="noopener">
    <div class="thumb">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${video ? '<span class="play">▶</span>' : ''}</div>
    <div class="body"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.source)} · ${ago(i.published)}</div>${i.summary ? `<div class="summary">${esc(i.summary.slice(0, 150))}</div>` : ''}</div></a>`;
  $.innerHTML = `${head('News & Highlights', `${n.status.filter((s) => s.ok).length}/${n.status.length} sources loaded${failed.length ? ` (unavailable: ${esc(failed.join(', '))})` : ''}.`,
    '<input id="q" placeholder="Filter by player or team…" style="min-width:260px">')}
    <h3>Highlights</h3><div class="news" id="hl">${h.items.slice(0, 8).map((i) => tile(i, true)).join('') || '<p class="muted">No highlights loaded.</p>'}</div>
    <h3 style="margin-top:28px">Articles</h3><div class="news" id="art">${n.items.slice(0, 60).map((i) => tile(i)).join('')}</div>`;
  document.getElementById('q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const f = (items) => items.filter((i) => !q || `${i.title} ${i.summary}`.toLowerCase().includes(q));
    document.getElementById('art').innerHTML = f(n.items).slice(0, 60).map((i) => tile(i)).join('') || '<p class="muted">No matches.</p>';
    document.getElementById('hl').innerHTML = f(h.items).slice(0, 8).map((i) => tile(i, true)).join('') || '<p class="muted">No matches.</p>';
  });
}

// ---------- player ----------
async function viewPlayer($, id) {
  const d = await api(L(`/player/${id}`));
  const p = d.player, m = d.metrics || {};
  const notes = (title, list, cls) => (list.length ? `<h3>${title}</h3><ul class="reasons">${list.map((x) => `<li class="${cls}">${esc(x)}</li>`).join('')}</ul>` : '');
  const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${p.name} highlights`)}`;
  $.innerHTML = `<p class="small"><a href="javascript:history.back()">← Back</a></p>
  <div class="grid">
    <section class="card hero span-12"><div class="hero-team">${playerAv({ ...p, id: p.id }, 'lg')}<div>
      <div class="eyebrow">${posTag(p.pos)} ${esc(p.team)}${p.number ? ` · #${esc(p.number)}` : ''} · Age ${esc(p.age ?? '—')} · ${esc(p.exp ?? 0)} yrs exp${p.college ? ` · ${esc(p.college)}` : ''}</div>
      <h1>${esc(p.name)} ${p.injury ? `<span class="chip bad">${esc(p.injury)}</span>` : ''}</h1>
      <div class="muted">${d.owner ? `Rostered by <b>${esc(d.owner.name)}</b>` : '<span class="chip good">Free agent</span>'}</div></div></div>
      <div class="hero-stats">
        <div><b>${d.rank ? `${esc(p.pos)}${d.rank.rank}` : '—'}</b><span>Rest-of-season rank</span></div>
        <div><b>${fmt(m.ppg)}</b><span>PPG · ${m.games ?? 0} games</span></div>
        <div><b>${fmt(m.last3)}</b><span>Last 3 PPG ${m.trend ? `(${sign(m.trend)})` : ''}</span></div>
        <div><b>${fmt(m.proj)}</b><span>This week proj</span></div>
        <div><b>${k(d.value?.value)}</b><span>Trade value${d.value?.trend30 ? ` · ${d.value.trend30 > 0 ? '+' : ''}${d.value.trend30} 30d` : ''}</span></div>
      </div></section>
    ${card('Fantasy points by week', m.log?.length ? '<div id="c-pts"></div>' : '<p class="muted">No games yet.</p>', { span: 8, note: 'hover a bar for usage' })}
    ${card('Scouting report', notes('Outlook', d.report.outlook, '') + notes('Strengths', d.report.strengths, 'up') + notes('Concerns', d.report.concerns, 'down'), { span: 4 })}
    ${m.log?.length ? card('Snap share by week', '<div id="c-snap"></div>', { span: 6 }) : ''}
    ${card('Usage profile', `<table><tbody>
      <tr><td>Snap share (season / L3)</td><td class="num">${pct(m.snapShare)} / ${pct(m.snapShareL3)}</td></tr>
      <tr><td>Target share (season / L3)</td><td class="num">${pct(m.tgtShare)} / ${pct(m.tgtShareL3)}</td></tr>
      <tr><td title="Based on air yards from completed catches">Air-yards share · WOPR*</td><td class="num">${pct(m.airShare)} · ${fmt(m.wopr, 2)}</td></tr>
      <tr><td>Targets / game · Yds / catch</td><td class="num">${fmt(m.tgtPg)} · ${fmt(m.ypr)}</td></tr>
      <tr><td>Touches / game · YPC</td><td class="num">${fmt(m.touchesPg)} · ${fmt(m.ypc)}</td></tr>
      <tr><td>Catch rate · Yds / target</td><td class="num">${pct(m.catchRate)} · ${fmt(m.ypt)}</td></tr>
      <tr><td>Red-zone opportunities · TDs</td><td class="num">${m.rzOpps ?? '—'} · ${m.tds ?? '—'}</td></tr>
      <tr><td>Floor / ceiling / st. dev</td><td class="num">${fmt(m.floor)} / ${fmt(m.ceiling)} / ${fmt(m.stdev)}</td></tr></tbody></table>`, { span: 6 })}
    ${m.log?.length ? card('Game log', `<div class="scroll"><table><thead><tr><th>Wk</th><th class="num">Pts</th><th class="num">Snap%</th><th class="num">Tgt</th><th class="num">Rec</th><th class="num">Rec yd</th><th class="num">Att</th><th class="num">Rush yd</th><th class="num">Pass yd</th><th class="num">TD</th></tr></thead>
      <tbody>${m.log.map((g) => `<tr><td>${g.week}</td><td class="num"><b>${fmt(g.pts)}</b></td><td class="num">${pct(g.snapPct)}</td><td class="num">${g.tgt}</td><td class="num">${g.rec}</td><td class="num">${g.recYd}</td><td class="num">${g.att}</td><td class="num">${g.rushYd}</td><td class="num">${g.passYd}</td><td class="num">${g.td}</td></tr>`).join('')}</tbody></table></div>`, { span: 12 }) : ''}
    ${card('News', d.news.map((n) => `<div class="li"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="small muted">${esc(n.source)} · ${ago(n.published)}</div></div>`).join('') || '<p class="muted">No recent headlines mention this player.</p>', { span: 6 })}
    ${card('Highlights', (d.highlights.map((n) => `<div class="li"><a href="${esc(n.link)}" target="_blank" rel="noopener">▶ ${esc(n.title)}</a></div>`).join('') || '<p class="muted">No recent highlight videos.</p>') + `<p class="small"><a href="${ytSearch}" target="_blank" rel="noopener">Search YouTube for ${esc(p.name)} highlights →</a></p>`, { span: 6 })}
  </div>`;
  if (m.log?.length) {
    columns(document.getElementById('c-pts'), { data: m.log.map((g) => ({ x: g.week, y: g.pts, g })), yFmt: (v) => fmt(v, 0),
      tipFn: (d2) => `<b>Week ${d2.g.week}: ${fmt(d2.g.pts)} pts</b>${d2.g.snapPct != null ? `${pct(d2.g.snapPct)} snaps · ` : ''}${d2.g.tgt} tgt · ${d2.g.att} att · ${d2.g.td} TD` });
    if (document.getElementById('c-snap')) lines(document.getElementById('c-snap'), { xs: m.log.map((g) => g.week), xFmt: (w) => `W${w}`, xLabel: 'Week', height: 200, yFmt: (v) => `${Math.round(v)}%`,
      series: [{ label: 'Snap %', color: 'var(--series-me)', values: m.log.map((g) => ({ y: g.snapPct == null ? null : g.snapPct * 100 })) }] });
  }
}

// ---------- awards ----------
async function viewAwards($) {
  const a = await api(L('/awards'));
  $.innerHTML = `<div class="paper">
    <div class="topline"><span>Vol. ${esc(a.season)} · Special Edition</span><span>${a.complete ? 'Season in review' : `Through Week ${a.weeksPlayed}`}</span><span>Price: $1 FAAB</span></div>
    <div class="flag">${esc(`The ${session.leagueName} Gazette`)}</div>
    <div class="tag">${esc(a.title)}: the envelopes, please</div>
    <hr class="rule">
    <div style="display:grid;gap:26px 30px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${a.awards.map((w) => `<article class="story" style="margin:0">
      <div class="kicker">${esc(w.title)}</div>
      <h3>${esc(w.team)}${w.nickname ? ` <span style="font-weight:400;font-style:italic;font-size:15px">(${esc(w.nickname)})</span>` : ''}</h3>
      <div style="font:700 13px/1.3 var(--font);margin:2px 0 6px">${esc(w.stat)}</div>
      <p>${esc(w.blurb)}</p>${w.speech ? `<p style="margin-top:6px;font-style:italic">${esc(w.speech)}</p>` : ''}
      ${w.team === session.teamName ? '<div class="small" style="margin-top:6px;font-family:var(--font)"><span class="chip warn">📣 That’s you</span></div>' : ''}</article>`).join('')}</div>
    <div class="fine">Satire. Every stat is real; every acceptance speech is not. ${a.complete ? '' : 'Final awards print when the regular season ends.'}</div>
  </div>`;
}

// ---------- rivalry ----------
async function viewRivalry($) {
  const lg = await api(L());
  const teams = lg.teams;
  const meOwner = session.userId;
  let a = routeQuery.get('a') || meOwner, b = routeQuery.get('b');
  if (!b) {
    const per = await api(L('/personas')).catch(() => null);
    const myRival = per?.personas.find((p) => p.ownerId === a)?.rival;
    b = teams.find((t) => t.name === myRival)?.ownerId || teams.find((t) => t.ownerId !== a)?.ownerId;
  }
  const r = await api(L(`/rivalry?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`));
  const sel = (id2, cur, other) => `<select id="${id2}">${teams.map((t) => `<option value="${esc(t.ownerId)}" ${t.ownerId === cur ? 'selected' : ''} ${t.ownerId === other ? 'disabled' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
  const lead = r.record.a > r.record.b ? r.a.team : r.record.b > r.record.a ? r.b.team : null;
  const tape = (x, y) => `<div style="text-align:center">${teamAv({ name: x.team, avatar: x.avatar }, 'lg')}<h2 style="margin:8px 0 2px;font:700 22px/1.2 var(--font-display)">${esc(x.team)}</h2>
    ${x.persona ? `<div class="small muted"><i>${esc(x.persona.nickname)}</i> · ${esc(x.persona.voiceLabel)}</div>` : ''}
    <div class="kpis" style="margin-top:10px;grid-template-columns:repeat(2,1fr)"><div class="kpi"><b>${esc(x.record || '—')}</b><span>This season</span></div><div class="kpi"><b>${esc(x.allTime || '—')}</b><span>All-time</span></div>
      <div class="kpi"><b>${x.titles ? '🏆'.repeat(x.titles) : '0'}</b><span>Titles</span></div><div class="kpi"><b>${x.titleOdds != null ? `${fmt(x.titleOdds)}%` : '—'}</b><span>Title odds</span></div></div>
    ${x.trashTalk ? `<p style="font-style:italic;margin-top:10px">${esc(x.trashTalk)}</p>` : ''}</div>`;
  const maxM = Math.max(1, ...r.games.map((g) => Math.abs(g.margin)));
  $.innerHTML = `${head('Rivalries', 'Everything between two teams, all-time: head-to-head, blowouts, trades, and the personas’ trash talk.', `<div class="row">${sel('rv-a', a, b)}<span class="muted">vs</span>${sel('rv-b', b, a)}</div>`)}
  <div class="grid">
    <section class="card span-12"><div class="rv-tape">
      <div>${tape(r.a, r.b)}</div>
      <div class="rv-mid"><div class="eyebrow">All-time</div><div style="font:700 44px/1 var(--font-display)">${r.record.a}–${r.record.b}${r.record.ties ? `–${r.record.ties}` : ''}</div>
        <div class="small muted" style="margin-top:6px">${r.record.games} game${r.record.games === 1 ? '' : 's'}${lead ? ` · ${esc(lead)} leads` : r.record.games ? ' · dead even' : ''}</div>
        ${r.streak ? `<div class="chip" style="margin-top:8px">${esc(r.streak.team)} ${r.streak.n > 1 ? `won the last ${r.streak.n}` : 'won the last one'}</div>` : ''}
        ${r.next ? `<div class="chip warn" style="margin-top:8px">Next: Week ${r.next.week}</div>` : ''}
        ${r.personaRivals.a || r.personaRivals.b ? '<div class="small" style="margin-top:8px">🔥 Official Gazette rivals</div>' : ''}</div>
      <div>${tape(r.b, r.a)}</div></div></section>
    ${card('Every game', r.games.length ? `<div>${r.games.map((g) => `<div class="bullet" style="grid-template-columns:90px 1fr 120px" data-tip="${esc(`<b>${g.season} · Week ${g.week}</b>${esc(r.a.team)} ${g.aPts} – ${esc(r.b.team)} ${g.bPts}`)}">
        <span class="small muted">${g.season} W${g.week}</span>
        <div class="track" style="background:transparent"><div class="mark" style="left:50%;background:var(--muted);width:1px"></div>
          <div style="position:absolute;top:0;bottom:0;${g.margin >= 0 ? 'left:50%;border-radius:0 4px 4px 0;background:var(--div-pos-2)' : 'right:50%;border-radius:4px 0 0 4px;background:var(--div-neg-2)'};width:${(Math.abs(g.margin) / maxM) * 50}%"></div></div>
        <span class="small num" style="text-align:right">${g.aPts}–${g.bPts}</span></div>`).join('')}
        <div class="legend" style="margin-top:8px"><span><i style="background:var(--div-pos-2)"></i>${esc(r.a.team)} won</span><span><i style="background:var(--div-neg-2)"></i>${esc(r.b.team)} won</span></div></div>` : '<p class="muted">They have never played.</p>', { span: 7, note: `average margin ${r.avgMargin > 0 ? '+' : ''}${r.avgMargin} for ${esc(r.a.team)}` })}
    ${card('Record book', `<div class="kpis" style="grid-template-columns:1fr">
        ${r.biggestA ? `<div class="record"><span class="eyebrow">${esc(r.a.team)}'s biggest win</span><b>+${r.biggestA.margin}</b>${r.biggestA.aPts}–${r.biggestA.bPts} · ${r.biggestA.season} W${r.biggestA.week}</div>` : ''}
        ${r.biggestB ? `<div class="record"><span class="eyebrow">${esc(r.b.team)}'s biggest win</span><b>+${Math.abs(r.biggestB.margin)}</b>${r.biggestB.bPts}–${r.biggestB.aPts} · ${r.biggestB.season} W${r.biggestB.week}</div>` : ''}
        ${r.closest ? `<div class="record"><span class="eyebrow">Closest game</span><b>${Math.abs(r.closest.margin)}</b>${r.closest.aPts}–${r.closest.bPts} · ${r.closest.season} W${r.closest.week}</div>` : ''}</div>`, { span: 5 })}
    ${card('Trades between them', r.trades.length ? r.trades.map((t) => `<div class="li"><div class="row" style="justify-content:space-between"><span class="small muted">${t.offseason ? 'Offseason' : `Week ${t.week}`} · ${new Date(t.at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}${t.teamsCount > 2 ? ' · 3-team' : ''}</span><span class="chip">${esc(t.verdict)}</span></div>
        <div class="row" style="margin-top:6px"><span class="${gradeCls(t.a.grade)} sm">${esc(t.a.grade)}</span><span class="small">${esc(r.a.team)} got ${esc(t.a.received.join(', ') || 'FAAB')}</span></div>
        <div class="row" style="margin-top:4px"><span class="${gradeCls(t.b.grade)} sm">${esc(t.b.grade)}</span><span class="small">${esc(r.b.team)} got ${esc(t.b.received.join(', ') || 'FAAB')}</span></div></div>`).join('') : '<p class="muted">No trades between these two. Trust issues, presumably.</p>', { span: 12 })}
  </div>`;
  const go = () => { location.hash = `#/rivalry?a=${encodeURIComponent(document.getElementById('rv-a').value)}&b=${encodeURIComponent(document.getElementById('rv-b').value)}`; };
  document.getElementById('rv-a').onchange = go; document.getElementById('rv-b').onchange = go;
}

// ---------- season wrapped ----------
async function viewWrapped($) {
  const d = await api(L('/wrapped'));
  const owner = routeQuery.get('team') || session.userId;
  const t = d.teams.find((x) => x.ownerId === owner) || d.teams[0];
  const tile = (eyebrow, big, sub, tone = '') => `<div class="card wrap-tile ${tone}"><div class="eyebrow">${eyebrow}</div><div class="wrap-big">${big}</div><div class="wrap-sub">${sub}</div></div>`;
  const tradeLine = (tr) => (tr ? `${esc(tr.received.slice(0, 2).join(' + ') || 'FAAB')} from ${esc(tr.partners.join(' & '))}` : '');
  $.innerHTML = `${head(`${esc(d.season)} Wrapped`, `${d.complete ? 'The full season' : `The season so far (${d.weeksPlayed} weeks)`}, one team at a time. Pick a team to see theirs.`,
    `<select id="wr-team">${d.teams.map((x) => `<option value="${esc(x.ownerId)}" ${x === t ? 'selected' : ''}>${esc(x.team)}</option>`).join('')}</select>`)}
  <section class="card hero" style="margin-bottom:16px"><div class="hero-team">${teamAv({ name: t.team, avatar: t.avatar }, 'lg')}<div>
    <div class="eyebrow">${t.persona ? `${esc(t.persona.archetype)} · ${esc(t.persona.voiceLabel)}` : 'Season Wrapped'}</div><h1>${esc(t.team)}</h1>
    ${t.persona ? `<div class="muted"><i>${esc(t.persona.nickname)}</i>: “${esc(t.persona.catchphrase)}”</div>` : ''}</div></div>
    <div class="hero-stats"><div><b>${esc(t.record)}</b><span>Record</span></div><div><b>${t.pf}</b><span>Points for</span></div><div><b>${t.ppg}</b><span>Per week</span></div>
      ${t.allPlay ? `<div><b>${esc(t.allPlay)}</b><span>All-play</span></div>` : ''}<div><b>${t.luck > 0 ? '+' : ''}${t.luck}</b><span>Luck (wins)</span></div></div></section>
  <div class="wrap-grid">
    ${t.bestWeek ? tile('Your best week', `${t.bestWeek.pts}`, `Week ${t.bestWeek.week}${t.bestWeek.opp ? ` vs ${esc(t.bestWeek.opp)} (${t.bestWeek.oppPts})` : ''}`, 'good') : ''}
    ${t.worstWeek ? tile('Your worst week', `${t.worstWeek.pts}`, `Week ${t.worstWeek.week}. We don't talk about Week ${t.worstWeek.week}.`, 'bad') : ''}
    ${t.mvp ? tile('Your MVP', esc(t.mvp.name), `${t.mvp.pts} pts in ${t.mvp.games} starts · ${esc(t.mvp.pos)}`) : ''}
    ${t.mostStarted && t.mostStarted.name !== t.mvp?.name ? tile('Most trusted', esc(t.mostStarted.name), `Started ${t.mostStarted.games} of ${d.weeksPlayed} weeks`) : ''}
    ${t.biggestWin ? tile('Most disrespectful win', `+${Math.round((t.biggestWin.pts - t.biggestWin.oppPts) * 10) / 10}`, `${t.biggestWin.pts}–${t.biggestWin.oppPts} over ${esc(t.biggestWin.opp)}, Week ${t.biggestWin.week}`, 'good') : ''}
    ${t.toughestLoss ? tile('The heartbreaker', `${Math.round((t.toughestLoss.pts - t.toughestLoss.oppPts) * 10) / 10}`, `Lost ${t.toughestLoss.pts}–${t.toughestLoss.oppPts} to ${esc(t.toughestLoss.opp)}, Week ${t.toughestLoss.week}`, 'bad') : ''}
    ${t.worstCall ? tile('Worst lineup call', `−${t.worstCall.cost}`, `Week ${t.worstCall.week}: benched ${esc(t.worstCall.benched.name)} (${t.worstCall.benched.pts}) for ${esc(t.worstCall.started.name)} (${t.worstCall.started.pts})`, 'bad') : ''}
    ${tile('Points left on the bench', `${t.benchTotal}`, `All season. The bench thanks you for the opportunity.`)}
    ${t.bestAdd ? tile('Best waiver pickup', esc(t.bestAdd.name), `${t.bestAdd.pts} pts in your lineup${t.bestAdd.faab ? ` · $${t.bestAdd.faab}` : ''} · ${t.adds} pickups total`, 'good') : tile('Waiver activity', `${t.adds}`, 'pickups this season')}
    ${t.bestTrade ? tile('Best trade', `${esc(t.bestTrade.grade)}`, tradeLine(t.bestTrade), 'good') : tile('Trades', '0', 'A committed monogamist with this roster.')}
    ${t.worstTrade ? tile('Worst trade', `${esc(t.worstTrade.grade)}`, tradeLine(t.worstTrade), 'bad') : ''}
    ${t.outlook ? tile(d.complete ? 'Final outlook' : 'What happens next', `${t.outlook.playoffOdds >= 99.95 ? '>99' : Math.round(t.outlook.playoffOdds)}%`, `playoff odds · ${t.outlook.titleOdds != null ? `${fmt(t.outlook.titleOdds)}% to win it all` : `projected ${t.outlook.projWins} wins`}`) : ''}
  </div>
  <p class="small muted" style="margin-top:12px">Grades and values use today's numbers. ${d.complete ? '' : 'Updates every week until the season ends.'}</p>`;
  document.getElementById('wr-team').onchange = (e) => { location.hash = `#/wrapped?team=${encodeURIComponent(e.target.value)}`; };
}

// ---------- draft grades ----------
async function viewDrafts($) {
  const d = await api(L('/drafts'));
  if (!d.drafts.length) { $.innerHTML = `${head('Draft Grades', '')}<div class="card"><p class="muted">No completed drafts found for this league yet.</p></div>`; return; }
  const idx = Math.max(0, d.drafts.findIndex((x) => x.id === routeQuery.get('draft')));
  const dr = d.drafts[idx];
  const pick = (r) => `${posTag(r.pos)} <a href="#/player/${esc(r.playerId)}">${esc(r.player)}</a>`;
  $.innerHTML = `${head('Draft Grades', 'Every completed draft, re-graded at today’s market values. Each pick is compared with what its slot should have produced: the value of the player that draft yielded at that rank.',
    `<div class="seg">${d.drafts.map((x, i) => `<button data-d="${esc(x.id)}" class="${i === idx ? 'on' : ''}">${esc(x.season)} ${x.kind === 'Startup draft' ? 'Startup' : 'Rookie'}</button>`).join('')}</div>`)}
  <div class="grid">
    ${card(`${esc(dr.season)} ${esc(dr.kind)}: team grades`, `<div class="scroll"><table><thead><tr><th>Team</th><th class="num">Grade</th><th class="num">Value vs slots</th><th>Best pick</th><th>Worst pick</th></tr></thead><tbody>
      ${dr.teams.map((t) => `<tr class="${t.ownerId === session.userId ? 'me' : ''}"><td><b>${esc(t.team)}</b> <span class="muted small">${t.picks.length} picks</span></td><td class="num"><span class="${gradeCls(t.grade)} sm">${esc(t.grade)}</span></td>
        <td class="num ${trendCls(t.pct)}">${t.pct > 0 ? '+' : ''}${t.pct}%</td>
        <td class="small">${t.best && t.best.surplus > 0 ? `${pick(t.best)} <span class="muted">${esc(t.best.label)} → #${t.best.redraftPick}</span>` : '—'}</td>
        <td class="small">${t.worst && t.worst.surplus < 0 ? `${pick(t.worst)} <span class="muted">${esc(t.worst.label)} → #${t.worst.redraftPick}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>`, { span: 12, note: `${dr.picks} picks · ${dr.rounds} rounds` })}
    ${card('Steals', dr.steals.map((r) => `<div class="li row" style="justify-content:space-between"><span>${pick(r)} <span class="muted small">${esc(r.team)}</span></span><span class="small"><b>${esc(r.label)}</b> → redraft #${r.redraftPick}</span></div>`).join('') || '<p class="muted">None.</p>', { span: 6, note: 'went later than they would today' })}
    ${card('Busts', dr.busts.map((r) => `<div class="li row" style="justify-content:space-between"><span>${pick(r)} <span class="muted small">${esc(r.team)}</span></span><span class="small"><b>${esc(r.label)}</b> → redraft #${r.redraftPick}</span></div>`).join('') || '<p class="muted">None.</p>', { span: 6, note: 'went earlier than they would today' })}
    ${card('If we redrafted today', `<div class="scroll"><table><thead><tr><th class="num">#</th><th>Player</th><th>Originally</th><th>By</th><th class="num">Value now</th></tr></thead><tbody>
      ${dr.redraft.map((r, i) => `<tr><td class="rank num">${i + 1}</td><td>${pick(r)}</td><td class="num">${esc(r.label)} <span class="muted small">(#${r.pickNo})</span> ${r.pickNo > i + 1 ? `<span class="up small">▲${r.pickNo - i - 1}</span>` : r.pickNo < i + 1 ? `<span class="down small">▼${i + 1 - r.pickNo}</span>` : ''}</td><td class="small">${esc(r.team)}</td><td class="num">${k(r.value)}</td></tr>`).join('')}</tbody></table></div>`, { span: 12 })}
  </div>
  <p class="small muted">Value = median of KTC, FantasyCalc and DynastyProcess today. Retired or unvalued players count as 0. Hindsight, obviously.</p>`;
  $.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/drafts?draft=${encodeURIComponent(b.dataset.d)}`; }));
}

// ---------- pitch decks ----------
async function viewDecks($) {
  const d = await api(L('/decks'));
  const bySeason = {};
  for (const t of d.trades) (bySeason[t.season] ||= []).push(t);
  const mine = (t) => t.sides.some((x) => x.ownerId === session.userId);
  $.innerHTML = `${head('Pitch Decks', `Every trade in league history (${d.trades.length}) as an investor presentation, from either side: the deal, the assets, stats as of the trade, the strategic rationale, the chain of trades that funded it, and how the market sees it today. Open one, then present it full screen or save it as a PDF for the group chat.`)}
  ${Object.keys(bySeason).sort((a, b) => b - a).map((season) => card(`${esc(season)} season`, `<div class="deck-list">${bySeason[season].map((t) => `<div class="deck-row ${mine(t) ? 'me' : ''}">
      <div class="small muted">${t.offseason ? 'Offseason' : `Week ${t.week}`} · ${new Date(t.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      <div class="deck-sides">${t.sides.map((x) => `<a class="deck-side" href="#/deck/${esc(t.id)}?owner=${esc(x.ownerId)}"><b>${esc(x.team)}</b><span class="small muted">gets ${esc(x.received.join(', ') || 'FAAB')}</span><span class="small deck-open">Open deck →</span></a>`).join('')}</div>
    </div>`).join('')}</div>`, { span: 12, note: `${bySeason[season].length} trade${bySeason[season].length === 1 ? '' : 's'}` })).join('')}`;
}

const headshot = (id, cls = '') => `<img class="hs ${cls}" src="https://sleepercdn.com/content/nfl/players/${esc(id)}.jpg" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
const nflLogo = (t) => (t ? `<img class="logo" src="https://sleepercdn.com/images/team_logos/nfl/${esc(String(t).toLowerCase())}.png" alt="" onerror="this.remove()">` : '');
const ordWord = (r) => ['', '1ST', '2ND', '3RD', '4TH', '5TH'][r] || `${r}TH`;

function deckAsset(a, d, { dark = false, funded = false, small = false } = {}) {
  if (a.kind === 'pick' && !a.became) {
    const via = a.origOwner === d.presenter.ownerId ? `${esc(d.presenter.team)}'s own` : `via ${esc(a.origTeam)}`;
    return `<div class="pk ${dark ? 'dark' : ''} ${funded ? 'funded' : ''} ${small ? 'sm' : ''}"><span class="yr">${esc(a.season)}</span><b>${ordWord(a.round)} ROUND</b><i>${a.slot && a.round ? `${a.round}.${String(a.slot).padStart(2, '0')} · ` : ''}${via}</i></div>`;
  }
  if (a.became?.prospect) {
    const b = a.became;
    return `<div class="pl prospect ${funded ? 'funded' : ''} ${small ? 'sm' : ''}"><div class="ini">${esc(b.name.split(' ').map((w) => w[0]).join(''))}</div><div class="cap"><b>${esc(b.name)}</b><span>${esc(b.pos)} | ${esc(String(b.college || '').split(' ')[0] || 'Prospect')} · ${esc(a.season)} ${a.round}.${String(b.slot).padStart(2, '0')}</span></div></div>`;
  }
  const id = a.became ? a.became.playerId : a.id, name = a.became ? a.became.name : a.name;
  return `<div class="pl ${funded ? 'funded' : ''} ${small ? 'sm' : ''}" style="--tc:${esc(a.color || '#1b2a44')}">${nflLogo(a.nfl)}${headshot(id)}<div class="cap"><b>${esc(name)}</b><span>${a.became ? `${esc(a.season)} ${a.round}.${String(a.became.slot).padStart(2, '0')} pick` : `${esc(a.pos)}${a.nfl ? ` | ${esc(NFLshort(a))}` : ''}`}</span></div></div>`;
}
// Players as tall tiles, then picks stacked two to a column beside them.
function stackTiles(xs, d, small) {
  const isPick = (a) => a.kind === 'pick' && !a.became;
  const pls = xs.filter((a) => !isPick(a)), pks = xs.filter(isPick);
  const cols = [];
  for (let i = 0; i < pks.length; i += 2) cols.push(`<div class="pkcol">${pks.slice(i, i + 2).map((a) => deckAsset(a, d, { small })).join('')}</div>`);
  return pls.map((a) => deckAsset(a, d, { small })).join('') + cols.join('');
}
const NFLshort = (a) => String(a.nflName || a.nfl || '').split(' ').slice(0, -1).join(' ') || a.nfl;

function deckSlides(d) {
  const P = d.presenter, partners = d.partners.map((p) => p.team).join(' & ');
  const foot = (n, note = '') => `<div class="foot"><span>${note || `${esc(P.team)} | Investor Presentation | ${esc(session.leagueName)} | ${esc(d.dateLabel)}`}</span><span class="r">${teamAv({ name: P.team, avatar: P.avatar }, 'sm')}<b>${n}</b></span></div>`;
  const top = (eyebrow, title) => `<div class="eyebrow">${eyebrow}</div><h2>${esc(title)}</h2><hr>`;
  const slides = [];
  const tx = d.transaction;
  const heroA = d.spotlights[0]?.asset;

  // 1. Cover
  slides.push(`<section class="slide s-cover">
    <div class="cover-l">
      <div class="brandrow">${teamAv({ name: P.team, avatar: P.avatar })}<div><b>${esc(P.team.toUpperCase())}</b><span>${esc(session.leagueName)}</span></div></div>
      <h1>${esc(d.title)}</h1><div class="grn"></div>
      <div class="sub">Investor Presentation &nbsp;|&nbsp; ${esc(d.dateLabel)}</div>
      ${d.coverHeads.length ? `<div class="heads">${d.coverHeads.map((h) => `<div>${h.id ? headshot(h.id) : `<span class="ini">${esc(h.initials)}</span>`}</div>`).join('')}</div><div class="headnames">${d.coverHeads.map((h) => esc(h.name)).join(' &nbsp;|&nbsp; ')}</div>` : ''}
    </div>
    <div class="cover-r" style="--tc:${esc(heroA?.color || '#1b2a44')}">${heroA?.became?.prospect ? `<div class="bigpick"><span style="font-size:1.4cqw;color:#49a77a">${esc(heroA.season)} ${heroA.round}.${String(heroA.became.slot).padStart(2, '0')}</span><b>${esc(heroA.became.name.split(' ').slice(-1)[0].toUpperCase())}</b>${esc(heroA.became.college || '')}</div>` : heroA?.kind === 'player' ? `${nflLogo(heroA.nfl)}${headshot(heroA.id, 'big')}` : `<div class="bigpick">${heroA ? `${esc(heroA.season)}<b>${ordWord(heroA.round)}</b>ROUND` : ''}</div>`}</div>
  </section>`);

  // 2. Disclaimer
  slides.push(`<section class="slide s-text">${top('DISCLAIMER', 'Forward-Looking Statements and Other Important Information')}
    <ul class="disc">${d.disclaimers.map((x) => `<li><b>${esc(x.h)}</b> ${esc(x.t)}</li>`).join('')}</ul>${foot(2)}</section>`);

  // 3. The transaction
  const many = tx.received.length + tx.sent.length > 7;
  slides.push(`<section class="slide s-text">${top(d.proposal ? 'THE PROPOSED TRANSACTION' : 'THE TRANSACTION', tx.headline)}
    <div class="tx ${many ? 'many' : ''}">
      <div class="tx-col send"><div class="lab">${esc(P.team.toUpperCase())} SENDS</div><div class="tiles">${tx.sent.map((a) => deckAsset(a, d, { dark: true, small: many })).join('') || '<div class="muted">Nothing but goodwill</div>'}${tx.faabOut ? `<div class="pk sm"><b>$${tx.faabOut}</b><i>FAAB</i></div>` : ''}</div></div>
      <div class="arrow">➜</div>
      <div class="tx-col"><div class="lab">${esc(P.team.toUpperCase())} RECEIVES${d.partners.length > 1 ? ` <span>(from ${esc(partners)})</span>` : ''}</div><div class="tiles">${stackTiles(tx.received, d, many)}${tx.faabIn ? `<div class="pk sm"><b>$${tx.faabIn}</b><i>FAAB</i></div>` : ''}</div></div>
    </div>
    <div class="txbar"><div class="cnt">${tx.sent.length} asset${tx.sent.length === 1 ? '' : 's'}</div><div class="cnt dark"><span>${tx.received.length} asset${tx.received.length === 1 ? '' : 's'}.</span><p>${esc(tx.tagline)}</p></div></div>
    <div class="src">${d.proposal ? `Source: proposed trade from ${esc(P.team)} to ${esc(partners)}, prepared ${new Date(d.at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}. Subject to acceptance, counteroffers and vibes.` : `Source: Sleeper trade between ${esc(P.team)} and ${esc(partners)} (${new Date(d.at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}).`} Headshots: Sleeper.</div>${foot(3)}</section>`);

  // 4+. Spotlights
  for (const sp of d.spotlights) {
    const a = sp.asset;
    const pro = a.became?.prospect ? a.became : null;
    const isPick = a.kind === 'pick' && !pro;
    if (pro) {
      slides.push(`<section class="slide s-spot">
      <div class="spot-l prospect"><div class="bigpick"><span>${esc(a.season)} ${a.round}.${String(pro.slot).padStart(2, '0')}</span><b>${esc(pro.name.split(' ').slice(-1)[0].toUpperCase())}</b>${esc(pro.college || '')}<i>If ${esc(P.team)} drafts him</i></div></div>
      <div class="spot-r">
        <div class="who"><div><div class="eb">${esc(sp.eyebrow)}</div><h3>${esc(pro.name)}</h3><div class="meta">${esc(pro.pos)} &nbsp;|&nbsp; ${esc(pro.college || '')} &nbsp;|&nbsp; ${esc(a.season)} NFL Draft class</div></div></div>
        <hr>
        <div class="kpis3">${sp.stats.map((x) => `<div><b>${esc(x.big)}</b><span>${esc(x.label)}</span></div>`).join('')}</div>
        <blockquote>${esc(sp.callout)}</blockquote>
        <div class="foot dark"><span>${esc(sp.statsNote)}</span><span class="r">${teamAv({ name: P.team, avatar: P.avatar }, 'sm')}<b>${slides.length + 1}</b></span></div>
      </div></section>`);
      continue;
    }
    slides.push(`<section class="slide s-spot">
      <div class="spot-l" style="--tc:${esc(a.color || '#1b2a44')}">${isPick ? `<div class="bigpick">${esc(a.season)}<b>${ordWord(a.round)}</b>ROUND<i>${a.origOwner === P.ownerId ? `${esc(P.team)}'s own` : `via ${esc(a.origTeam)}`}</i></div>` : `${nflLogo(a.nfl)}${headshot(a.id, 'big')}`}</div>
      <div class="spot-r">
        <div class="who">${isPick ? '' : headshot(a.id, 'round')}<div><div class="eb">${esc(sp.eyebrow)}</div><h3>${esc(isPick ? a.label : a.name)}</h3><div class="meta">${isPick ? `${esc(a.season)} rookie draft` : `${esc(a.pos)} &nbsp;|&nbsp; ${esc(a.nflName)}${a.age ? ` &nbsp;|&nbsp; Age ${a.age}` : ''}${a.viaPick ? ` &nbsp;|&nbsp; via ${esc(a.viaPick.split(' → ')[0])}` : ''}`}</div></div></div>
        <hr>
        <div class="kpis3">${sp.stats.map((x) => `<div><b>${esc(x.big)}</b><span>${esc(x.label)}</span></div>`).join('')}</div>
        <blockquote>${esc(sp.callout)}</blockquote>
        <div class="foot dark"><span>${esc(sp.statsNote)}</span><span class="r">${teamAv({ name: P.team, avatar: P.avatar }, 'sm')}<b>${slides.length + 1}</b></span></div>
      </div></section>`);
  }

  // Strategic rationale
  const R = d.rationale;
  const cell = (c, solid) => `<div class="tl-cell">${c.assets.length ? `<div class="tl-assets">${c.assets.slice(0, 4).map((a) => (a.kind === 'player' || (a.became && !a.became.prospect) ? `<div class="tl-hs">${headshot(a.became ? a.became.playerId : a.id)}</div>` : deckAsset(a, d, { dark: !solid, small: true }))).join('')}${c.assets.length > 4 ? `<span class="more">+${c.assets.length - 4}</span>` : ''}</div>` : '<div class="tl-dot"></div>'}<div class="tl-note ${c.assets.length && solid ? 'b' : ''}">${esc(c.note)}</div></div>`;
  slides.push(`<section class="slide s-text">${top('STRATEGIC RATIONALE', R.headline)}
    <div class="tl" style="--cols:${R.cols.length}">
      <div></div>${R.cols.map((c) => `<div class="tl-h">${esc(c)}</div>`).join('')}
      <div class="tl-row"><b>Hold</b><span>Status quo</span></div><div class="tl-line dashed" style="grid-column:span ${R.cols.length}">${R.hold.map((c) => cell(c, false)).join('')}</div>
      <div class="tl-row"><b>${d.proposal ? 'Accept the offer' : 'Execute the trade'}</b><span>${d.proposal ? 'Proposed to' : 'Agreed with'} ${esc(partners)}</span></div><div class="tl-line" style="grid-column:span ${R.cols.length}">${R.execute.map((c) => cell(c, true)).join('')}</div>
    </div>
    <div class="banner"><b>${esc(R.banner.h)}</b><p>${esc(R.banner.t)}</p></div>${foot(slides.length + 1)}</section>`);

  // Case study
  if (d.caseStudy) {
    const C = d.caseStudy;
    slides.push(`<section class="slide s-text">${top('CASE STUDY | VALUE CREATION', C.headline)}
      <div class="cs-lab">TRADE I &nbsp;|&nbsp; WITH ${esc(C.trade.partners.toUpperCase())} · ${new Date(C.trade.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }).toUpperCase()}</div>
      <div class="cs-row"><div class="tiles">${C.trade.sent.map((a) => deckAsset(a, d, { dark: true, small: true })).join('')}</div><div class="arrow">➜</div><div class="tiles">${C.trade.received.map((a) => deckAsset(a, d, { funded: a.funded, small: true })).join('')}</div></div>
      <div class="cs-link">${esc(C.fundedLabel)} ↓</div>
      <div class="cs-lab">TRADE ${C.trades > 2 ? C.trades : 'II'} &nbsp;|&nbsp; THIS DEAL</div>
      <div class="cs-row"><div class="tiles">${C.current.sent.map((a) => deckAsset(a, d, { dark: true, funded: a.funded, small: true })).join('')}</div><div class="arrow">➜</div><div class="tiles">${C.current.received.map((a) => deckAsset(a, d, { small: true })).join('')}</div></div>
      <div class="src">Source: Sleeper trade records.${C.trades > 2 ? ` This deal is the end of a chain of ${C.trades} trades; the scoreboard counts all of them.` : ''}</div>${foot(slides.length + 1)}</section>`);
  }

  // Scoreboard
  if (d.scoreboard) {
    const B = d.scoreboard;
    const o = B.original;
    slides.push(`<section class="slide s-dark">
      <div class="eyebrow">THE SCOREBOARD</div><h2>${esc(B.headline)}</h2><p class="lede">${esc(B.lede)}</p>
      <div class="sb">
        <div class="sb-o">${o.slice(0, 2).map((a) => deckAsset(a, d, { small: true })).join('')}${o.length > 2 ? `<span class="more">+${o.length - 2}</span>` : ''}</div>
        <div class="sb-x"><span>➜</span><b>${esc(B.multiple)}</b></div>
        <div class="sb-h">${[...B.holdings].sort((x, y) => (x.kind === 'pick' && !x.became) - (y.kind === 'pick' && !y.became)).map((a) => `<div class="${a.stillHeld === false ? 'gone' : ''}">${deckAsset(a, d, { small: true })}</div>`).join('')}</div>
      </div>
      <div class="sb-k"><div><b>${esc(B.counts.total)}</b><span>total assets</span></div><div><b>+${B.counts.players}</b><span>players</span></div><div><b>+${B.counts.firsts}</b><span>first-round picks</span></div><div><b>+${B.counts.otherPicks}</b><span>other picks</span></div></div>
      <div class="src">${B.market.multiple != null ? `Multiple by asset count. By today's market value it is <b>${B.market.multiple}x</b> (${B.market.original.toLocaleString()} → ${B.market.holdings.toLocaleString()})${B.adjusted.multiple != null ? `; league-adjusted with the consolidation discount, <b>${B.adjusted.multiple}x</b>` : ''}. ` : ''}${esc(B.footnote)}</div>
      ${foot(slides.length + 1)}</section>`);
  }

  // Analyst coverage
  const Cv = d.coverage;
  const verdictLine = Cv.edge >= 15 ? 'Analysts are unanimous. The counterparty has been asked to stop answering its phone.' : Cv.edge <= -15 ? 'Analysts have questions. Management has answers. They are not the same questions.' : 'Analysts call it fair. Both sides will say they won anyway.';
  slides.push(`<section class="slide s-text">${top('ANALYST COVERAGE', `The market's view today: ${Cv.edge > 0 ? '+' : ''}${Cv.edge}% in value for ${P.team}`)}
    <div class="cov">
      <div>
        <div class="grades">${Cv.grade ? `<div><span class="${gradeCls(Cv.grade)}">${esc(Cv.grade)}</span><b>${esc(P.team)}</b>${Cv.adjustedGrade ? `<span class="small">League-adjusted ${esc(Cv.adjustedGrade)}</span>` : ''}</div>` : ''}${Cv.partnerGrades.map((g) => `<div><span class="${gradeCls(g.grade)}">${esc(g.grade)}</span><b>${esc(g.team)}</b></div>`).join('')}</div>
        <div class="vals"><div><span>Received, today's value</span><b>${Cv.received.toLocaleString()}</b></div><div><span>Sent, today's value</span><b>${Cv.sent.toLocaleString()}</b></div></div>
        ${Cv.perSource.length ? `<div class="srcs">${Cv.perSource.map((x) => `<div><span>${esc(x.source)}</span><div class="bar"><i style="${x.edge >= 0 ? 'left:50%' : `right:50%`};width:${Math.min(50, Math.abs(x.edge) / 2)}%;background:${x.edge >= 0 ? '#2f7d57' : '#b3412f'}"></i></div><b>${x.edge > 0 ? '+' : ''}${x.edge}%</b></div>`).join('')}</div>` : ''}
        ${Cv.sincePts && !d.offseason && (Cv.sincePts.acquired || Cv.sincePts.departed) ? `<p class="small">Since the deal: acquired players ${Cv.sincePts.acquired} pts, departed players ${Cv.sincePts.departed} pts.</p>` : ''}
        ${d.proposal ? '' : `<p class="small">Still on the roster: ${Cv.stillHeld.map((x) => `${esc(x.label)} ${x.held === false ? '✗' : '✓'}`).join(' · ')}</p>`}
      </div>
      <div>
        <p class="vline">${esc(verdictLine)}</p>
        ${Cv.management ? `<blockquote>${esc(Cv.management)}</blockquote>` : ''}${Cv.counterparty ? `<blockquote class="cp">${esc(Cv.counterparty)}</blockquote>` : ''}
      </div>
    </div>
    <div class="src">${Cv.scenario ? `<b>${esc(Cv.scenario.text)}</b> ` : ''}Values: median of KeepTradeCut, FantasyCalc and DynastyProcess today${Cv.grade ? '. Grades from the Trade Grades page (value, lineup impact and fit).' : '.'} Quotes are satire, generated from each team's Gazette persona.</div>${foot(slides.length + 1)}</section>`);
  return slides;
}

async function viewDeck($, tradeId) {
  const owner = routeQuery.get('owner') || '';
  const isProposal = tradeId === 'proposal';
  // A proposal carries the analyzer's selections (a, b, ga, gb) in the query string.
  // Proposals carry the analyzer's selections (a, b, ga, gb); any deck can carry a what-if (assume).
  const withParam = (k, v) => { const q = new URLSearchParams(routeQuery); if (v) q.set(k, v); else q.delete(k); return q.toString(); };
  const withOwner = (o) => withParam('owner', o);
  const d = await api(L(`/deck/${encodeURIComponent(tradeId)}?${routeQuery.toString()}`));
  const sc = d.scenario || { picks: [], options: [] };
  const assumedKey = sc.assumed?.key || sc.picks[0]?.key || '';
  const scenarioBar = sc.picks.length && sc.options.length ? `<div class="row deck-whatif"><span class="small muted">What if</span>
      <select id="dk-pick">${sc.picks.map((p) => `<option value="${esc(p.key)}" ${p.key === assumedKey ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
      <span class="small muted">becomes</span>
      <select id="dk-pros"><option value="">— keep the pick's market value —</option>${sc.options.map((o) => `<option value="${esc(o.slug)}" ${sc.assumed?.slug === o.slug ? 'selected' : ''}>${esc(o.name)} (${esc(o.pos)})</option>`).join('')}</select></div>` : '';
  const slides = deckSlides(d);
  const backToAnalyzer = isProposal ? `#/analyzer?a=${encodeURIComponent(routeQuery.get('a') || '')}&b=${encodeURIComponent(routeQuery.get('b') || '')}&ga=${encodeURIComponent(routeQuery.get('ga') || '')}&gb=${encodeURIComponent(routeQuery.get('gb') || '')}` : '';
  $.innerHTML = `${head(isProposal ? 'Pitch Deck: Proposed Trade' : 'Pitch Deck', isProposal
    ? `A proposed trade between ${d.sides.map((x) => esc(x.team)).join(' and ')}, pitched as an investor presentation. ${slides.length} slides. Save it as a PDF and send it with the offer.`
    : `${esc(d.season)} · ${d.offseason ? 'Offseason' : `Week ${d.week}`} trade between ${d.sides.map((x) => esc(x.team)).join(', ')}. ${slides.length} slides, told from one side.`,
    `<div class="row deck-bar"><div class="seg">${d.sides.map((x) => `<button data-o="${esc(x.ownerId)}" class="${x.ownerId === d.presenter.ownerId ? 'on' : ''}">${esc(x.team)}'s deck</button>`).join('')}</div>
      <button id="dk-present" class="primary">▶ Present</button><button id="dk-print">Save as PDF</button>${isProposal ? `<a class="chip" href="${backToAnalyzer}">← Edit in analyzer</a>` : '<a class="chip" href="#/decks">All decks</a>'}</div>`)}
  ${scenarioBar}${sc.assumed ? `<p class="small deck-whatif-note">Scenario deck: ${esc(sc.assumed.name)} in place of the pick. Grades are hidden because they price the pick, not the player.</p>` : ''}
  <div class="deck" id="deck">${slides.join('')}<div class="deck-nav"><button data-n="-1">‹</button><span id="dk-n"></span><button data-n="1">›</button><button data-x>✕</button></div></div>`;
  $.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', () => {
    location.hash = `#/deck/${encodeURIComponent(tradeId)}?${withOwner(b.dataset.o)}`;
  }));
  const pickSel = document.getElementById('dk-pick'), prosSel = document.getElementById('dk-pros');
  const applyWhatIf = () => { location.hash = `#/deck/${encodeURIComponent(tradeId)}?${withParam('assume', prosSel.value ? `${pickSel.value}:${prosSel.value}` : '')}`; };
  if (prosSel) { prosSel.onchange = applyWhatIf; pickSel.onchange = () => { if (prosSel.value) applyWhatIf(); }; }
  const deck = document.getElementById('deck');
  const all = [...deck.querySelectorAll('.slide')];
  let cur = 0;
  const show = (i) => { cur = Math.max(0, Math.min(all.length - 1, i)); all.forEach((s, j) => s.classList.toggle('on', j === cur)); document.getElementById('dk-n').textContent = `${cur + 1} / ${all.length}`; };
  const stop = () => { deck.classList.remove('presenting'); document.removeEventListener('keydown', keys); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  const keys = (e) => {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(cur + 1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) show(cur - 1);
    else if (e.key === 'Escape') stop();
  };
  document.getElementById('dk-present').onclick = () => {
    deck.classList.add('presenting'); show(0); document.addEventListener('keydown', keys);
    deck.requestFullscreen?.().catch(() => {});
  };
  deck.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) stop(); });
  deck.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => show(cur + Number(b.dataset.n))));
  deck.querySelector('[data-x]').onclick = stop;
  deck.addEventListener('click', (e) => { if (deck.classList.contains('presenting') && e.target.closest('.slide')) show(cur + 1); });
  document.getElementById('dk-print').onclick = () => window.print();
}

// ---------- data status ----------
async function viewStatus($) {
  const d = await api(`/status?league=${encodeURIComponent(session.leagueId)}`);
  const badge = { ok: ['good', '✓ Working'], warn: ['warn', '⚠ Check'], fail: ['bad', '✕ Down'], off: ['', '– Off'] };
  const rel = (t) => (t ? ago(t) : 'never');
  const areas = [...new Set(d.checks.map((c) => c.area))];
  const worst = d.checks.some((c) => c.status === 'fail') ? 'fail' : d.checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
  $.innerHTML = `${head('Data Status', `Where each part of the site gets its data, and whether it's working. Checked ${new Date(d.checkedAt).toLocaleTimeString()}.`,
    `<span class="chip ${badge[worst][0]}" style="font-size:14px;padding:6px 14px">${worst === 'ok' ? '✓ All systems working' : worst === 'warn' ? '⚠ Something needs a look' : '✕ A source is down'}</span>`)}
  <div class="grid">
    ${areas.map((a) => card(a, `<table><tbody>${d.checks.filter((c) => c.area === a).map((c) => `<tr><td style="width:220px"><b>${esc(c.name)}</b></td>
      <td style="width:110px"><span class="chip ${badge[c.status][0]}">${badge[c.status][1]}</span></td><td class="wrap small">${esc(c.detail || '')}</td></tr>`).join('')}</tbody></table>`, { span: 12 })).join('')}
    ${card('Requests since the server started', `<div class="scroll"><table><thead><tr><th>Source</th><th class="num">OK</th><th class="num">Failed</th><th>Last success</th><th>Last failure</th><th class="num">Last time</th></tr></thead><tbody>
      ${d.requests.sources.map((s2) => `<tr><td><b>${esc(s2.name)}</b></td><td class="num">${s2.ok}</td><td class="num ${s2.failed ? 'down' : ''}">${s2.failed}</td><td>${rel(s2.lastOk)}</td>
        <td class="wrap small">${s2.lastFail ? `${rel(s2.lastFail)}: ${esc(s2.lastError)}` : '—'}</td><td class="num">${s2.lastMs != null ? `${s2.lastMs} ms` : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No outside requests yet.</td></tr>'}
      </tbody></table></div><p class="small muted">Server up since ${new Date(d.requests.since).toLocaleString()}. Most data is cached (player database 24h, values 6–12h, scores 5 min), so few requests is normal.</p>`, { span: 12 })}
  </div>`;
}

// ---------- router ----------
const views = { status: viewStatus, '': viewDashboard, power: viewPower, history: viewHistory, team: viewTeam, waivers: viewWaivers, analyzer: viewAnalyzer, trades: viewTrades, rookies: viewRookies, rookie: viewRookie, gazette: viewGazette, grades: viewGrades, awards: viewAwards, decks: viewDecks, deck: viewDeck, rivalry: viewRivalry, wrapped: viewWrapped, drafts: viewDrafts, metrics: viewMetrics, news: viewNews, player: viewPlayer };

async function route() {
  const [path, qs = ''] = location.hash.replace(/^#/, '').split('?');
  const [, name = '', arg] = path.split('/');
  routeQuery = new URLSearchParams(qs);
  if (siteConfig.leagueId && session && session.leagueId !== siteConfig.leagueId) { store.del('fh.session'); session = null; }
  if (!session?.leagueId || name === 'connect') return viewConnect();
  const $ = renderShell(views[name] ? (name === 'rookie' ? 'rookies' : name === 'deck' ? 'decks' : name) : '');
  try {
    await (views[name] || viewDashboard)($, arg ? decodeURIComponent(arg) : undefined);
  } catch (err) {
    $.innerHTML = `<div class="card"><p class="err">${esc(err.message)}</p><p><a href="#/connect">Reconnect your league</a></p></div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
(async () => {
  try { siteConfig = await api('/config'); } catch { /* single-user mode */ }
  route();
})();
