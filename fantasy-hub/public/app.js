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
};
const NAV = [['', 'Dashboard'], ['power', 'Power Rankings'], ['history', 'League History'], ['team', 'My Team'], ['waivers', 'Waivers'], ['analyzer', 'Trade Analyzer'], ['trades', 'Trade Finder'], ['rookies', 'Rookies'], ['metrics', 'Metrics'], ['news', 'News & Highlights']];

function renderShell(active) {
  root.innerHTML = `<div class="shell">
    <aside class="side">
      <a href="#/" class="brand"><span class="ball">🏈</span>Fantasy Hub</a>
      <nav>${NAV.map(([h, label]) => `<a href="#/${h}" class="${h === active ? 'active' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[h]}</svg>${label}</a>`).join('')}</nav>
      <div class="grow"></div>
      <div class="me">${teamAv({ name: session.teamName || session.username, avatar: session.avatar })}<div><b>${esc(session.teamName || session.username)}</b><small>${esc(session.leagueName)}</small></div></div>
      <div class="side-actions"><button id="theme" title="Toggle light/dark">◐</button><button id="switch">Switch</button></div>
    </aside>
    <main class="main" id="app"><div class="grid">${'<div class="skeleton span-6"></div>'.repeat(4)}</div></main>
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
  const dyn = d.dynasty.teams;
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
    ${card('This season', `<div id="c-season"></div>`, { span: 5, note: 'score 0–100' })}
    ${card('Contender or rebuilder?', `<div id="c-quad"></div>`, { span: 7, note: 'current strength vs. long-term value' })}
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
        return `<td class="cell" style="background:${bg};color:${fg}" data-tip="${esc(`<b>${esc(a.name)} vs ${esc(b.name)}</b>${g ? `${c.w}-${c.l}${c.t ? `-${c.t}` : ''} all-time` : 'Never played'}`)}">${g ? `${c.w}-${c.l}` : ''}</td>`;
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
    ${card('Optimal lineup', `<div class="scroll"><table>
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
const SRC_LABEL = { KTC: 'KeepTradeCut', FC: 'FantasyCalc', DP: 'DynastyProcess', Model: 'Fantasy Hub model' };
const consensusVal = (values, sources) => {
  const v = sources.map((s) => values[s]).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};
async function viewAnalyzer($) {
  const hub = await api(L('/values'));
  const okSrc = hub.sources.filter((s) => s.ok).map((s) => s.short);
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
        ${x.kind === 'pick' ? `<span class="pos" data-p="PICK" style="--pc:var(--pick)">PICK</span> <span>${esc(x.name)}</span>` : `${posTag(x.pos)} <span>${esc(x.name)}</span> <span class="muted small">${esc(x.team || '')}${x.age ? ` · ${x.age}` : ''}</span>`}
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
      <div class="row small muted" style="justify-content:space-between;max-width:620px"><span>◀ better for ${esc(nB)}</span><span>better for ${esc(nA)} ▶</span></div>
      <div style="max-width:620px">${edgeBar(r.consensus)}</div>
      <p class="small muted">Consensus value edge: <b>${who(r.consensus)}</b>${r.bestAsset ? ` · Best single asset: <b>${esc(r.bestAsset.label)}</b> (${esc(r.bestAsset.side === 'A' ? nB : nA)} receives it)` : ''}</p>
      <h3>By source</h3><div class="scroll"><table><thead><tr><th>Source</th><th class="hide-sm">Format</th><th class="num">${esc(nA)} sends</th><th class="num">${esc(nB)} sends</th><th>Edge</th><th></th></tr></thead><tbody>
        ${r.perSource.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="muted small hide-sm">${esc(p.format || '')}</td><td class="num">${p.sendA.toLocaleString()}</td><td class="num">${p.sendB.toLocaleString()}</td>
          <td>${edgeBar(p.edgeA)}</td><td class="small ${Math.abs(p.edgeA) <= 5 ? '' : p.edgeA > 0 ? 'up' : 'down'}">${who(p.edgeA)}${p.missing.length ? ` <span class="muted" title="${esc(p.missing.join(', '))}">· ${p.missing.length} unvalued</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${r.lineup ? `<h3>Weekly lineup impact (rest of season)</h3><div class="kpis">
        <div class="kpi"><b class="${trendCls(r.lineup.you.delta)}">${sign(r.lineup.you.delta)}</b><span>${esc(nA)} pts/wk</span></div>
        <div class="kpi"><b class="${trendCls(r.lineup.them.delta)}">${sign(r.lineup.them.delta)}</b><span>${esc(nB)} pts/wk</span></div></div>` : ''}
      <h3>Assets in this deal</h3><div class="scroll"><table><thead><tr><th>Asset</th><th>Goes to</th>${okSrc.map((s) => `<th class="num">${s}</th>`).join('')}</tr></thead><tbody>
        ${r.assets.map((x) => `<tr><td>${x.kind === 'pick' ? '🎟 ' : `${posTag(x.pos)} `}${x.kind === 'player' ? `<a href="#/player/${esc(x.id)}">${esc(x.label)}</a>` : esc(x.label)}</td><td>${esc(x.side === 'A' ? nB : nA)}</td>
          ${okSrc.map((s) => `<td class="num">${x.values[s] == null ? '—' : x.values[s].toLocaleString()}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="small muted">Each source uses its own scale, so compare edges, not raw numbers. DynastyProcess prices picks much lower than KTC, so pick-heavy deals often split the sources. Picks are valued at their projected slot (current standings) for next year's draft and at "mid" for later years.</p>`;
  }
  function renderAll() { renderSide('A'); renderSide('B'); evaluate(); }
  renderAll();
}

// ---------- rookies ----------
const POS4 = { QB: 'var(--qb)', RB: 'var(--rb)', WR: 'var(--wr)', TE: 'var(--te)' };
const height = (h) => (h ? `${Math.floor(h / 12)}'${h % 12}"` : '—');
const tierChip = (t) => `<span class="chip ${t === 'Elite' ? 'good' : t === 'Tier 1' ? 'good' : t === 'Depth' ? '' : 'warn'}">${esc(t)}</span>`;

async function viewRookies($) {
  const tab = routeQuery.get('view') === 'mock' ? 'mock' : 'board';
  const mode = routeQuery.get('mode') === 'bpa' ? 'bpa' : 'need';
  const posF = routeQuery.get('pos') || '';
  const d = await api(L('/rookies'));
  const go = (o) => { const p = new URLSearchParams({ view: tab, mode, pos: posF, ...o }); location.hash = `#/rookies?${p}`; };
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
  const rows = d.board.filter((r) => !posF || r.pos === posF);
  const tiers = ['Elite', 'Tier 1', 'Tier 2', 'Tier 3', 'Depth'];
  el.innerHTML = `<div class="grid">
    ${card('Value curve', `${legend(Object.entries(POS4).map(([label, color]) => ({ label, color })))}<div id="c-curve"></div>`, { span: 8, note: 'consensus score by rank (top 36) · tier cliffs show where to trade up or down' })}
    ${card('Position mix by tier', `<div id="c-tiers"></div>${legend(Object.entries(POS4).map(([label, color]) => ({ label, color })))}`, { span: 4 })}
    ${card(posF ? `${posF} rankings` : 'Big board', `<div class="scroll"><table id="bb">
      <thead><tr><th class="num" data-sort>#</th><th data-sort>Prospect</th><th data-sort>College</th><th class="num" data-sort>Age</th><th class="num">Size</th><th data-sort>Tier</th><th class="num" data-sort>KTC</th><th class="num" data-sort title="FantasyPros overall rank among all players">FP ECR</th><th class="num" data-sort>Score</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="rank num" data-v="${r.rank}">${r.rank}</td>
        <td><a href="#/rookie/${esc(r.slug)}"><b>${esc(r.name)}</b></a><br><small>${posTag(r.pos)} <span class="muted">${r.pos}${r.posRank}</span></small></td>
        <td>${esc(r.college || '—')}</td><td class="num">${fmt(r.age)}</td><td class="num small">${height(r.height)}${r.weight ? ` · ${r.weight}` : ''}</td><td>${tierChip(r.tier)}</td>
        <td class="num" data-v="${r.sources.KTC?.value ?? -1}">${r.sources.KTC ? `${r.sources.KTC.value.toLocaleString()} <span class="muted small">#${r.sources.KTC.rank}</span>` : '—'}</td>
        <td class="num" data-v="${r.sources.DP?.ecr ?? 9999}">${r.sources.DP?.ecr ? Math.round(r.sources.DP.ecr) : '—'}</td>
        <td class="num" data-v="${r.score}"><span style="display:inline-block;width:60px;height:8px;border-radius:4px;background:var(--surface-2);vertical-align:middle;margin-right:6px;overflow:hidden"><span style="display:block;height:100%;width:${r.score}%;background:${POS4[r.pos]}"></span></span>${fmt(r.score, 0)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Score = each source's value scaled to its #1 rookie (=100), averaged. FP ECR = FantasyPros overall rank via DynastyProcess.</p>`, { span: 12 })}
  </div>`;
  sortableTable(document.getElementById('bb'));
  const top = d.board.slice(0, 36);
  columns(document.getElementById('c-curve'), { data: top.map((r) => ({ x: r.rank, y: r.score, color: POS4[r.pos], r })), height: 220, yFmt: (v) => fmt(v, 0),
    tipFn: (x) => `<b>#${x.r.rank} ${esc(x.r.name)}</b>${x.r.pos}${x.r.posRank} · ${esc(x.r.college || '')} · ${esc(x.r.tier)}<br>Score ${fmt(x.r.score, 0)}` });
  stackedHbars(document.getElementById('c-tiers'), {
    rows: tiers.map((t) => ({ label: t, parts: Object.fromEntries(Object.keys(POS4).map((p) => [p, d.board.filter((r) => r.tier === t && r.pos === p).length])) })).filter((r) => Object.values(r.parts).some(Boolean)),
    keys: Object.keys(POS4), colors: POS4, fmt: (v) => Math.round(v), labelW: 60, rowH: 30,
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

// ---------- router ----------
const views = { '': viewDashboard, power: viewPower, history: viewHistory, team: viewTeam, waivers: viewWaivers, analyzer: viewAnalyzer, trades: viewTrades, rookies: viewRookies, rookie: viewRookie, metrics: viewMetrics, news: viewNews, player: viewPlayer };

async function route() {
  const [path, qs = ''] = location.hash.replace(/^#/, '').split('?');
  const [, name = '', arg] = path.split('/');
  routeQuery = new URLSearchParams(qs);
  if (siteConfig.leagueId && session && session.leagueId !== siteConfig.leagueId) { store.del('fh.session'); session = null; }
  if (!session?.leagueId || name === 'connect') return viewConnect();
  const $ = renderShell(views[name] ? (name === 'rookie' ? 'rookies' : name) : '');
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
