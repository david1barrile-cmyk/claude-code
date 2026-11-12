// Small SVG chart kit. Each chart renders at its container's real pixel width
// (so text is never scaled), re-renders on resize, and exposes per-mark hover
// tooltips. Colors are CSS variables so light/dark themes switch automatically.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = (x) => Math.round(x * 10) / 10;

// ---------- tooltip (shared) ----------
let tipEl;
function tip(html, e) {
  tipEl ||= Object.assign(document.createElement('div'), { className: 'tip', role: 'tooltip' });
  if (!tipEl.isConnected) document.body.appendChild(tipEl);
  tipEl.innerHTML = html;
  const pad = 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = e.clientX + pad, y = e.clientY - h - 8;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y < 8) y = e.clientY + pad;
  tipEl.style.left = `${x}px`; tipEl.style.top = `${y}px`;
}
const hideTip = () => tipEl?.remove();
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (t) tip(t.dataset.tip, e); else hideTip();
});
document.addEventListener('scroll', hideTip, { passive: true });

// ---------- mounting ----------
const observers = new WeakMap();
export function mount(el, draw) {
  if (!el) return;
  el.classList.add('chart');
  const render = () => {
    const w = Math.max(240, Math.floor(el.clientWidth));
    if (el._w === w) return;
    el._w = w;
    el.innerHTML = draw(w);
    el._after?.(el);
  };
  render();
  if (!observers.has(el)) {
    const ro = new ResizeObserver(() => render());
    ro.observe(el);
    observers.set(el, ro);
  }
}

function niceMax(v, ticks = 4) {
  if (v <= 0) return 1;
  const raw = v / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { max: step * ticks, step };
}
const fmtK = (v) => (Math.abs(v) >= 10000 ? `${r1(v / 1000)}k` : `${Math.round(v)}`);

export function legend(items) {
  return `<div class="legend">${items.map((i) => `<span><i class="${i.line ? 'line' : ''} ${i.dashed ? 'dash' : ''}" style="background:${i.color}"></i>${esc(i.label)}</span>`).join('')}</div>`;
}

// Rounded-top bar path anchored to the baseline.
function barPath(x, y0, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  const t = y0 - h;
  return `M${x},${y0}V${t + r}Q${x},${t} ${x + r},${t}H${x + w - r}Q${x + w},${t} ${x + w},${t + r}V${y0}Z`;
}
// Rounded-right horizontal bar.
function hbarPath(x0, y, w, h, r = 4) {
  if (w <= 0) return '';
  r = Math.min(r, h / 2, w);
  const e = x0 + w;
  return `M${x0},${y}H${e - r}Q${e},${y} ${e},${y + r}V${y + h - r}Q${e},${y + h} ${e - r},${y + h}H${x0}Z`;
}

// ---------- vertical bars (single series) ----------
export function columns(el, { data, height = 220, color = 'var(--series-me)', tipFn, yFmt = fmtK }) {
  mount(el, (W) => {
    const padL = 34, padB = 22, padT = 8;
    const { max, step } = niceMax(Math.max(...data.map((d) => d.y), 1));
    const H = height, ih = H - padT - padB, bw = (W - padL) / Math.max(data.length, 1);
    const y = (v) => padT + ih * (1 - v / max);
    let g = '<g class="grid">';
    for (let v = 0; v <= max + 1e-9; v += step) g += `<line class="${v ? '' : 'base'}" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${yFmt(v)}</text>`;
    g += '</g>';
    const bars = data.map((d, i) => {
      const w = Math.min(36, bw * 0.62), x = padL + i * bw + (bw - w) / 2;
      return `<g><path d="${barPath(x, y(0), w, y(0) - y(Math.max(0, d.y)))}" fill="${d.color || color}"/>
        <text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(d.x)}</text>
        <rect class="hit" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${ih}" data-tip="${esc(tipFn ? tipFn(d) : `${esc(d.x)}: ${esc(d.y)}`)}"/></g>`;
    }).join('');
    return `<svg width="${W}" height="${H}" role="img">${g}${bars}</svg>`;
  });
}

// ---------- line chart with crosshair ----------
export function lines(el, { series, xs, height = 240, yFmt = fmtK, xFmt = (x) => x, xLabel = '' }) {
  el._after = (root) => {
    const svg = root.querySelector('svg');
    const cross = svg.querySelector('.cross');
    svg.querySelectorAll('.col').forEach((c) => {
      c.addEventListener('mouseenter', () => { cross.setAttribute('x1', c.dataset.cx); cross.setAttribute('x2', c.dataset.cx); cross.style.display = ''; });
    });
    svg.addEventListener('mouseleave', () => { cross.style.display = 'none'; });
  };
  mount(el, (W) => {
    const padL = 38, padR = 70, padB = 26, padT = 10, H = height, ih = H - padT - padB;
    const all = series.flatMap((s) => s.values.map((v) => v.y)).filter((v) => v != null);
    const lo = Math.min(...all), hi = Math.max(...all);
    const base = Math.max(0, Math.floor((lo - (hi - lo) * 0.15) / 10) * 10);
    const { max: span, step } = niceMax(hi - base);
    const top = base + span;
    const x = (i) => padL + (xs.length < 2 ? 0 : (i * (W - padL - padR)) / (xs.length - 1));
    const y = (v) => padT + ih * (1 - (v - base) / (top - base));
    let g = '<g class="grid">';
    for (let v = base; v <= top + 1e-9; v += step) g += `<line class="${v === base ? 'base' : ''}" x1="${padL}" x2="${W - padR + 8}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${yFmt(v)}</text>`;
    const every = Math.ceil(xs.length / Math.max(2, Math.floor((W - padL - padR) / 44)));
    xs.forEach((xv, i) => { if (i % every === 0 || i === xs.length - 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(xFmt(xv))}</text>`; });
    g += '</g>';
    const paths = series.map((s) => {
      const pts = s.values.map((v, i) => (v.y == null ? null : [x(i), y(v.y)]));
      let d = '', pen = false;
      pts.forEach((p) => { if (!p) { pen = false; return; } d += `${pen ? 'L' : 'M'}${p[0]},${p[1]}`; pen = true; });
      const last = [...pts].reverse().find(Boolean);
      const lastV = [...s.values].reverse().find((v) => v.y != null);
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/>
        ${s.dots !== false ? pts.filter(Boolean).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('') : ''}
        ${last ? `<text class="lbl" x="${last[0] + 8}" y="${last[1] + 4}">${esc(s.label)} ${yFmt(lastV.y)}</text>` : ''}`;
    }).join('');
    const colW = (W - padL - padR) / Math.max(xs.length - 1, 1);
    const cols = xs.map((xv, i) => {
      const rows = series.map((s) => `<div class="r"><i style="background:${s.color}"></i>${esc(s.label)}: <b style="display:inline">${s.values[i]?.y == null ? '—' : yFmt(s.values[i].y)}</b></div>`).join('');
      return `<rect class="hit col" data-cx="${x(i)}" x="${x(i) - colW / 2}" y="${padT}" width="${colW}" height="${ih}" data-tip="${esc(`<b>${esc(xLabel)} ${esc(xFmt(xv))}</b>${rows}`)}"/>`;
    }).join('');
    return `<svg width="${W}" height="${H}" role="img">${g}<line class="cross" y1="${padT}" y2="${padT + ih}" style="display:none"/>${paths}${cols}</svg>`;
  });
}

// ---------- horizontal bars (single series, optional highlight) ----------
export function hbars(el, { rows, fmt = fmtK, rowH = 30, labelW = 150, tipFn, max: fixedMax }) {
  mount(el, (W) => {
    const padR = 48, H = rows.length * rowH;
    const max = fixedMax ?? Math.max(...rows.map((r) => r.value), 1);
    const iw = W - labelW - padR;
    const body = rows.map((r, i) => {
      const y = i * rowH, bh = rowH - 10, w = (iw * Math.max(0, r.value)) / max;
      return `<g><text class="${r.highlight ? 'val' : 'lbl'}" x="0" y="${y + rowH / 2 + 4}">${esc(r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label)}</text>
        <path d="${hbarPath(labelW, y + 5, w, bh)}" fill="${r.highlight ? 'var(--series-me)' : 'var(--bar-muted)'}"/>
        <text class="val" x="${labelW + w + 6}" y="${y + rowH / 2 + 4}">${esc(fmt(r.value))}</text>
        <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}" data-tip="${esc(tipFn ? tipFn(r) : `${esc(r.label)}: ${esc(fmt(r.value))}`)}"/></g>`;
    }).join('');
    return `<svg width="${W}" height="${H}" role="img">${body}</svg>`;
  });
}

// ---------- stacked horizontal bars ----------
export function stackedHbars(el, { rows, keys, colors, fmt = fmtK, rowH = 32, labelW = 150 }) {
  mount(el, (W) => {
    const padR = 54, H = rows.length * rowH;
    const totals = rows.map((r) => keys.reduce((s, k) => s + (r.parts[k] || 0), 0));
    const max = Math.max(...totals, 1), iw = W - labelW - padR;
    const body = rows.map((r, i) => {
      const y = i * rowH + 5, bh = rowH - 10;
      let x = labelW;
      const segs = keys.map((k, ki) => {
        const v = r.parts[k] || 0, w = (iw * v) / max;
        if (w <= 0) return '';
        const isLast = keys.slice(ki + 1).every((k2) => !(r.parts[k2] > 0));
        const gap = isLast ? 0 : 2; // 2px surface gap between segments
        const seg = isLast ? `<path d="${hbarPath(x, y, w, bh)}" fill="${colors[k]}"/>` : `<rect x="${x}" y="${y}" width="${Math.max(0, w - gap)}" height="${bh}" fill="${colors[k]}"/>`;
        const out = `<g data-tip="${esc(`<b>${esc(r.label)}</b>${esc(k)}: ${fmt(v)} (${Math.round((100 * v) / (totals[i] || 1))}%)`)}">${seg}</g>`;
        x += w;
        return out;
      }).join('');
      return `<g><text class="${r.highlight ? 'val' : 'lbl'}" x="0" y="${y + bh / 2 + 4}">${esc(r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label)}</text>${segs}
        <text class="val" x="${x + 6}" y="${y + bh / 2 + 4}">${fmt(totals[i])}</text></g>`;
    }).join('');
    return `<svg width="${W}" height="${H}" role="img">${body}</svg>`;
  });
}

// ---------- scatter with quadrants ----------
export function scatter(el, { points, xLabel, yLabel, height = 360, xFmt = fmtK, yFmt = fmtK, quadrants }) {
  mount(el, (W) => {
    const padL = 46, padR = 16, padT = 16, padB = 40, H = height, iw = W - padL - padR, ih = H - padT - padB;
    const xsv = points.map((p) => p.x), ysv = points.map((p) => p.y);
    const ext = (a) => { const lo = Math.min(...a), hi = Math.max(...a), pad = (hi - lo) * 0.12 || 1; return [lo - pad, hi + pad]; };
    const [x0, x1] = ext(xsv), [y0, y1] = ext(ysv);
    const X = (v) => padL + (iw * (v - x0)) / (x1 - x0), Y = (v) => padT + ih * (1 - (v - y0) / (y1 - y0));
    const mx = xsv.reduce((a, b) => a + b, 0) / xsv.length, my = ysv.reduce((a, b) => a + b, 0) / ysv.length;
    let g = `<g class="grid"><line class="base" x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}"/><line class="base" x1="${padL}" x2="${padL}" y1="${padT}" y2="${padT + ih}"/>
      <line x1="${X(mx)}" x2="${X(mx)}" y1="${padT}" y2="${padT + ih}" stroke-dasharray="4 4"/><line x1="${padL}" x2="${W - padR}" y1="${Y(my)}" y2="${Y(my)}" stroke-dasharray="4 4"/></g>
      <text x="${padL + iw / 2}" y="${H - 6}" text-anchor="middle">${esc(xLabel)} →</text>
      <text transform="translate(12 ${padT + ih / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)} →</text>`;
    if (quadrants) {
      const q = quadrants; // [topLeft, topRight, bottomLeft, bottomRight]
      g += `<text class="lbl" x="${padL + 8}" y="${padT + 14}">${esc(q[0])}</text><text class="lbl" x="${W - padR - 8}" y="${padT + 14}" text-anchor="end">${esc(q[1])}</text>
        <text class="lbl" x="${padL + 8}" y="${padT + ih - 8}">${esc(q[2])}</text><text class="lbl" x="${W - padR - 8}" y="${padT + ih - 8}" text-anchor="end">${esc(q[3])}</text>`;
    }
    const placed = [];
    const dots = [...points].sort((a, b) => (b.highlight ? 1 : 0) - (a.highlight ? 1 : 0)).map((p) => {
      const cx = X(p.x), right = cx < W - 130;
      let cy = Y(p.y), ly = cy;
      const lw = Math.min(p.label.length, 18) * 6.2;
      const box = (yy) => (right ? [cx + 9, yy - 9, cx + 9 + lw, yy + 4] : [cx - 9 - lw, yy - 9, cx - 9, yy + 4]);
      const hits = (b) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
      for (const dy of [0, 12, -12, 24, -24, 36, -36]) { if (!hits(box(cy + dy))) { ly = cy + dy; break; } }
      placed.push(box(ly));
      return `<g data-tip="${esc(`<b>${esc(p.label)}</b>${esc(xLabel)}: ${xFmt(p.x)}<br>${esc(yLabel)}: ${yFmt(p.y)}`)}">
        <circle cx="${cx}" cy="${cy}" r="14" fill="transparent"/>
        <circle cx="${cx}" cy="${cy}" r="${p.highlight ? 7 : 5.5}" fill="${p.highlight ? 'var(--series-me)' : 'var(--series-ref)'}" stroke="var(--surface)" stroke-width="2"/>
        <text class="${p.highlight ? 'val' : 'lbl'}" x="${cx + (right ? 9 : -9)}" y="${ly + 4}" text-anchor="${right ? 'start' : 'end'}" style="font-size:11px">${esc(p.label.length > 18 ? p.label.slice(0, 17) + '…' : p.label)}</text></g>`;
    }).reverse().join('');
    // Highlighted point drawn last (on top).
    return `<svg width="${W}" height="${H}" role="img">${g}${dots}</svg>`;
  });
}

// ---------- sparkline (single series, inline) ----------
export function sparkline(values, { w = 90, h = 26, color = 'var(--series-me)' } = {}) {
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [2 + (i * (w - 4)) / Math.max(values.length - 1, 1), 2 + (h - 4) * (1 - (v - lo) / span)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts.at(-1);
  return `<svg width="${w}" height="${h}" aria-hidden="true" style="display:inline-block;vertical-align:middle"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="3" fill="${color}"/></svg>`;
}

// ---------- heat colors ----------
// Ordinal finish (1 = best = darkest). Returns [background, text color].
export function finishColor(place, n) {
  if (place == null) return ['var(--surface-2)', 'var(--muted)'];
  const steps = ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6', '--seq-7'];
  const i = Math.min(steps.length - 1, Math.floor(((place - 1) / Math.max(n - 1, 1)) * steps.length));
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const strong = dark ? i >= 3 : i <= 3;
  return [`var(${steps[i]})`, strong ? '#ffffff' : 'var(--ink)'];
}
// Diverging win% (0.5 = neutral gray).
export function divColor(p) {
  if (p == null) return ['var(--surface)', 'var(--muted)'];
  if (p >= 0.75) return ['var(--div-pos-2)', '#ffffff'];
  if (p > 0.5) return ['var(--div-pos-1)', 'var(--ink)'];
  if (p === 0.5) return ['var(--div-mid)', 'var(--ink)'];
  if (p > 0.25) return ['var(--div-neg-1)', 'var(--ink)'];
  return ['var(--div-neg-2)', '#ffffff'];
}
