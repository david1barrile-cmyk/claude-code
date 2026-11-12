// Central configuration. Edit feeds here; everything else reads from this file.
export const config = {
  port: Number(process.env.PORT) || 3000,
  mock: process.env.MOCK === '1',
  // Lock the site to one league: visitors just pick their team. Leave unset to let anyone search by username.
  leagueId: process.env.LEAGUE_ID || null,
  // Optional shared password (HTTP Basic auth; any username works).
  sitePassword: process.env.SITE_PASSWORD || null,
  cacheDir: process.env.CACHE_DIR || new URL('./.cache/', import.meta.url).pathname,

  sleeperBase: 'https://api.sleeper.app/v1',
  fantasyCalcBase: 'https://api.fantasycalc.com',

  // Article feeds (RSS/Atom). A feed that fails is skipped and reported, not fatal.
  newsFeeds: [
    { name: 'ESPN', url: 'https://www.espn.com/espn/rss/nfl/news' },
    { name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/nfl/' },
    { name: 'Yahoo Sports', url: 'https://sports.yahoo.com/nfl/rss.xml' },
    { name: 'Pro Football Talk', url: 'https://profootballtalk.nbcsports.com/feed/' },
    { name: 'RotoBaller', url: 'https://www.rotoballer.com/category/nfl/feed' },
  ],

  // Highlight videos: YouTube channel Atom feeds (youtube.com/feeds/videos.xml?channel_id=...).
  // Add a channel by copying its channel ID from the channel page's "Share > Copy channel ID".
  highlightFeeds: [
    { name: 'NFL', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCDVYQ4Zhbm3S2dlz7P1GBDg' },
  ],

  ttl: {
    players: 24 * 3600e3,   // Sleeper asks clients to fetch the player DB at most daily
    pastWeekStats: 24 * 3600e3,
    live: 5 * 60e3,          // rosters, matchups, trending, current-week stats
    feeds: 15 * 60e3,
    values: 6 * 3600e3,
  },
};
