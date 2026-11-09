// Shared helpers for every dashboard page.
const PAGES = [
  ["/", "Top Movers"], ["/valuation", "Valuation"], ["/technical", "Technicals"],
  ["/picks", "Daily Picks"], ["/performance", "Track Record"],
];

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k === null || k === undefined) continue;
    n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return n;
}

const fmt = {
  num(v, d = 2) { return v === null || v === undefined || isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); },
  money(v) { return v === null || v === undefined ? "—" : "$" + fmt.num(v, 2); },
  pct(v, d = 1, alreadyPct = false) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    const p = alreadyPct ? v : v * 100;
    return (p > 0 ? "+" : "") + p.toFixed(d) + "%";
  },
  big(v) {
    if (v === null || v === undefined) return "—";
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + "T";
    if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return fmt.num(v, 0);
  },
  time(iso) { return iso ? new Date(iso).toLocaleString() : "—"; },
};

function signed(v, text) {
  return el("span", { class: v > 0 ? "up" : v < 0 ? "down" : "" }, text);
}

function symCell(sym, name) {
  return el("td", { class: "left" }, el("span", { class: "sym" }, sym), name ? el("span", { class: "name", title: name }, name) : null);
}

// Sortable table. columns: [{key, label, render(row) -> Node|string, value(row) -> sortable, cls}]
function table(columns, rows, { sortKey, sortDesc = true, empty = "No results" } = {}) {
  const wrap = el("div");
  let key = sortKey, desc = sortDesc;
  function draw() {
    wrap.replaceChildren();
    if (!rows.length) { wrap.append(el("div", { class: "empty" }, empty)); return; }
    const col = columns.find(c => c.key === key);
    const sorted = col && col.value ? [...rows].sort((a, b) => {
      const x = col.value(a), y = col.value(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    }) : rows;
    const head = el("tr", {}, columns.map(c => el("th", {
      class: (c.cls || "") + (c.value ? "" : " nosort"),
      onclick: () => { if (!c.value) return; if (key === c.key) desc = !desc; else { key = c.key; desc = true; } draw(); },
    }, c.label + (c.key === key ? (desc ? " ▾" : " ▴") : ""))));
    const body = sorted.map(r => el("tr", {}, columns.map(c => {
      const v = c.render ? c.render(r) : r[c.key];
      return v instanceof HTMLTableCellElement ? v : el("td", { class: c.cls || "" }, v);
    })));
    wrap.append(el("table", {}, el("thead", {}, head), el("tbody", {}, body)));
  }
  draw();
  return wrap;
}

function sectorSelect(rows, onChange) {
  const sectors = [...new Set(rows.map(r => r.sector).filter(Boolean))].sort();
  const s = el("select", { onchange: () => onChange(s.value) },
    el("option", { value: "" }, "All sectors"), sectors.map(x => el("option", { value: x }, x)));
  return s;
}

async function initPage() {
  const header = el("header", { class: "top" }, el("div", { class: "top-inner" },
    el("span", { class: "brand" }, "NYSE Dashboard"),
    el("nav", {}, PAGES.map(([href, label]) => el("a", { href, class: location.pathname === href ? "active" : "" }, label))),
    el("span", { class: "session", id: "session" }, "…"),
  ));
  document.body.prepend(header);
  document.body.append(el("footer", {},
    "For research and education only — not investment advice. Models are simple screens on public data that can be delayed, incomplete or wrong. ",
    "Short selling carries unlimited risk. Do your own due diligence."));
  try {
    const st = await api("/api/status");
    document.getElementById("session").replaceChildren(
      el("span", { class: "dot " + (st.session === "open" ? "open" : "") }),
      `Market ${st.session} · ${new Date(st.now_et).toLocaleTimeString([], { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET · data: ${st.provider}`);
    if (st.demo) header.after(el("div", { class: "banner" }, "DEMO DATA — synthetic tickers and prices. Set DATA_PROVIDER=yahoo for live NYSE data."));
    return st;
  } catch (e) {
    document.getElementById("session").textContent = "API unreachable";
  }
}

// Poll a snapshot endpoint until the background job has produced data.
async function loadSnapshot(path, target, render) {
  try {
    const data = await api(path);
    if (data.pending) {
      target.replaceChildren(el("div", { class: "empty" },
        data.job && data.job.last_error ? `Scan failed: ${data.job.last_error}` : "Scanning the NYSE universe… this takes a minute on first run."));
      setTimeout(() => loadSnapshot(path, target, render), 5000);
      return;
    }
    render(data);
  } catch (e) {
    target.replaceChildren(el("div", { class: "empty" }, "Error: " + e.message));
  }
}
