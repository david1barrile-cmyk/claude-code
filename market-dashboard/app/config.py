"""Runtime configuration, read from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Settings:
    # "yahoo" (live data via yfinance) or "demo" (synthetic, offline).
    provider: str = field(default_factory=lambda: os.environ.get("DATA_PROVIDER", "yahoo").lower())
    db_path: Path = field(
        default_factory=lambda: Path(os.environ.get("DB_PATH", Path(__file__).resolve().parent.parent / "data" / "market.sqlite3"))
    )
    # Universe scanned for valuation and technicals: NYSE common stocks above this market cap.
    universe_size: int = field(default_factory=lambda: _env_int("UNIVERSE_SIZE", 400))
    universe_min_market_cap: float = field(default_factory=lambda: _env_float("UNIVERSE_MIN_MCAP", 2e9))
    # Filters for the top movers list (avoid penny stocks and illiquid names).
    movers_min_price: float = field(default_factory=lambda: _env_float("MOVERS_MIN_PRICE", 5.0))
    movers_min_market_cap: float = field(default_factory=lambda: _env_float("MOVERS_MIN_MCAP", 3e8))
    movers_min_volume: float = field(default_factory=lambda: _env_float("MOVERS_MIN_VOLUME", 2e5))
    movers_cache_seconds: int = field(default_factory=lambda: _env_int("MOVERS_CACHE_SECONDS", 30))
    # Valuation assumptions.
    risk_free_rate: float = field(default_factory=lambda: _env_float("RISK_FREE_RATE", 0.0425))
    equity_risk_premium: float = field(default_factory=lambda: _env_float("EQUITY_RISK_PREMIUM", 0.055))
    terminal_growth: float = field(default_factory=lambda: _env_float("TERMINAL_GROWTH", 0.025))
    aaa_bond_yield: float = field(default_factory=lambda: _env_float("AAA_BOND_YIELD", 5.0))
    # Number of picks per list.
    picks_per_list: int = field(default_factory=lambda: _env_int("PICKS_PER_LIST", 10))
    benchmark: str = field(default_factory=lambda: os.environ.get("BENCHMARK", "SPY"))
    # Background jobs (set ENABLE_SCHEDULER=0 to disable, e.g. in tests).
    enable_scheduler: bool = field(default_factory=lambda: os.environ.get("ENABLE_SCHEDULER", "1") != "0")
    workers: int = field(default_factory=lambda: _env_int("FETCH_WORKERS", 8))


settings = Settings()
