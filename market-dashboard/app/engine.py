"""Orchestrates data fetches, scans, daily picks and performance tracking."""
from __future__ import annotations

import logging
import statistics
import threading
import time
from datetime import date

from . import technicals, valuation
from .config import settings
from .marketclock import last_trading_day, now_et, session_state
from .providers.base import DataProvider
from .storage import Store, utcnow

log = logging.getLogger(__name__)

BREAKOUT_BULL = {"high_52w", "donchian_up", "golden_cross", "bb_upper", "volume_up", "macd_bull", "sma50_reclaim"}
BREAKOUT_BEAR = {"low_52w", "donchian_down", "death_cross", "bb_lower", "volume_down", "macd_bear", "sma50_lost"}
MAX_PER_SECTOR = 3


class TTLCache:
    def __init__(self, seconds: float):
        self.seconds = seconds
        self._value = None
        self._at = 0.0
        self._lock = threading.Lock()

    def get(self, loader):
        with self._lock:
            if self._value is None or time.monotonic() - self._at > self.seconds:
                self._value = loader()
                self._at = time.monotonic()
            return self._value


class Engine:
    def __init__(self, provider: DataProvider, store: Store):
        self.provider = provider
        self.store = store
        self._movers = TTLCache(settings.movers_cache_seconds)
        self._prices: dict[tuple, tuple[float, dict]] = {}
        self._locks = {k: threading.Lock() for k in ("valuation", "technical", "picks", "sectors")}
        self.jobs: dict[str, dict] = {k: {"running": False, "last_error": None, "last_run": None}
                                      for k in ("valuation", "technical", "picks")}

    # ------------------------------------------------------------------ movers
    def movers(self, limit: int = 25) -> dict:
        def load():
            data = self.provider.get_movers(limit=50)
            data["as_of"] = utcnow()
            return data

        data = self._movers.get(load)
        sectors = self.store.sectors()
        missing = []
        for side in ("gainers", "losers"):
            for q in data[side]:
                if not q.get("sector"):
                    q["sector"] = sectors.get(q["symbol"])
                if not q.get("sector"):
                    missing.append(q["symbol"])
        if missing:
            self._fill_sectors_async(missing)
        return {
            "as_of": data["as_of"],
            "session": session_state(),
            "gainers": data["gainers"][:limit],
            "losers": data["losers"][:limit],
        }

    def _fill_sectors_async(self, symbols: list[str]) -> None:
        if not self._locks["sectors"].acquire(blocking=False):
            return

        def work():
            try:
                self.store.put_fundamentals(self.provider.get_fundamentals(symbols[:60]))
            except Exception:
                log.exception("sector backfill failed")
            finally:
                self._locks["sectors"].release()

        threading.Thread(target=work, daemon=True).start()

    # -------------------------------------------------------------- scans
    def _run(self, job: str, fn, fallback=None):
        lock = self._locks[job]
        if not lock.acquire(blocking=False):
            with lock:  # another run is in flight: wait for it and reuse its result
                pass
            return fallback() if fallback else None
        state = self.jobs[job]
        state["running"] = True
        try:
            result = fn()
            state["last_error"] = None
            return result
        except Exception as exc:
            log.exception("%s job failed", job)
            state["last_error"] = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            state["running"] = False
            state["last_run"] = utcnow()
            lock.release()

    def run_in_background(self, job: str) -> bool:
        if self.jobs[job]["running"]:
            return False
        fn = {"valuation": self.run_valuation_scan, "technical": self.run_technical_scan,
              "picks": lambda: self.generate_picks(force=True)}[job]

        def work():
            try:
                fn()
            except Exception:
                pass  # recorded in self.jobs

        threading.Thread(target=work, daemon=True).start()
        return True

    def _universe(self) -> list[dict]:
        uni = self.provider.get_universe()
        if not uni:
            raise RuntimeError("provider returned an empty universe")
        return uni

    def run_valuation_scan(self) -> dict:
        def work():
            uni = self._universe()
            quotes = {q["symbol"]: q for q in uni}
            syms = list(quotes)
            cached = self.store.get_fundamentals(syms, max_age_hours=20)
            missing = [s for s in syms if s not in cached]
            if missing:
                fetched = self.provider.get_fundamentals(missing)
                self.store.put_fundamentals(fetched)
                cached.update(fetched)
            records = []
            for s, f in cached.items():
                f = dict(f)
                if quotes[s].get("price"):
                    f["price"] = quotes[s]["price"]  # fresher than the cached fundamentals
                records.append(f)
            stocks = valuation.value_universe(records)
            snap = {
                "as_of": utcnow(), "provider": self.provider.name, "count": len(stocks),
                "methods": [m.__dict__ for m in valuation.METHODS], "stocks": stocks,
            }
            self.store.put_snapshot("valuation", snap)
            return snap

        return self._run("valuation", work, lambda: self.store.get_snapshot("valuation"))

    def run_technical_scan(self) -> dict:
        def work():
            uni = self._universe()
            syms = [q["symbol"] for q in uni]
            names = {q["symbol"]: q.get("name") for q in uni}
            sectors = {**self.store.sectors(), **{q["symbol"]: q["sector"] for q in uni if q.get("sector")}}
            history = self.provider.get_history(syms, period="2y")
            stocks = []
            for s in syms:
                res = technicals.analyze(history.get(s))
                if res is None:
                    continue
                stocks.append({"symbol": s, "name": names.get(s), "sector": sectors.get(s) or "Unknown", **res})
            snap = {
                "as_of": utcnow(), "provider": self.provider.name, "count": len(stocks),
                "session": session_state(),
                "families": technicals.FAMILIES,
                "signals": {k: v.__dict__ for k, v in technicals.SIGNALS.items()},
                "stocks": stocks,
            }
            self.store.put_snapshot("technical", snap)
            return snap

        return self._run("technical", work, lambda: self.store.get_snapshot("technical"))

    # -------------------------------------------------------------- picks
    @staticmethod
    def _diversified(cands: list[dict], n: int) -> list[dict]:
        out, per_sector = [], {}
        for c in cands:
            sec = c.get("sector") or "Unknown"
            if per_sector.get(sec, 0) >= MAX_PER_SECTOR:
                continue
            per_sector[sec] = per_sector.get(sec, 0) + 1
            out.append(c)
            if len(out) == n:
                break
        return out

    @staticmethod
    def fundamental_candidates(val_stocks: list[dict]) -> tuple[list[dict], list[dict]]:
        longs, shorts = [], []
        for s in val_stocks:
            comp = s["composite"]
            up, agree, n = comp["upside"], comp["agreement"], comp["methods"]
            if up is None:
                continue
            m = s["metrics"]
            quality = (s["methods"].get("magic_formula") or {}).get("score", 50) / 100
            reasons = [
                f"{valuation_name(k)}: {s['methods'][k]['upside']:+.0%}"
                for k in valuation.INTRINSIC_KEYS if k in s["methods"]
            ]
            if up > 0 and n >= 3 and agree >= 0.6 and (m.get("eps_ttm") or 0) > 0:
                score = up * agree * (0.75 + 0.5 * quality)
                longs.append({**s, "score": round(score, 4),
                              "rationale": [f"Median upside {up:+.0%} across {n} models ({agree:.0%} agree)"] + reasons})
            elif up < 0 and n >= 2 and agree <= 0.34:
                growth = m.get("earnings_growth")
                penalty = 1.25 if growth is not None and growth < 0 else 1.0
                score = -up * (1 - agree) * penalty * (1.25 - 0.5 * quality)
                shorts.append({**s, "score": round(score, 4),
                               "rationale": [f"Median downside {up:+.0%} across {n} models"] + reasons})
        longs.sort(key=lambda x: -x["score"])
        shorts.sort(key=lambda x: -x["score"])
        return longs, shorts

    @staticmethod
    def technical_candidates(tech_stocks: list[dict], signal_defs: dict) -> tuple[list[dict], list[dict]]:
        longs, shorts = [], []
        for s in tech_stocks:
            sig = set(s["signals"])
            ind = s["indicators"]
            above_200 = ind.get("sma200") is not None and s["price"] > ind["sma200"]
            below_200 = ind.get("sma200") is not None and s["price"] < ind["sma200"]
            labels = [signal_defs[k]["label"] for k in s["signals"]]
            rsi = ind.get("rsi14") or 50
            if sig & BREAKOUT_BULL and s["score"] > 0 and not below_200:
                score = s["score"] - (1.0 if rsi > 80 else 0)  # fade extremely overbought names
                longs.append({**s, "score": round(score, 2), "rationale": labels + [f"RSI {rsi:.0f}"]})
            if sig & BREAKOUT_BEAR and s["score"] < 0 and not above_200:
                score = -s["score"] - (1.0 if rsi < 20 else 0)  # avoid shorting capitulation lows
                shorts.append({**s, "score": round(score, 2), "rationale": labels + [f"RSI {rsi:.0f}"]})
        longs.sort(key=lambda x: -x["score"])
        shorts.sort(key=lambda x: -x["score"])
        return longs, shorts

    def generate_picks(self, pick_date: date | None = None, force: bool = False) -> list[dict]:
        def work():
            day = (pick_date or last_trading_day()).isoformat()
            if self.store.has_picks(day) and not force:
                return self.store.picks(day)
            val = self.run_valuation_scan()
            tech = self.run_technical_scan()
            prices = {s["symbol"]: s["price"] for s in tech["stocks"]}
            bench = self.provider.get_prices([settings.benchmark]).get(settings.benchmark)
            n = settings.picks_per_list
            lists = {
                ("fundamental", "long"): None, ("fundamental", "short"): None,
                ("technical", "long"): None, ("technical", "short"): None,
            }
            lists["fundamental", "long"], lists["fundamental", "short"] = self.fundamental_candidates(val["stocks"])
            lists["technical", "long"], lists["technical", "short"] = self.technical_candidates(
                tech["stocks"], tech["signals"])
            rows = []
            for (strategy, side), cands in lists.items():
                for rank, c in enumerate(self._diversified(cands, n), start=1):
                    entry = prices.get(c["symbol"]) or c.get("price")
                    if not entry:
                        continue
                    rows.append({
                        "strategy": strategy, "side": side, "rank": rank, "symbol": c["symbol"],
                        "name": c.get("name"), "sector": c.get("sector"), "entry_price": float(entry),
                        "benchmark_entry": bench, "score": c["score"], "rationale": c["rationale"],
                    })
            self.store.replace_picks(day, rows)
            marks = {r["symbol"]: r["entry_price"] for r in rows}
            if bench:
                marks[settings.benchmark] = bench
            self.store.put_marks(day, marks)
            return self.store.picks(day)

        return self._run("picks", work, lambda: self.store.picks((pick_date or last_trading_day()).isoformat()))

    def record_marks(self) -> int:
        """Store today's prices for every symbol ever picked (run after the close)."""
        syms = sorted({p["symbol"] for p in self.store.picks()} | {settings.benchmark})
        prices = self.provider.get_prices(syms)
        self.store.put_marks(last_trading_day().isoformat(), prices)
        return len(prices)

    # -------------------------------------------------------------- performance
    def current_prices(self, symbols: list[str]) -> dict[str, float]:
        key = tuple(sorted(set(symbols)))
        hit = self._prices.get(key)
        if hit and time.monotonic() - hit[0] < 60:
            return hit[1]
        prices = self.provider.get_prices(list(key))
        self._prices = {key: (time.monotonic(), prices)}
        return prices

    def performance(self) -> dict:
        picks = self.store.picks()
        if not picks:
            return {"as_of": utcnow(), "cohorts": [], "summary": [], "series": []}
        syms = sorted({p["symbol"] for p in picks} | {settings.benchmark})
        prices = self.current_prices(syms)
        bench_now = prices.get(settings.benchmark)
        today = now_et().date()

        def ret(side: str, entry: float, now: float) -> float:
            r = now / entry - 1
            return -r if side == "short" else r

        cohorts: dict[tuple, dict] = {}
        for p in picks:
            now = prices.get(p["symbol"])
            if now is None:
                p.update(current_price=None, return_pct=None, benchmark_return=None, excess_return=None)
            else:
                r = ret(p["side"], p["entry_price"], now)
                b = (bench_now / p["benchmark_entry"] - 1) if bench_now and p["benchmark_entry"] else None
                # A short beats the market when it gains more than the index falls.
                bench_side = (-b if p["side"] == "short" else b) if b is not None else None
                p.update(current_price=now, return_pct=round(r, 4),
                         benchmark_return=round(b, 4) if b is not None else None,
                         excess_return=round(r - bench_side, 4) if bench_side is not None else None)
            p["days_held"] = (today - date.fromisoformat(p["pick_date"])).days
            key = (p["pick_date"], p["strategy"], p["side"])
            cohorts.setdefault(key, {"pick_date": key[0], "strategy": key[1], "side": key[2], "picks": []})["picks"].append(p)

        def stats(rows: list[dict]) -> dict:
            rs = [r["return_pct"] for r in rows if r["return_pct"] is not None]
            xs = [r["excess_return"] for r in rows if r.get("excess_return") is not None]
            return {
                "count": len(rows),
                "avg_return": round(statistics.mean(rs), 4) if rs else None,
                "median_return": round(statistics.median(rs), 4) if rs else None,
                "avg_excess": round(statistics.mean(xs), 4) if xs else None,
                "hit_rate": round(sum(r > 0 for r in rs) / len(rs), 3) if rs else None,
                "best": max(rows, key=lambda r: r["return_pct"] if r["return_pct"] is not None else -9e9)["symbol"] if rs else None,
                "worst": min(rows, key=lambda r: r["return_pct"] if r["return_pct"] is not None else 9e9)["symbol"] if rs else None,
            }

        cohort_list = []
        for c in sorted(cohorts.values(), key=lambda c: (c["pick_date"], c["strategy"], c["side"]), reverse=True):
            c.update(stats(c["picks"]))
            c["benchmark_return"] = next((p["benchmark_return"] for p in c["picks"] if p["benchmark_return"] is not None), None)
            cohort_list.append(c)

        summary = []
        for strategy in ("fundamental", "technical"):
            for side in ("long", "short"):
                rows = [p for p in picks if p["strategy"] == strategy and p["side"] == side]
                if rows:
                    summary.append({"strategy": strategy, "side": side, "cohorts": len({r["pick_date"] for r in rows}), **stats(rows)})

        return {"as_of": utcnow(), "benchmark": settings.benchmark, "cohorts": cohort_list,
                "summary": summary, "series": self._series(cohort_list, prices)}

    def _series(self, cohorts: list[dict], live: dict[str, float]) -> list[dict]:
        """Average return path per cohort, built from stored daily marks plus the live price."""
        if not cohorts:
            return []
        since = min(c["pick_date"] for c in cohorts)
        syms = sorted({p["symbol"] for c in cohorts for p in c["picks"]} | {settings.benchmark})
        marks = self.store.marks(syms, since)
        today = last_trading_day().isoformat()
        out = []
        for c in cohorts:
            dates = sorted({d for p in c["picks"] for d, _ in marks.get(p["symbol"], []) if d >= c["pick_date"]} | {today})
            points = []
            for d in dates:
                rs = []
                for p in c["picks"]:
                    px = dict(marks.get(p["symbol"], [])).get(d)
                    if d == today and p["symbol"] in live:
                        px = live[p["symbol"]]
                    if px:
                        r = px / p["entry_price"] - 1
                        rs.append(-r if c["side"] == "short" else r)
                if rs:
                    points.append({"date": d, "avg_return": round(statistics.mean(rs), 4)})
            out.append({"pick_date": c["pick_date"], "strategy": c["strategy"], "side": c["side"], "points": points})
        return out


def valuation_name(key: str) -> str:
    return next(m.name for m in valuation.METHODS if m.key == key)
