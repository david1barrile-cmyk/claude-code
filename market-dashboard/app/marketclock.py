"""NYSE session clock (regular hours, weekdays; exchange holidays are not modeled)."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
OPEN, CLOSE = time(9, 30), time(16, 0)


def now_et() -> datetime:
    return datetime.now(ET)


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5


def market_is_open(at: datetime | None = None) -> bool:
    at = at or now_et()
    return is_trading_day(at.date()) and OPEN <= at.time() < CLOSE


def session_state(at: datetime | None = None) -> str:
    at = at or now_et()
    if not is_trading_day(at.date()):
        return "closed"
    if at.time() < OPEN:
        return "pre-market"
    if at.time() < CLOSE:
        return "open"
    return "after-hours"


def last_trading_day(at: datetime | None = None) -> date:
    """The session whose data is current: today once the market has opened, else the prior session."""
    at = at or now_et()
    d = at.date()
    if is_trading_day(d) and at.time() >= OPEN:
        return d
    d -= timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d
