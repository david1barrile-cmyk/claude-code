"""Background jobs on the NYSE clock (America/New_York)."""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .engine import Engine
from .marketclock import ET

log = logging.getLogger(__name__)


def _safe(fn, name):
    def run():
        try:
            fn()
        except Exception:
            log.exception("scheduled job %s failed", name)
    return run


def start(engine: Engine) -> BackgroundScheduler:
    sched = BackgroundScheduler(timezone=ET)
    weekdays = "mon-fri"
    # Technical breakouts refresh every 15 minutes through the session.
    sched.add_job(_safe(engine.run_technical_scan, "technical"),
                  CronTrigger(day_of_week=weekdays, hour="9-15", minute="35,50,5,20", timezone=ET))
    # Fundamentals change slowly: refresh before the open and after the close.
    sched.add_job(_safe(engine.run_valuation_scan, "valuation"),
                  CronTrigger(day_of_week=weekdays, hour=9, minute=0, timezone=ET))
    # After the close: mark every tracked pick, then publish the day's picks at closing prices.
    sched.add_job(_safe(engine.record_marks, "marks"),
                  CronTrigger(day_of_week=weekdays, hour=16, minute=10, timezone=ET))
    sched.add_job(_safe(lambda: engine.generate_picks(force=True), "picks"),
                  CronTrigger(day_of_week=weekdays, hour=16, minute=15, timezone=ET))
    sched.start()
    return sched
