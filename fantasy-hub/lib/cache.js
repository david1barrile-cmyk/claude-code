import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

const mem = new Map();
const inflight = new Map();

function diskPath(key) {
  return path.join(config.cacheDir, crypto.createHash('sha1').update(key).digest('hex') + '.json');
}

// Memoize an async producer by key, in memory and (optionally) on disk so big
// payloads like the Sleeper player DB survive restarts.
export async function cached(key, ttl, producer, { disk = false } = {}) {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && now - hit.t < ttl) return hit.v;
  if (disk) {
    try {
      const f = diskPath(key);
      const st = fs.statSync(f);
      if (now - st.mtimeMs < ttl) {
        const v = JSON.parse(fs.readFileSync(f, 'utf8'));
        mem.set(key, { t: st.mtimeMs, v });
        return v;
      }
    } catch { /* miss */ }
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await producer();
      mem.set(key, { t: Date.now(), v });
      if (disk) {
        fs.mkdirSync(config.cacheDir, { recursive: true });
        fs.writeFileSync(diskPath(key), JSON.stringify(v));
      }
      return v;
    } catch (err) {
      if (hit) return hit.v; // serve stale on upstream failure
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
