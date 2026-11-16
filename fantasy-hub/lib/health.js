// Records every outside request by data source so the status page can show
// what is working, when it last worked, and the last error.
const SOURCES = [
  [/sleeper\.app/, 'Sleeper API'],
  [/fantasycalc/, 'FantasyCalc'],
  [/keeptradecut/, 'KeepTradeCut'],
  [/githubusercontent/, 'DynastyProcess'],
  [/collegefootballdata/, 'CollegeFootballData'],
  [/youtube/, 'YouTube highlights'],
  [/espn|cbssports|yahoo|nbcsports|rotoballer/, 'News feeds'],
];
const stats = new Map();
const started = Date.now();

export function sourceFor(url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  return SOURCES.find(([re]) => re.test(host))?.[1] ?? host;
}

export function record(url, ok, ms, error) {
  const name = sourceFor(url);
  const s = stats.get(name) || { name, ok: 0, failed: 0, lastOk: null, lastFail: null, lastError: null, lastMs: null };
  if (ok) { s.ok++; s.lastOk = Date.now(); s.lastMs = ms; } else { s.failed++; s.lastFail = Date.now(); s.lastError = String(error).slice(0, 300); }
  stats.set(name, s);
}

export function requestStats() {
  return { since: started, sources: [...stats.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
