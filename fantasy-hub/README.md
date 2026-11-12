# Fantasy Hub

A single place for your Sleeper league: standings and matchups, waiver and trade
advice tailored to your roster, advanced usage metrics, auto-generated scouting
reports, and aggregated news and highlight videos.

## Run it

Requires Node 18+ and has no dependencies to install.

```bash
cd fantasy-hub
npm start            # http://localhost:3000 with live Sleeper data
npm run demo         # same app with built-in fake data, no network needed (username: demo)
npm test
```

Open the site, type your **Sleeper username**, and pick a league. You don't
need a password or API key, because Sleeper's API is public and read-only. The
site saves your choice in the browser, and **switch** in the header changes it.

## How Sleeper is connected

Everything goes through the server (`lib/sleeper.js`), which calls
`https://api.sleeper.app/v1` and caches the responses:

| Data | Endpoint | Cache |
|---|---|---|
| User → leagues | `/user/{name}`, `/user/{id}/leagues/nfl/{season}` | 6h / 5m |
| League, rosters, users, matchups, transactions | `/league/{id}/...` | 5m |
| Player database (~5 MB) | `/players/nfl` | 24h on disk (Sleeper asks for at most once a day) |
| Trending adds | `/players/nfl/trending/add` | 5m |
| Weekly stats / projections | `/stats/nfl/regular/{season}/{week}`, `/projections/...` | 24h for past weeks |

Scoring always uses **your league's `scoring_settings`**, so PPR, TE premium,
6-pt pass TDs and similar rules are reflected everywhere.

## What each page does

- **Dashboard**: standings, this week's matchups, your top waiver targets, league transactions and the latest headlines.
- **My Team**: your optimal lineup by rest-of-season points (it flags players who are better than someone you're starting) and your positional strength ranked against every team in the league.
- **Waivers**: free agents ranked by how much they improve your best lineup, plus snap-share and target-share trends and Sleeper-wide add counts. It also suggests who to drop.
- **Trades**: an analyzer (lineup change for both teams, trade value, verdict) and a trade finder that searches every roster for 1-for-1 and 2-for-1 deals that improve **both** lineups at roughly even value.
- **Metrics**: sortable snap share, target share, air-yards share, WOPR, aDOT, yards/target, touches, YPC, red-zone opportunities and consistency.
- **Player pages**: an auto-written scouting report (outlook, strengths, concerns), usage profile, weekly chart, game log, matching news and highlights.
- **News & Highlights**: RSS from ESPN, CBS, Yahoo, PFT and RotoBaller, plus YouTube channel feeds. Edit the lists in `config.js`.

## Data sources and caveats

- Trade values come from [FantasyCalc](https://fantasycalc.com) (redraft or dynasty, 1QB or superflex, PPR, team count, all matched to your league). If FantasyCalc is unreachable, values are derived from production instead.
- Sleeper's `/stats` and `/projections` endpoints are not in its official docs. They have been stable for years, but if they change, metrics degrade and the rest of the app keeps working.
- Target share and air-yards share use each player's *current* team, so they're approximate for players traded mid-season.
- A news feed that fails is skipped, and the News page lists it as unavailable.

## Layout

```
server.js        HTTP server + JSON API
config.js        feeds, ports, cache TTLs
lib/sleeper.js   Sleeper client
lib/metrics.js   scoring + advanced metrics
lib/lineup.js    optimal-lineup solver
lib/advice.js    waiver + trade logic
lib/values.js    FantasyCalc / fallback trade values
lib/scouting.js  rule-based scouting reports
lib/feeds.js     RSS/Atom aggregation
lib/mock.js      fake data for `npm run demo` and tests
public/          single-page front end
```
