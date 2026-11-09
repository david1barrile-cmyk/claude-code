"""Live data from Yahoo Finance via the yfinance library (no API key required).

Yahoo's NYSE quotes during the session are close to real time, but Yahoo does not
guarantee timeliness; treat prices as indicative. The screener powers the movers list
and the scan universe, Ticker.info supplies fundamentals, and yf.download supplies
daily bars (including today's partial bar while the market is open).
"""
from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import yfinance as yf
from yfinance import EquityQuery

from ..config import settings
from .base import DataProvider

log = logging.getLogger(__name__)

NYSE = "NYQ"
_SCREEN_PAGE = 250  # Yahoo's maximum page size


def _num(value):
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _quote_record(q: dict) -> dict:
    return {
        "symbol": q.get("symbol"),
        "name": q.get("longName") or q.get("shortName") or q.get("symbol"),
        "price": _num(q.get("regularMarketPrice")),
        "change": _num(q.get("regularMarketChange")),
        "change_pct": _num(q.get("regularMarketChangePercent")),
        "volume": _num(q.get("regularMarketVolume")),
        "avg_volume": _num(q.get("averageDailyVolume3Month")),
        "market_cap": _num(q.get("marketCap")),
        "sector": q.get("sector"),
        "quote_time": q.get("regularMarketTime"),
        "market_state": q.get("marketState"),
    }


class YahooProvider(DataProvider):
    name = "yahoo"

    def _screen(self, query: EquityQuery, sort_field: str, ascending: bool, size: int) -> list[dict]:
        quotes: list[dict] = []
        offset = 0
        while len(quotes) < size:
            page = min(_SCREEN_PAGE, size - len(quotes))
            result = yf.screen(query, offset=offset, size=page, sortField=sort_field, sortAsc=ascending)
            batch = result.get("quotes", []) if isinstance(result, dict) else []
            quotes.extend(batch)
            if len(batch) < page:
                break
            offset += page
        return quotes

    def get_movers(self, limit: int = 25) -> dict:
        base = [
            EquityQuery("eq", ["exchange", NYSE]),
            EquityQuery("gte", ["intradayprice", settings.movers_min_price]),
            EquityQuery("gte", ["intradaymarketcap", settings.movers_min_market_cap]),
            EquityQuery("gte", ["dayvolume", settings.movers_min_volume]),
        ]
        up = EquityQuery("and", base + [EquityQuery("gt", ["percentchange", 0])])
        down = EquityQuery("and", base + [EquityQuery("lt", ["percentchange", 0])])
        gainers = [_quote_record(q) for q in self._screen(up, "percentchange", False, limit)]
        losers = [_quote_record(q) for q in self._screen(down, "percentchange", True, limit)]
        return {"gainers": gainers, "losers": losers}

    def get_universe(self) -> list[dict]:
        query = EquityQuery(
            "and",
            [
                EquityQuery("eq", ["exchange", NYSE]),
                EquityQuery("gte", ["intradaymarketcap", settings.universe_min_market_cap]),
            ],
        )
        quotes = self._screen(query, "intradaymarketcap", False, settings.universe_size)
        records = [_quote_record(q) for q in quotes if q.get("quoteType", "EQUITY") == "EQUITY"]
        return [r for r in records if r["symbol"]]

    def _info(self, symbol: str) -> dict | None:
        try:
            info = yf.Ticker(symbol).info or {}
        except Exception as exc:  # network hiccups, delisted symbols, rate limits
            log.warning("fundamentals failed for %s: %s", symbol, exc)
            return None
        if not info:
            return None
        price = _num(info.get("currentPrice")) or _num(info.get("regularMarketPrice"))
        return {
            "symbol": symbol,
            "name": info.get("longName") or info.get("shortName") or symbol,
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "price": price,
            "market_cap": _num(info.get("marketCap")),
            "enterprise_value": _num(info.get("enterpriseValue")),
            "shares": _num(info.get("sharesOutstanding")),
            "eps_ttm": _num(info.get("trailingEps")),
            "eps_forward": _num(info.get("forwardEps")),
            "book_value_ps": _num(info.get("bookValue")),
            "revenue": _num(info.get("totalRevenue")),
            "ebitda": _num(info.get("ebitda")),
            "free_cash_flow": _num(info.get("freeCashflow")),
            "earnings_growth": _num(info.get("earningsGrowth")),
            "revenue_growth": _num(info.get("revenueGrowth")),
            "dividend_rate": _num(info.get("dividendRate")),
            "payout_ratio": _num(info.get("payoutRatio")),
            "beta": _num(info.get("beta")),
            "return_on_equity": _num(info.get("returnOnEquity")),
            "debt_to_equity": _num(info.get("debtToEquity")),
            "trailing_pe": _num(info.get("trailingPE")),
            "forward_pe": _num(info.get("forwardPE")),
            "price_to_book": _num(info.get("priceToBook")),
            "price_to_sales": _num(info.get("priceToSalesTrailing12Months")),
            "ev_to_ebitda": _num(info.get("enterpriseToEbitda")),
            "peg_ratio": _num(info.get("trailingPegRatio")) or _num(info.get("pegRatio")),
        }

    def get_fundamentals(self, symbols: list[str]) -> dict[str, dict]:
        with ThreadPoolExecutor(max_workers=settings.workers) as pool:
            results = list(pool.map(self._info, symbols))
        return {r["symbol"]: r for r in results if r}

    def get_history(self, symbols: list[str], period: str = "1y") -> dict[str, pd.DataFrame]:
        out: dict[str, pd.DataFrame] = {}
        for i in range(0, len(symbols), 100):
            chunk = symbols[i : i + 100]
            try:
                df = yf.download(
                    chunk, period=period, interval="1d", group_by="ticker",
                    auto_adjust=True, threads=True, progress=False,
                )
            except Exception as exc:
                log.warning("history download failed for %d symbols: %s", len(chunk), exc)
                continue
            if df is None or df.empty:
                continue
            for sym in chunk:
                try:
                    sub = df[sym] if isinstance(df.columns, pd.MultiIndex) else df
                except KeyError:
                    continue
                sub = sub[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
                if not sub.empty:
                    out[sym] = sub
        return out

    def get_prices(self, symbols: list[str]) -> dict[str, float]:
        if not symbols:
            return {}
        hist = self.get_history(sorted(set(symbols)), period="5d")
        return {s: float(df["Close"].iloc[-1]) for s, df in hist.items()}
