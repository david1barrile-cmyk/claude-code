"""Interface every market-data source implements.

All records are plain dicts so they serialize straight to JSON.

Quote record (movers, universe):
    symbol, name, price, change, change_pct, volume, avg_volume, market_cap, sector (optional)

Fundamentals record (keys may be None when the source has no value):
    symbol, name, sector, industry, price, market_cap, enterprise_value, shares,
    eps_ttm, eps_forward, book_value_ps, revenue, ebitda, free_cash_flow,
    earnings_growth, revenue_growth, dividend_rate, payout_ratio, beta,
    return_on_equity, debt_to_equity, trailing_pe, forward_pe, price_to_book,
    price_to_sales, ev_to_ebitda, peg_ratio
"""
from __future__ import annotations

from abc import ABC, abstractmethod

import pandas as pd


class DataProvider(ABC):
    name: str = "base"
    is_demo: bool = False

    @abstractmethod
    def get_movers(self, limit: int = 25) -> dict:
        """Return {"gainers": [quote...], "losers": [quote...]} for NYSE, sorted by % change."""

    @abstractmethod
    def get_universe(self) -> list[dict]:
        """Return quote records for the NYSE stocks to scan (largest first)."""

    @abstractmethod
    def get_fundamentals(self, symbols: list[str]) -> dict[str, dict]:
        """Return {symbol: fundamentals record}. Missing symbols are simply omitted."""

    @abstractmethod
    def get_history(self, symbols: list[str], period: str = "1y") -> dict[str, pd.DataFrame]:
        """Return {symbol: DataFrame[Open, High, Low, Close, Volume]} of daily bars, oldest first.

        During market hours the last row is today's partial bar."""

    @abstractmethod
    def get_prices(self, symbols: list[str]) -> dict[str, float]:
        """Return the latest trade price for each symbol."""
