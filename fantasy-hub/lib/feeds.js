// RSS 2.0 + Atom (incl. YouTube) aggregation without dependencies.
import { config } from '../config.js';
import { cached } from './cache.js';
import { fetchText } from './http.js';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENT[e.toLowerCase()] ?? m;
    });
}
const stripTags = (s) => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1];
const attr = (xml, name, a) => xml.match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, 'i'))?.[1];

export function parseFeed(xml, source) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    const link = decode((tag(b, 'link') || '').trim()) || attr(b, 'link', 'href') || '';
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const videoId = tag(b, 'yt:videoId');
    const image = attr(b, 'media:thumbnail', 'url') || attr(b, 'media:content', 'url') || attr(b, 'enclosure', 'url')
      || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null)
      || decode(tag(b, 'description') || '').match(/<img[^>]+src="([^"]+)"/i)?.[1] || null;
    const summary = stripTags(tag(b, 'description') || tag(b, 'summary') || tag(b, 'media:description') || tag(b, 'content') || '').slice(0, 280);
    const t = date ? Date.parse(stripTags(date)) : NaN;
    return {
      source, title: stripTags(tag(b, 'title') || ''), link, summary, image, videoId: videoId || null,
      published: Number.isFinite(t) ? new Date(t).toISOString() : null,
    };
  }).filter((i) => i.title && i.link);
}

async function aggregate(feeds, kind) {
  return cached(`feeds:${kind}`, config.ttl.feeds, async () => {
    const results = await Promise.allSettled(feeds.map(async (f) => parseFeed(await fetchText(f.url), f.name)));
    const items = [], status = [];
    results.forEach((r, i) => {
      status.push({ source: feeds[i].name, ok: r.status === 'fulfilled', count: r.value?.length ?? 0, error: r.reason?.message });
      if (r.status === 'fulfilled') items.push(...r.value);
    });
    const seen = new Set();
    const deduped = items.filter((i) => !seen.has(i.link) && seen.add(i.link));
    deduped.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
    return { items: deduped, status };
  });
}

export const getNews = () => aggregate(config.newsFeeds, 'news');
export const getHighlights = () => aggregate(config.highlightFeeds, 'highlights');

// Match headlines to a player by full name or "F. Last".
export function mentions(items, name) {
  if (!name) return [];
  const [first, ...rest] = name.split(' ');
  const last = rest.join(' ');
  const pats = [name];
  if (first && last) pats.push(`${first[0]}. ${last}`);
  const re = new RegExp(`\\b(${pats.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  return items.filter((i) => re.test(i.title) || re.test(i.summary));
}
