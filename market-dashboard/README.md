# NYSE Market Dashboard

A self-hosted website with five pages:

| Page | What it shows |
| --- | --- |
| **Top Movers** (`/`) | The day's biggest NYSE gainers and losers by % change, with sector, relative volume and market cap. Refreshes every 30 s while the market is open. |
| **Valuation** (`/valuation`) | The most undervalued (or overvalued) NYSE stocks, organized by valuation theory, filterable by sector, plus a by-sector view. |
| **Technicals** (`/technical`) | Breakouts and breakdowns flagged by eight indicator families, rescanned every 15 minutes during the session. |
| **Daily Picks** (`/picks`) | Ten buys and ten shorts from the fundamental screen and ten of each from the technical screen, published after every close. |
| **Track Record** (`/performance`) | How each day's picks have done since they were published: return, return vs. SPY, hit rate, and the average return path per cohort. |

> **Not investment advice.** The models are simple, transparent screens on public data that may be delayed, incomplete or wrong. Short selling carries unlimited risk.

## Quick start

```bash
cd market-dashboard
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python -m app.cli serve            # live NYSE data from Yahoo Finance
# open http://127.0.0.1:8000
```

No API key is needed. On first start the app scans the universe in the background
(about a minute for fundamentals of ~400 stocks); the Valuation and Technicals pages
show a progress message until the first scan is done.

To try it without network access, use the synthetic demo provider (fake tickers that start with `Z`):

```bash
DATA_PROVIDER=demo python -m app.cli serve
```

### Command line

```bash
python -m app.cli scan                 # run valuation + technical scans now
python -m app.cli picks [--force]      # publish (or regenerate) picks for the latest session
python -m app.cli marks                # record today's prices for all tracked picks
python -m app.cli performance          # print the track-record summary
```

## How it works

```
app/
  providers/yahoo.py   live data via yfinance: screener (movers, universe), Ticker.info (fundamentals), daily bars
  providers/demo.py    deterministic synthetic market for offline use and tests
  valuation.py         valuation models and the composite score
  indicators.py        SMA/EMA, RSI, MACD, Bollinger, ATR, ADX
  technicals.py        breakout/breakdown signal rules and scoring
  engine.py            scans, pick selection, performance math, caching
  storage.py           SQLite: snapshots, fundamentals cache, picks, daily price marks
  scheduler.py         jobs on the NYSE clock
  main.py              FastAPI JSON API + static pages
static/                plain HTML/CSS/JS front end (Chart.js from a CDN on the Track Record page)
```

### Data

* **Movers**: Yahoo's equity screener filtered to the NYSE (`exchange = NYQ`), price ≥ $5,
  market cap ≥ $300M and volume ≥ 200K (configurable), sorted by % change. Yahoo's quotes
  are close to real time but not guaranteed; treat them as indicative.
* **Universe** for valuation and technicals: the largest `UNIVERSE_SIZE` (default 400) NYSE
  stocks with market cap ≥ `UNIVERSE_MIN_MCAP` (default $2B).
* **Fundamentals** are cached in SQLite for 20 hours, so only new names are fetched on each scan.

### Valuation models (by theory)

| Theory | Model | Fair value |
| --- | --- | --- |
| Intrinsic value (cash flows) | Discounted Cash Flow | 2-stage FCF/share DCF, CAPM discount rate (7–14%), Gordon terminal value |
| | Dividend Discount Model | D₁ / (r − g), g = ROE × (1 − payout) ≤ 6% |
| Classic value (Graham) | Graham Number | √(22.5 × EPS × BVPS) |
| | Graham Growth Formula | EPS × (8.5 + 2g) × 4.4 / AAA yield |
| Growth at a reasonable price | Lynch Fair Value (PEG) | EPS × (growth % + dividend yield %), fair P/E ≤ 25 |
| Relative valuation | Sector Multiples | average price implied by sector-median P/E, EV/EBITDA, P/B, P/S |
| Yield and quality | FCF Yield | percentile rank of FCF / market cap |
| | Earnings Yield + ROE (Greenblatt-style) | combined percentile of EBITDA/EV and ROE |

The **composite** is the median upside across the intrinsic models that apply (needs ≥ 2;
each capped at +300% / −95%), plus how many models agree on direction.

### Technical signals

52-week high/low breakouts, 20-day Donchian channel breakouts, golden/death crosses and
50-day SMA reclaims/losses, MACD crossovers, RSI exits from oversold/overbought and
momentum thrusts, Bollinger band breakouts and squeeze breakouts, volume surges (> 2× the
20-day average on a move > ½ ATR), and ADX > 25 trend strength. Each signal has a weight;
a stock's net score is bullish minus bearish weight, ±0.5 for trading above/below its
200-day average. Hover a signal in the UI for its exact rule.

### Daily picks

Published at **4:15 pm ET** each weekday (after a 4:10 pm price mark), at the closing price.
Each list holds up to ten names with at most three per sector.

* **Fundamental buy**: composite upside > 0, ≥ 3 models, ≥ 60% agree, positive EPS;
  ranked by upside × agreement, tilted by the quality percentile.
* **Fundamental short**: composite upside < 0, ≥ 2 models, ≤ 34% agree;
  ranked by downside, boosted for falling earnings and low quality.
* **Technical buy**: at least one bullish breakout signal, positive net score, not below
  the 200-day average; very overbought names (RSI > 80) are ranked lower.
* **Technical short**: the mirror image, with deeply oversold names (RSI < 20) ranked lower.

### Tracking

Every pick stores its entry price and the SPY price at publication. A 4:10 pm job records
the close for every symbol ever picked, which builds the return path on the Track Record
page; the latest point uses live prices. Short P/L is the inverse of the price change, and
"vs benchmark" for a short adds back the index move over the same period.

Exchange holidays are not modeled: on a holiday the jobs simply re-record the prior close.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_PROVIDER` | `yahoo` | `yahoo` or `demo` |
| `DB_PATH` | `data/market.sqlite3` | SQLite file |
| `UNIVERSE_SIZE` | `400` | stocks scanned for valuation/technicals |
| `UNIVERSE_MIN_MCAP` | `2e9` | minimum market cap for the scan universe |
| `MOVERS_MIN_PRICE` / `MOVERS_MIN_MCAP` / `MOVERS_MIN_VOLUME` | `5` / `3e8` / `2e5` | movers filters |
| `RISK_FREE_RATE` / `EQUITY_RISK_PREMIUM` / `TERMINAL_GROWTH` | `0.0425` / `0.055` / `0.025` | DCF/DDM inputs |
| `AAA_BOND_YIELD` | `5.0` | Y in the Graham formula (percent) |
| `PICKS_PER_LIST` | `10` | names per pick list |
| `BENCHMARK` | `SPY` | index used for "vs benchmark" |
| `ENABLE_SCHEDULER` | `1` | set `0` to disable background jobs |

The scheduler runs inside the web process, so keep one instance running continuously
(for example under systemd, Docker or a small VM) for picks to be published and tracked
every day.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

Tests use the demo provider and an in-memory database, including a multi-day simulation
that checks pick returns against the provider's later prices.
