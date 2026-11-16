import { config } from '../config.js';
import { record } from './health.js';

let mockHandler = null;
async function mock() {
  if (!mockHandler) mockHandler = (await import('./mock.js')).handle;
  return mockHandler;
}

async function get(url, as, headers = {}) {
  if (config.mock) {
    const v = (await mock())(url);
    record(url, v !== undefined, 0, 'mock: no data');
    if (v === undefined) throw new Error(`mock: no data for ${url}`);
    return v;
  }
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'fantasy-hub/0.1', accept: as === 'json' ? 'application/json' : '*/*', ...headers },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = await (as === 'json' ? res.json() : res.text());
    record(url, true, Date.now() - t0);
    return body;
  } catch (err) {
    record(url, false, Date.now() - t0, err.message);
    throw new Error(`${err.message} for ${url.split('?')[0]}`);
  }
}

export const fetchJson = (url, headers) => get(url, 'json', headers);
export const fetchText = (url) => get(url, 'text');
