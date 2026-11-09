"""Synthetic offline data so the app runs (and is testable) without network access.

Tickers are invented (prefixed with "Z") and every number is generated, so the UI
shows a DEMO banner whenever this provider is active. Price paths are deterministic
per symbol and extend by one bar per business day, so picks made on one day can be
tracked against later prices.
"""
from __future__ import annotations

import hashlib
import string
from datetime import date, datetime

import numpy as np
import pandas as pd

from ..marketclock import now_et
from .base import DataProvider

SECTORS = [
    "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive",
    "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate",
    "Technology", "Utilities",
]
_EPOCH = date(2024, 1, 2)
_N = 160


def _seed(*parts) -> int:
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def _symbols() -> list[str]:
    rng = np.random.default_rng(7)
    letters = np.array(list(string.ascii_uppercase))
    out: list[str] = []
    while len(out) < _N:
        sym = "Z" + "".join(rng.choice(letters, size=int(rng.integers(2, 4))))
        if sym not in out:
            out.append(sym)
    return out


SYMBOLS = _symbols()


class DemoProvider(DataProvider):
    name = "demo"
    is_demo = True

    def __init__(self) -> None:
        self._path_cache: dict[tuple[str, date], pd.DataFrame] = {}

    def _meta(self, sym: str) -> dict:
        rng = np.random.default_rng(_seed("meta", sym))
        return {
            "name": f"{sym[1:].title()} Demo Corp",
            "sector": SECTORS[_seed("sector", sym) % len(SECTORS)],
            "shares": float(rng.uniform(1e8, 3e9)),
            "start_price": float(rng.uniform(12, 400)),
            "drift": float(rng.normal(0.0003, 0.0008)),
            "vol": float(rng.uniform(0.01, 0.035)),
        }

    def _path(self, sym: str, today: date) -> pd.DataFrame:
        key = (sym, today)
        if key in self._path_cache:
            return self._path_cache[key]
        meta = self._meta(sym)
        days = pd.bdate_range(_EPOCH, today)
        rng = np.random.default_rng(_seed("path", sym))
        rets = rng.normal(meta["drift"], meta["vol"], size=len(days))
        # Occasional regime shifts create breakouts and breakdowns.
        jumps = rng.random(len(days)) < 0.01
        rets[jumps] += rng.normal(0, 0.08, size=int(jumps.sum()))
        close = meta["start_price"] * np.exp(np.cumsum(rets))
        open_ = close * np.exp(rng.normal(0, meta["vol"] / 3, size=len(days)))
        high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, meta["vol"] / 2, size=len(days))))
        low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, meta["vol"] / 2, size=len(days))))
        base_vol = meta["shares"] * 0.004
        volume = base_vol * np.exp(rng.normal(0, 0.35, size=len(days))) * (1 + 4 * jumps)
        df = pd.DataFrame(
            {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": volume}, index=days
        )
        # Intraday wiggle on the last bar so the movers page visibly updates.
        minute = now_et().hour * 60 + now_et().minute
        wiggle = 1 + 0.004 * np.sin(minute / 7 + _seed("w", sym) % 10)
        df.iloc[-1, df.columns.get_loc("Close")] *= wiggle
        df.iloc[-1, df.columns.get_loc("High")] = max(df["High"].iloc[-1], df["Close"].iloc[-1])
        df.iloc[-1, df.columns.get_loc("Low")] = min(df["Low"].iloc[-1], df["Close"].iloc[-1])
        self._path_cache = {k: v for k, v in self._path_cache.items() if k[1] == today}
        self._path_cache[key] = df
        return df

    def _quote(self, sym: str) -> dict:
        df = self._path(sym, now_et().date())
        meta = self._meta(sym)
        last, prev = float(df["Close"].iloc[-1]), float(df["Close"].iloc[-2])
        return {
            "symbol": sym,
            "name": meta["name"],
            "price": last,
            "change": last - prev,
            "change_pct": (last / prev - 1) * 100,
            "volume": float(df["Volume"].iloc[-1]),
            "avg_volume": float(df["Volume"].iloc[-63:].mean()),
            "market_cap": last * meta["shares"],
            "sector": meta["sector"],
            "quote_time": int(datetime.now().timestamp()),
            "market_state": "DEMO",
        }

    def get_movers(self, limit: int = 25) -> dict:
        quotes = [self._quote(s) for s in SYMBOLS]
        ups = sorted((q for q in quotes if q["change_pct"] > 0), key=lambda q: -q["change_pct"])
        downs = sorted((q for q in quotes if q["change_pct"] < 0), key=lambda q: q["change_pct"])
        return {"gainers": ups[:limit], "losers": downs[:limit]}

    def get_universe(self) -> list[dict]:
        return sorted((self._quote(s) for s in SYMBOLS), key=lambda q: -q["market_cap"])

    def get_fundamentals(self, symbols: list[str]) -> dict[str, dict]:
        out = {}
        for sym in symbols:
            if sym not in SYMBOLS:
                continue
            meta = self._meta(sym)
            q = self._quote(sym)
            rng = np.random.default_rng(_seed("fund", sym))
            price, shares = q["price"], meta["shares"]
            fair = price * float(np.exp(rng.normal(0, 0.45)))  # hidden "true" value
            pe = float(rng.uniform(9, 30))
            eps = fair / pe * (1 if rng.random() > 0.08 else -0.3)
            bvps = fair / float(rng.uniform(1.0, 6.0))
            fcf_ps = eps * float(rng.uniform(0.6, 1.3))
            rev_ps = fair / float(rng.uniform(0.8, 6))
            ebitda_ps = max(eps * 1.6, rev_ps * 0.05)
            net_debt = shares * fair * float(rng.uniform(-0.1, 0.5))
            pays_div = rng.random() > 0.4
            div = eps * float(rng.uniform(0.2, 0.6)) if pays_div and eps > 0 else 0.0
            mcap = price * shares
            ev = mcap + net_debt
            growth = float(rng.normal(0.08, 0.1))
            out[sym] = {
                "symbol": sym, "name": meta["name"], "sector": meta["sector"], "industry": None,
                "price": price, "market_cap": mcap, "enterprise_value": ev, "shares": shares,
                "eps_ttm": eps, "eps_forward": eps * (1 + growth), "book_value_ps": bvps,
                "revenue": rev_ps * shares, "ebitda": ebitda_ps * shares,
                "free_cash_flow": fcf_ps * shares, "earnings_growth": growth,
                "revenue_growth": growth * 0.7, "dividend_rate": div or None,
                "payout_ratio": (div / eps) if div and eps > 0 else None,
                "beta": float(rng.uniform(0.6, 1.6)),
                "return_on_equity": eps / bvps if bvps else None,
                "debt_to_equity": float(rng.uniform(10, 250)),
                "trailing_pe": price / eps if eps > 0 else None,
                "forward_pe": price / (eps * (1 + growth)) if eps * (1 + growth) > 0 else None,
                "price_to_book": price / bvps, "price_to_sales": price / rev_ps,
                "ev_to_ebitda": ev / (ebitda_ps * shares) if ebitda_ps > 0 else None,
                "peg_ratio": (price / eps) / (growth * 100) if eps > 0 and growth > 0 else None,
            }
        return out

    def get_history(self, symbols: list[str], period: str = "1y") -> dict[str, pd.DataFrame]:
        bars = {"5d": 5, "1mo": 22, "3mo": 64, "6mo": 127, "1y": 252, "2y": 504}.get(period, 252)
        today = now_et().date()
        out = {}
        for sym in symbols:
            if sym in SYMBOLS:
                out[sym] = self._path(sym, today).iloc[-bars:].copy()
            elif sym == "SPY":
                out[sym] = self._benchmark(today).iloc[-bars:].copy()
        return out

    def _benchmark(self, today: date) -> pd.DataFrame:
        frames = [self._path(s, today)["Close"] / self._path(s, today)["Close"].iloc[0] for s in SYMBOLS[:40]]
        close = pd.concat(frames, axis=1).mean(axis=1) * 450
        return pd.DataFrame({"Open": close, "High": close, "Low": close, "Close": close, "Volume": 1e8})

    def get_prices(self, symbols: list[str]) -> dict[str, float]:
        hist = self.get_history(list(set(symbols)), period="5d")
        return {s: float(df["Close"].iloc[-1]) for s, df in hist.items()}

    # Used by tests to price a symbol as of an earlier day.
    def close_on(self, sym: str, day: date) -> float:
        return float(self._path(sym, day)["Close"].iloc[-1])
