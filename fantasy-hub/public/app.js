// Fantasy Hub front end: hash-routed views over the /api endpoints.
const $app = document.getElementById('app');
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
let session = store.get('fh.session'); // { userId, username, leagueId, leagueName }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const ago = (t) => {
  if (!t) return '';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

async function api(path, opts) {
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const L = (p) => `/league/${session.leagueId}${p}`;

const pname = (p) => `<a href="#/player/${esc(p.id)}">${esc(p.name)}</a>${p.injury ? `<span class="inj" title="${esc(p.injury)}">${esc(p.injury[0])}</span>` : ''}`;
const ptag = (p) => `<span class="pos">${esc(p.pos)}</span> ${pname(p)} <span class="muted">${esc(p.team || '')}</span>`;
const trendCls = (x) => (x > 0.5 ? 'up' : x < -0.5 ? 'down' : '');

function sortableTable(el) {
  el.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const tbody = el.querySelector('tbody');
    const idx = [...th.parentNode.children].indexOf(th);
    const dir = th.dataset.dir === 'desc' ? 1 : -1;
    th.dataset.dir = dir === 1 ? 'asc' : 'desc';
    const val = (tr) => { const t = tr.children[idx].dataset.v ?? tr.children[idx].textContent; const n = parseFloat(t); return Number.isNaN(n) ? t : n; };
    [...tbody.rows].sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; }).forEach((r) => tbody.appendChild(r));
  }));
}

// ---------- views ----------

async function viewConnect() {
  $app.innerHTML = `
    <div class="card connect">
      <h1>Connect your Sleeper league</h1>
      <p class="sub">Enter your Sleeper username. No password or API key is needed: Sleeper's league data is public and read-only.</p>
      <form id="f" class="row"><input id="u" placeholder="Sleeper username" autocomplete="username" value="${esc(session?.username || '')}" required><button class="primary">Find leagues</button></form>
      <div id="out"></div>
    </div>`;
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = document.getElementById('out');
    out.innerHTML = '<p class="muted">Looking up leagues…</p>';
    try {
      const d = await api(`/user/${encodeURIComponent(document.getElementById('u').value.trim())}/leagues`);
      if (!d.leagues.length) { out.innerHTML = `<p class="err">No ${esc(d.season)} NFL leagues found for ${esc(d.user.name)}.</p>`; return; }
      out.innerHTML = `<div class="leagues"><h3>${esc(d.season)} leagues for ${esc(d.user.name)}</h3>${d.leagues.map((l) =>
        `<button data-id="${esc(l.id)}" data-name="${esc(l.name)}"><b>${esc(l.name)}</b> <span class="muted">· ${l.teams} teams · ${esc(l.status)}</span></button>`).join('')}</div>`;
      out.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        session = { userId: d.user.id, username: d.user.name, leagueId: b.dataset.id, leagueName: b.dataset.name };
        store.set('fh.session', session);
        location.hash = '#/';
        route();
      }));
    } catch (err) { out.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  });
}

async function viewDashboard() {
  const [lg, mu, tx, news, wv] = await Promise.all([
    api(L('')), api(L('/matchups')), api(L('/transactions')).catch(() => []),
    api('/news').catch(() => ({ items: [] })), api(L(`/waivers?owner=${session.userId}`)).catch(() => null),
  ]);
  const myRid = lg.teams.find((t) => t.ownerId === session.userId)?.rosterId;
  $app.innerHTML = `
    <h1>${esc(lg.name)}</h1>
    <p class="sub">${esc(lg.season)} · ${esc(lg.format)} · ${lg.currentWeek ? `Week ${lg.currentWeek}` : 'Season complete'}</p>
    <div class="grid">
      <section class="card"><h2>Standings</h2><div class="scroll"><table>
        <thead><tr><th>#</th><th>Team</th><th class="num">W-L</th><th class="num">PF</th><th class="num">PA</th></tr></thead>
        <tbody>${lg.teams.map((t, i) => `<tr class="${t.rosterId === myRid ? 'me' : ''}"><td>${i + 1}</td><td>${esc(t.name)}</td><td class="num">${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}</td><td class="num">${fmt(t.pf)}</td><td class="num">${fmt(t.pa)}</td></tr>`).join('')}</tbody>
      </table></div></section>
      <section class="card"><h2>Week ${mu.week} matchups</h2>
        ${mu.matchups.map(([a, b]) => b ? `<div class="matchup ${[a.rosterId, b.rosterId].includes(myRid) ? 'mine' : ''}">
          <div>${esc(a.name)}<div class="score">${fmt(a.points, 2)}</div><div class="muted">proj ${fmt(a.projected)}</div></div><div class="muted">vs</div>
          <div class="r">${esc(b.name)}<div class="score">${fmt(b.points, 2)}</div><div class="muted">proj ${fmt(b.projected)}</div></div></div>` : '').join('')}
      </section>
      <section class="card"><h2>Top waiver targets for you</h2>
        ${wv ? wv.recs.slice(0, 5).map((r) => `<div class="list-item">${ptag(r)} ${r.kind === 'upgrade' ? `<span class="chip good">+${fmt(r.gain)}/wk</span>` : '<span class="chip warn">stash</span>'}<ul class="reasons">${r.why.slice(0, 2).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`).join('') : '<p class="muted">Unavailable</p>'}
        <p><a href="#/waivers">All waiver advice →</a></p>
      </section>
      <section class="card"><h2>League activity</h2>
        ${tx.length ? tx.slice(0, 8).map((t) => `<div class="list-item"><span class="chip ${t.type === 'trade' ? 'warn' : 'good'}">${esc(t.type.replace('_', ' '))}</span> <span class="muted">${ago(t.at)}</span><br>
          ${t.adds.map((a) => `<span class="up">+</span> ${ptag(a)} → ${esc(a.to)}`).join('<br>')}${t.faab != null ? ` <span class="muted">($${t.faab})</span>` : ''}
          ${t.drops.length ? '<br>' + t.drops.map((d) => `<span class="down">−</span> ${ptag(d)}`).join('<br>') : ''}</div>`).join('') : '<p class="muted">No recent transactions.</p>'}
      </section>
      <section class="card wide"><h2>Latest news</h2>
        ${news.items.slice(0, 8).map((n) => `<div class="list-item"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">· ${esc(n.source)} · ${ago(n.published)}</span></div>`).join('') || '<p class="muted">No news loaded.</p>'}
        <p><a href="#/news">All news &amp; highlights →</a></p>
      </section>
    </div>`;
}

async function viewTeam() {
  const t = await api(L(`/team/${session.userId}`));
  const needRows = Object.entries(t.needs).sort((a, b) => b[1].rank - a[1].rank);
  $app.innerHTML = `
    <h1>${esc(t.team.name)}</h1>
    <p class="sub">${t.team.wins}-${t.team.losses} · Optimal lineup projects <b>${fmt(t.optimal.total)}</b> pts/wk (rest-of-season estimate)</p>
    <div class="grid">
      <section class="card"><h2>Optimal lineup</h2><div class="scroll"><table>
        <thead><tr><th>Slot</th><th>Player</th><th class="num">RoS</th><th class="num">Proj</th><th class="num">L3</th><th></th></tr></thead>
        <tbody>${t.optimal.lineup.map((s) => `<tr><td><span class="pos">${esc(s.slot.replace('_FLEX', '').replace('SUPER', 'SF'))}</span></td>
          <td>${s.player ? pname(s.player) + ` <span class="muted">${esc(s.player.pos)} ${esc(s.player.team)}</span>` : '<span class="muted">empty</span>'}</td>
          <td class="num">${fmt(s.player?.ros)}</td><td class="num">${fmt(s.player?.proj)}</td><td class="num">${fmt(s.player?.last3)}</td>
          <td>${s.player && !t.currentStarters.includes(s.player.id) ? '<span class="chip warn">not starting</span>' : ''}</td></tr>`).join('')}</tbody>
      </table></div></section>
      <section class="card"><h2>Positional strength vs league</h2>
        <p class="muted">Starting-lineup points by position, ranked against every team in the league.</p>
        <table><thead><tr><th>Pos</th><th class="num">You</th><th class="num">Lg avg</th><th class="num">Rank</th></tr></thead>
        <tbody>${needRows.map(([pos, n]) => `<tr><td><span class="pos">${esc(pos)}</span></td><td class="num">${fmt(n.pts)}</td><td class="num">${fmt(n.leagueAvg)}</td>
          <td class="num"><span class="chip ${n.rank <= n.of / 3 ? 'good' : n.rank > (2 * n.of) / 3 ? 'bad' : 'warn'}">${n.rank} / ${n.of}</span></td></tr>`).join('')}</tbody></table>
      </section>
      <section class="card wide"><h2>Bench</h2><div class="scroll"><table>
        <thead><tr><th>Player</th><th class="num">Pos rank</th><th class="num">RoS</th><th class="num">Season</th><th class="num">L3</th><th class="num">Value</th></tr></thead>
        <tbody>${t.bench.map((p) => `<tr><td>${ptag(p)}</td><td class="num">${esc(p.posRank || '—')}</td><td class="num">${fmt(p.ros)}</td><td class="num">${fmt(p.ppg)}</td><td class="num ${trendCls((p.last3 ?? 0) - (p.ppg ?? 0))}">${fmt(p.last3)}</td><td class="num">${p.value ?? '—'}</td></tr>`).join('')}</tbody>
      </table></div></section>
    </div>`;
}

async function viewWaivers() {
  const w = await api(L(`/waivers?owner=${session.userId}`));
  $app.innerHTML = `
    <h1>Waiver wire advice</h1>
    <p class="sub">Ranked by how much each free agent improves <i>your</i> best lineup, plus usage trends and Sleeper-wide add activity.
      ${w.drop ? `<br>If you need a roster spot, drop ${ptag(w.drop)}: losing them costs your lineup ${fmt(w.drop.loss)} pts/wk.` : ''}</p>
    <div class="grid">
      <section class="card wide"><h2>Recommended pickups</h2><div class="scroll"><table>
        <thead><tr><th>Player</th><th class="num">Lineup gain</th><th class="num">RoS</th><th class="num">L3</th><th class="num">Adds 48h</th><th>Why</th></tr></thead>
        <tbody>${w.recs.map((r) => `<tr><td>${ptag(r)}</td><td class="num">${r.kind === 'upgrade' ? `<span class="chip good">+${fmt(r.gain)}</span>` : '<span class="chip warn">stash</span>'}</td>
          <td class="num">${fmt(r.ros)}</td><td class="num">${fmt(r.last3)}</td><td class="num">${r.adds ? r.adds.toLocaleString() : '—'}</td>
          <td style="white-space:normal;min-width:260px"><ul class="reasons">${r.why.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></td></tr>`).join('')}</tbody>
      </table></div></section>
      <section class="card"><h2>Trending on Sleeper (available)</h2>
        ${w.trending.map((t) => `<div class="list-item">${ptag(t)} <span class="muted">· ${t.adds.toLocaleString()} adds</span></div>`).join('') || '<p class="muted">None available.</p>'}
      </section>
    </div>`;
}

async function viewTrades() {
  const [lg, sug] = await Promise.all([api(L('')), api(L(`/trades/suggest?owner=${session.userId}`))]);
  const others = lg.teams.filter((t) => t.ownerId !== session.userId);
  const weakest = Object.entries(sug.needs).sort((a, b) => b[1].rank - a[1].rank).slice(0, 2).map(([p, n]) => `${p} (${n.rank}/${n.of})`).join(', ');
  $app.innerHTML = `
    <h1>Trades</h1>
    <p class="sub">Your weakest starting positions: <b>${esc(weakest)}</b>. Suggestions only include deals that improve both lineups at roughly even trade value.</p>
    <div class="grid">
      <section class="card wide"><h2>Trade analyzer</h2>
        <div class="row"><label>Trade with <select id="partner">${others.map((t) => `<option value="${t.rosterId}">${esc(t.name)}</option>`).join('')}</select></label></div>
        <div class="trade" id="sides"></div>
        <div class="row" style="margin-top:12px"><button class="primary" id="eval">Evaluate trade</button></div>
        <div id="result"></div>
      </section>
      <section class="card wide"><h2>Suggested trades</h2>
        ${sug.suggestions.length ? `<div class="scroll"><table><thead><tr><th>Partner</th><th>You give</th><th>You get</th><th class="num">Your lineup</th><th class="num">Their lineup</th><th class="num">Value gap</th><th></th></tr></thead><tbody>
        ${sug.suggestions.map((s, i) => `<tr><td>${esc(s.owner)}</td><td>${s.give.map(ptag).join('<br>')}</td><td>${s.get.map(ptag).join('<br>')}</td>
          <td class="num up">+${fmt(s.myDelta)}</td><td class="num ${trendCls(s.theirDelta)}">${s.theirDelta >= 0 ? '+' : ''}${fmt(s.theirDelta)}</td><td class="num">${s.valueGap > 0 ? '+' : ''}${s.valueGap}</td>
          <td><button class="link" data-load="${i}">Load</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No win-win deals found right now.</p>'}
      </section>
    </div>`;

  const sel = { give: new Set(), get: new Set() };
  const sides = document.getElementById('sides');
  async function loadSides() {
    const partner = document.getElementById('partner').value;
    const [mine, theirs] = await Promise.all([api(L(`/roster/${session.userId}`)), api(L(`/roster/${partner}`))]);
    const list = (r, key) => `<div><h3>${esc(r.name)} ${key === 'give' ? 'gives' : 'gives you'}</h3>${r.players.map((p) =>
      `<label class="pick"><input type="checkbox" data-k="${key}" value="${esc(p.id)}" ${sel[key].has(p.id) ? 'checked' : ''}> ${ptag(p)} <span class="muted">· ${p.value ?? '—'}</span></label>`).join('')}</div>`;
    sides.innerHTML = list(mine, 'give') + list(theirs, 'get');
    sides.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => { i.checked ? sel[i.dataset.k].add(i.value) : sel[i.dataset.k].delete(i.value); }));
  }
  document.getElementById('partner').addEventListener('change', () => { sel.get.clear(); loadSides(); });
  document.getElementById('eval').addEventListener('click', async () => {
    const out = document.getElementById('result');
    try {
      const r = await api(L('/trades/evaluate'), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: session.userId, partner: document.getElementById('partner').value, give: [...sel.give], get: [...sel.get] }) });
      out.innerHTML = `<div class="verdict">${esc(r.verdict)}</div><div class="kpis">
        <div class="kpi"><b class="${trendCls(r.you.delta)}">${r.you.delta >= 0 ? '+' : ''}${fmt(r.you.delta)}</b><span>Your lineup pts/wk</span></div>
        <div class="kpi"><b class="${trendCls(r.them.delta)}">${r.them.delta >= 0 ? '+' : ''}${fmt(r.them.delta)}</b><span>Their lineup pts/wk</span></div>
        <div class="kpi"><b>${r.you.value} → ${r.you.receive}</b><span>Trade value out → in</span></div>
        <div class="kpi"><b class="${trendCls(r.fairness)}">${r.fairness > 0 ? '+' : ''}${r.fairness}%</b><span>Value edge</span></div></div>
        ${r.winWin ? '<span class="chip good">Win-win: easier to get accepted</span>' : ''}`;
    } catch (err) { out.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  });
  $app.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', async () => {
    const s = sug.suggestions[b.dataset.load];
    document.getElementById('partner').value = s.rosterId;
    sel.give = new Set(s.give.map((p) => p.id)); sel.get = new Set(s.get.map((p) => p.id));
    await loadSides();
    document.getElementById('eval').click();
    sides.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  await loadSides();
}

async function viewMetrics(pos = 'WR') {
  const d = await api(L(`/metrics?pos=${pos}`));
  const recv = ['WR', 'TE', 'RB'].includes(pos);
  $app.innerHTML = `
    <h1>Advanced metrics</h1>
    <p class="sub">Usage and efficiency over ${d.completedWeeks} completed weeks, scored with your league's settings. Click a column to sort.</p>
    <div class="row" style="margin-bottom:12px">${['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => `<button class="${p === pos ? 'primary' : ''}" data-pos="${p}">${p}</button>`).join('')}</div>
    <section class="card"><div class="scroll"><table id="mt">
      <thead><tr><th data-sort>Player</th><th data-sort>Owner</th><th class="num" data-sort>G</th><th class="num" data-sort>PPG</th><th class="num" data-sort>L3</th><th class="num" data-sort>RoS</th><th class="num" data-sort>Snap%</th><th class="num" data-sort>Snap% L3</th>
        ${recv ? '<th class="num" data-sort>Tgt%</th><th class="num" data-sort>Air%</th><th class="num" data-sort>WOPR</th><th class="num" data-sort>aDOT</th><th class="num" data-sort>Y/Tgt</th>' : ''}
        ${pos === 'RB' ? '<th class="num" data-sort>Touch/G</th><th class="num" data-sort>YPC</th>' : ''}
        <th class="num" data-sort>RZ opp</th><th class="num" data-sort>StDev</th></tr></thead>
      <tbody>${d.rows.map((r) => `<tr><td>${pname(r)} <span class="muted">${esc(r.team)}</span></td><td>${r.owner ? esc(r.owner) : '<span class="chip good">FA</span>'}</td>
        <td class="num">${r.games}</td><td class="num">${fmt(r.ppg)}</td><td class="num ${trendCls(r.trend)}">${fmt(r.last3)}</td><td class="num">${fmt(r.ros)}</td>
        <td class="num" data-v="${r.snapShare ?? -1}">${pct(r.snapShare)}</td><td class="num" data-v="${r.snapShareL3 ?? -1}">${pct(r.snapShareL3)}</td>
        ${recv ? `<td class="num" data-v="${r.tgtShare ?? -1}">${pct(r.tgtShare)}</td><td class="num" data-v="${r.airShare ?? -1}">${pct(r.airShare)}</td><td class="num">${fmt(r.wopr, 2)}</td><td class="num">${fmt(r.adot)}</td><td class="num">${fmt(r.ypt)}</td>` : ''}
        ${pos === 'RB' ? `<td class="num">${fmt(r.touchesPg)}</td><td class="num">${fmt(r.ypc)}</td>` : ''}
        <td class="num">${r.rzOpps}</td><td class="num">${fmt(r.stdev)}</td></tr>`).join('')}</tbody></table></div></section>
    <p class="muted" style="font-size:13px">WOPR = 1.5 × target share + 0.7 × air-yards share. Team shares use each player's current team. RoS blends season, last-3 and next-week projection.</p>`;
  $app.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/metrics/${b.dataset.pos}`; }));
  sortableTable(document.getElementById('mt'));
}

async function viewNews() {
  const [n, h] = await Promise.all([api('/news'), api('/highlights').catch(() => ({ items: [], status: [] }))]);
  const status = (s) => s.filter((x) => !x.ok).map((x) => x.source);
  const card = (i) => `<a class="item" href="${esc(i.link)}" target="_blank" rel="noopener">
    ${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    <div class="body"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.source)} · ${ago(i.published)}</div>${i.summary ? `<div class="summary">${esc(i.summary.slice(0, 160))}</div>` : ''}</div></a>`;
  $app.innerHTML = `
    <h1>News &amp; highlights</h1>
    <p class="sub">${n.status.filter((s) => s.ok).length}/${n.status.length} news sources loaded${status(n.status).length ? ` (unavailable: ${esc(status(n.status).join(', '))})` : ''}. Add feeds in <code>config.js</code>.</p>
    <div class="row" style="margin-bottom:14px"><input id="q" placeholder="Filter by player name…" style="flex:1;max-width:360px"></div>
    <h2>Highlights</h2><div class="news" id="hl">${h.items.slice(0, 6).map(card).join('') || '<p class="muted">No highlights loaded.</p>'}</div>
    <h2 style="margin-top:24px">Articles</h2><div class="news" id="art">${n.items.slice(0, 60).map(card).join('')}</div>`;
  document.getElementById('q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const f = (items) => items.filter((i) => !q || (i.title + ' ' + i.summary).toLowerCase().includes(q));
    document.getElementById('art').innerHTML = f(n.items).slice(0, 60).map(card).join('') || '<p class="muted">No matches.</p>';
    document.getElementById('hl').innerHTML = f(h.items).slice(0, 6).map(card).join('') || '<p class="muted">No matches.</p>';
  });
}

function weeklyChart(log) {
  // Single-series bar chart: one hue, baseline-anchored bars with rounded data ends, hover tooltip per bar.
  const W = 1100, H = 240, padL = 34, padB = 22, padT = 10;
  const max = Math.max(10, ...log.map((g) => g.pts));
  const step = Math.ceil(max / 4 / 5) * 5;
  const top = step * 4;
  const bw = (W - padL) / Math.max(log.length, 1);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const grid = [0, 1, 2, 3, 4].map((i) => `<line class="axis" x1="${padL}" x2="${W}" y1="${y(i * step)}" y2="${y(i * step)}" stroke-width="${i ? 0.5 : 1}"/><text x="${padL - 6}" y="${y(i * step) + 4}" text-anchor="end">${i * step}</text>`).join('');
  const bars = log.map((g, i) => {
    const x = padL + i * bw + bw * 0.2, w = bw * 0.6, h = Math.max(0, y(0) - y(Math.max(g.pts, 0))), r = Math.min(4, w / 2, h);
    const top = y(0) - h;
    const path = h > 0 ? `M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${y(0)} Z` : '';
    return `<g data-tip="Week ${g.week}: ${fmt(g.pts)} pts${g.snapPct != null ? ` · ${pct(g.snapPct)} snaps` : ''}${g.tgt ? ` · ${g.tgt} tgt` : ''}${g.att ? ` · ${g.att} att` : ''}">
      <rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/>
      ${path ? `<path d="${path}" fill="var(--bar)"/>` : ''}<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${g.week}</text></g>`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fantasy points by week">${grid}${bars}</svg></div>`;
}

function attachTips(root) {
  let tip;
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      tip ||= Object.assign(document.createElement('div'), { className: 'tip' });
      if (!tip.isConnected) document.body.appendChild(tip);
      tip.textContent = el.dataset.tip;
      tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 28}px`;
    });
    el.addEventListener('mouseleave', () => tip?.remove());
  });
}

async function viewPlayer(id) {
  const d = await api(L(`/player/${id}`));
  const p = d.player, m = d.metrics || {};
  const notes = (title, list, cls) => list.length ? `<h3>${title}</h3><ul class="reasons">${list.map((x) => `<li class="${cls}">${esc(x)}</li>`).join('')}</ul>` : '';
  const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${p.name} highlights`)}`;
  $app.innerHTML = `
    <p><a href="javascript:history.back()">← Back</a></p>
    <h1>${esc(p.name)} ${p.injury ? `<span class="chip bad">${esc(p.injury)}</span>` : ''}</h1>
    <p class="sub"><span class="pos">${esc(p.pos)}</span> ${esc(p.team)}${p.number ? ` #${esc(p.number)}` : ''} · Age ${esc(p.age ?? '—')} · ${esc(p.exp ?? 0)} yrs exp${p.college ? ` · ${esc(p.college)}` : ''}
      · ${d.owner ? `Rostered by <b>${esc(d.owner.name)}</b>` : '<span class="chip good">Free agent</span>'}</p>
    <div class="kpis">
      <div class="kpi"><b>${d.rank ? `${esc(p.pos)}${d.rank.rank}` : '—'}</b><span>Position rank (RoS)</span></div>
      <div class="kpi"><b>${fmt(m.ppg)}</b><span>PPG (${m.games ?? 0} g)</span></div>
      <div class="kpi"><b class="${trendCls(m.trend)}">${fmt(m.last3)}</b><span>Last 3 PPG</span></div>
      <div class="kpi"><b>${fmt(m.proj)}</b><span>This week proj</span></div>
      <div class="kpi"><b>${d.value?.value ?? '—'}</b><span>Trade value${d.value?.trend30 ? ` (${d.value.trend30 > 0 ? '+' : ''}${d.value.trend30} 30d)` : ''}</span></div>
    </div>
    <div class="grid">
      <section class="card"><h2>Scouting report</h2>
        ${notes('Outlook', d.report.outlook, '')}${notes('Strengths', d.report.strengths, 'up')}${notes('Concerns', d.report.concerns, 'down')}
      </section>
      <section class="card"><h2>Usage profile</h2><table><tbody>
        <tr><td>Snap share (season / L3)</td><td class="num">${pct(m.snapShare)} / ${pct(m.snapShareL3)}</td></tr>
        <tr><td>Target share (season / L3)</td><td class="num">${pct(m.tgtShare)} / ${pct(m.tgtShareL3)}</td></tr>
        <tr><td>Air-yards share · WOPR</td><td class="num">${pct(m.airShare)} · ${fmt(m.wopr, 2)}</td></tr>
        <tr><td>Targets / game · aDOT</td><td class="num">${fmt(m.tgtPg)} · ${fmt(m.adot)}</td></tr>
        <tr><td>Touches / game · YPC</td><td class="num">${fmt(m.touchesPg)} · ${fmt(m.ypc)}</td></tr>
        <tr><td>Catch rate · Yds / target</td><td class="num">${pct(m.catchRate)} · ${fmt(m.ypt)}</td></tr>
        <tr><td>Red-zone opportunities · TDs</td><td class="num">${m.rzOpps ?? '—'} · ${m.tds ?? '—'}</td></tr>
        <tr><td>Floor / ceiling / st. dev</td><td class="num">${fmt(m.floor)} / ${fmt(m.ceiling)} / ${fmt(m.stdev)}</td></tr>
      </tbody></table></section>
      <section class="card wide"><h2>Fantasy points by week</h2>${m.log?.length ? weeklyChart(m.log) : '<p class="muted">No games yet.</p>'}
        ${m.log?.length ? `<details><summary class="muted">Game log table</summary><div class="scroll"><table><thead><tr><th>Wk</th><th class="num">Pts</th><th class="num">Snap%</th><th class="num">Tgt</th><th class="num">Rec</th><th class="num">Rec yd</th><th class="num">Att</th><th class="num">Rush yd</th><th class="num">Pass yd</th><th class="num">TD</th></tr></thead>
        <tbody>${m.log.map((g) => `<tr><td>${g.week}</td><td class="num">${fmt(g.pts)}</td><td class="num">${pct(g.snapPct)}</td><td class="num">${g.tgt}</td><td class="num">${g.rec}</td><td class="num">${g.recYd}</td><td class="num">${g.att}</td><td class="num">${g.rushYd}</td><td class="num">${g.passYd}</td><td class="num">${g.td}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      </section>
      <section class="card"><h2>News</h2>${d.news.map((n) => `<div class="list-item"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="muted" style="font-size:12px">${esc(n.source)} · ${ago(n.published)}</div></div>`).join('') || '<p class="muted">No recent headlines mention this player.</p>'}</section>
      <section class="card"><h2>Highlights</h2>${d.highlights.map((n) => `<div class="list-item"><a href="${esc(n.link)}" target="_blank" rel="noopener">▶ ${esc(n.title)}</a></div>`).join('') || '<p class="muted">No recent highlight videos.</p>'}
        <p><a href="${ytSearch}" target="_blank" rel="noopener">Search YouTube for ${esc(p.name)} highlights →</a></p></section>
    </div>`;
  attachTips($app);
}

// ---------- router ----------
const views = { '': viewDashboard, team: viewTeam, waivers: viewWaivers, trades: viewTrades, metrics: viewMetrics, news: viewNews, player: viewPlayer };

async function route() {
  const [, name = '', arg] = location.hash.replace(/^#/, '').split('/');
  const nav = document.getElementById('nav');
  const who = document.getElementById('who');
  if (!session?.leagueId || name === 'connect') {
    nav.hidden = true; who.innerHTML = '';
    return viewConnect();
  }
  nav.hidden = false;
  who.innerHTML = `${esc(session.username)} · ${esc(session.leagueName)} <button class="link" id="switch">switch</button>`;
  document.getElementById('switch').onclick = () => { store.del('fh.session'); session = null; location.hash = '#/connect'; };
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${name}`));
  $app.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await (views[name] || viewDashboard)(arg ? decodeURIComponent(arg) : undefined);
  } catch (err) {
    $app.innerHTML = `<div class="card"><p class="err">${esc(err.message)}</p><p><a href="#/connect">Reconnect your league</a></p></div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
