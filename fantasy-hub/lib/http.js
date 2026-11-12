import { config } from '../config.js';

let mockHandler = null;
async function mock() {
  if (!mockHandler) mockHandler = (await import('./mock.js')).handle;
  return mockHandler;
}

async function get(url, as, headers = {}) {
  if (config.mock) {
    const v = (await mock())(url);
    if (v === undefined) throw new Error(`mock: no data for ${url}`);
    return v;
  }
  const res = await fetch(url, {
    headers: { 'user-agent': 'fantasy-hub/0.1', accept: as === 'json' ? 'application/json' : '*/*', ...headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return as === 'json' ? res.json() : res.text();
}

export const fetchJson = (url, headers) => get(url, 'json', headers);
export const fetchText = (url) => get(url, 'text');
