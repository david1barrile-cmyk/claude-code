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

const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const sign = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${fmt(x, d)}`);
const k = (v) => (v == null ? '—' : v >= 10000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString());
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
  trades: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  metrics: '<path d="M3 3v18h18M7 15l4-4 3 3 6-6"/>',
  news: '<path d="M4 5h13v14H5a1 1 0 0 1-1-1zM17 9h3v9a1 1 0 0 1-1 1h-2M7 9h7M7 13h7M7 16h4"/>',
};
const NAV = [['', 'Dashboard'], ['power', 'Power Rankings'], ['history', 'League History'], ['team', 'My Team'], ['waivers', 'Waivers'], ['trades', 'Trades'], ['metrics', 'Metrics'], ['news', 'News & Highlights']];

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

  $.innerHTML = `${head('Power Rankings', `Two views of the league. <b>This season</b> blends record (25%), all-play record (35%) and current lineup strength (40%). <b>Dynasty</b> totals roster and draft-pick trade value (${esc(d.dynasty.source)}; picks ${esc(d.dynasty.pickSource.toLowerCase())}) and projects it 1–3 years out with position-specific age curves.`)}
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

// ---------- trades ----------
async function viewTrades($) {
  const [lg, sug] = await Promise.all([api(L()), api(L(`/trades/suggest?owner=${session.userId}`))]);
  const others = lg.teams.filter((t) => t.ownerId !== session.userId);
  const weakest = Object.entries(sug.needs).filter(([p]) => !['K', 'DEF'].includes(p)).sort((a, b) => b[1].rank - a[1].rank).slice(0, 2);
  $.innerHTML = `${head('Trades', `Your weakest starting spots: ${weakest.map(([p, n]) => `${posTag(p)} <b>${ordinal(n.rank)}</b> of ${n.of}`).join(' · ')}. Suggestions only include deals that improve <b>both</b> lineups at roughly even trade value.`)}
  <div class="grid">
    ${card('Trade analyzer', `<div class="row"><label>Trade with <select id="partner">${others.map((t) => `<option value="${t.rosterId}">${esc(t.name)}</option>`).join('')}</select></label></div>
      <div class="trade" id="sides" style="margin-top:12px"></div>
      <div class="row" style="margin-top:14px"><button class="primary" id="eval">Evaluate trade</button></div>
      <div id="result"></div>`, { span: 12 })}
    ${card('Suggested win-win trades', sug.suggestions.length ? `<div class="scroll"><table><thead><tr><th>Partner</th><th>You give</th><th>You get</th><th class="num">Your lineup</th><th class="num">Their lineup</th><th class="num">Value gap</th><th></th></tr></thead><tbody>
      ${sug.suggestions.map((s, i) => `<tr><td>${esc(s.owner)}</td><td>${s.give.map(ptag).join('<br>')}</td><td>${s.get.map(ptag).join('<br>')}</td>
        <td class="num up"><b>+${fmt(s.myDelta)}</b></td><td class="num ${trendCls(s.theirDelta)}">${sign(s.theirDelta)}</td><td class="num">${s.valueGap > 0 ? '+' : ''}${s.valueGap}</td>
        <td><button data-load="${i}">Load</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No win-win deals found right now.</p>', { span: 12 })}
  </div>`;

  const sel = { give: new Set(), get: new Set() };
  const sides = document.getElementById('sides');
  async function loadSides() {
    const partner = document.getElementById('partner').value;
    const [mine, theirs] = await Promise.all([api(L(`/roster/${session.userId}`)), api(L(`/roster/${partner}`))]);
    const list = (r, key) => `<div><h3>${key === 'give' ? 'You send' : `${esc(r.name)} sends`}</h3>${r.players.map((p) =>
      `<label class="pick"><input type="checkbox" data-k="${key}" value="${esc(p.id)}" ${sel[key].has(p.id) ? 'checked' : ''}> ${ptag(p)} <span class="muted small" style="margin-left:auto">${k(p.value)}</span></label>`).join('')}</div>`;
    sides.innerHTML = list(mine, 'give') + list(theirs, 'get');
    sides.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => { i.checked ? sel[i.dataset.k].add(i.value) : sel[i.dataset.k].delete(i.value); }));
  }
  document.getElementById('partner').addEventListener('change', () => { sel.get.clear(); loadSides(); });
  document.getElementById('eval').addEventListener('click', async () => {
    const out = document.getElementById('result');
    try {
      const r = await api(L('/trades/evaluate'), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: session.userId, partner: document.getElementById('partner').value, give: [...sel.give], get: [...sel.get] }) });
      const tot = Math.max(r.you.value + r.you.receive, 1);
      out.innerHTML = `<div class="verdict">${esc(r.verdict)}</div><div class="kpis">
        <div class="kpi"><b class="${trendCls(r.you.delta)}">${sign(r.you.delta)}</b><span>Your lineup pts/wk</span></div>
        <div class="kpi"><b class="${trendCls(r.them.delta)}">${sign(r.them.delta)}</b><span>Their lineup pts/wk</span></div>
        <div class="kpi"><b class="${trendCls(r.fairness)}">${r.fairness > 0 ? '+' : ''}${r.fairness}%</b><span>Trade value edge</span></div></div>
        <h3>Trade value</h3><div class="prob" style="margin-top:4px"><div class="bar" style="height:14px"><i style="width:${(r.you.value / tot) * 100}%;background:var(--series-ref)"></i><i style="width:${(r.you.receive / tot) * 100}%;background:var(--series-me)"></i></div>
        <div class="lbl"><span>You send <b>${k(r.you.value)}</b></span><span>You receive <b>${k(r.you.receive)}</b></span></div></div>
        ${r.winWin ? '<p><span class="chip good">✓ Win-win: easier to get accepted</span></p>' : ''}`;
    } catch (err) { out.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  });
  $.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', async () => {
    const s = sug.suggestions[b.dataset.load];
    document.getElementById('partner').value = s.rosterId;
    sel.give = new Set(s.give.map((p) => p.id)); sel.get = new Set(s.get.map((p) => p.id));
    await loadSides();
    document.getElementById('eval').click();
    sides.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  await loadSides();
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
        ${recv ? '<th class="num" data-sort>Tgt%</th><th class="num" data-sort>Air%</th><th class="num" data-sort>WOPR</th><th class="num" data-sort>aDOT</th><th class="num" data-sort>Y/Tgt</th>' : ''}
        ${pos === 'RB' ? '<th class="num" data-sort>Touch/G</th><th class="num" data-sort>YPC</th>' : ''}
        <th class="num" data-sort>RZ opp</th><th class="num" data-sort>StDev</th></tr></thead>
      <tbody>${d.rows.map((r) => `<tr class="${r.owner === session.teamName ? 'me' : ''}"><td>${ptag(r)}</td><td>${r.owner ? esc(r.owner) : '<span class="chip good">FA</span>'}</td>
        <td class="num">${r.games}</td><td class="num">${fmt(r.ppg)}</td><td class="num ${trendCls(r.trend)}">${fmt(r.last3)}</td><td class="num"><b>${fmt(r.ros)}</b></td>
        <td class="num" data-v="${r.snapShare ?? -1}">${pct(r.snapShare)}</td><td class="num" data-v="${r.snapShareL3 ?? -1}">${pct(r.snapShareL3)}</td>
        ${recv ? `<td class="num" data-v="${r.tgtShare ?? -1}">${pct(r.tgtShare)}</td><td class="num" data-v="${r.airShare ?? -1}">${pct(r.airShare)}</td><td class="num">${fmt(r.wopr, 2)}</td><td class="num">${fmt(r.adot)}</td><td class="num">${fmt(r.ypt)}</td>` : ''}
        ${pos === 'RB' ? `<td class="num">${fmt(r.touchesPg)}</td><td class="num">${fmt(r.ypc)}</td>` : ''}
        <td class="num">${r.rzOpps}</td><td class="num">${fmt(r.stdev)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">WOPR = 1.5 × target share + 0.7 × air-yards share. Team shares use each player's current team. RoS blends season, last-3 and next-week projection.</p>`, { span: 12 })}
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
      <tr><td>Air-yards share · WOPR</td><td class="num">${pct(m.airShare)} · ${fmt(m.wopr, 2)}</td></tr>
      <tr><td>Targets / game · aDOT</td><td class="num">${fmt(m.tgtPg)} · ${fmt(m.adot)}</td></tr>
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
const views = { '': viewDashboard, power: viewPower, history: viewHistory, team: viewTeam, waivers: viewWaivers, trades: viewTrades, metrics: viewMetrics, news: viewNews, player: viewPlayer };

async function route() {
  const [, name = '', arg] = location.hash.replace(/^#/, '').split('/');
  if (siteConfig.leagueId && session && session.leagueId !== siteConfig.leagueId) { store.del('fh.session'); session = null; }
  if (!session?.leagueId || name === 'connect') return viewConnect();
  const $ = renderShell(views[name] ? name : '');
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
