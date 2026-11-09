"""FastAPI app: JSON API under /api and the static dashboard pages."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .engine import Engine
from .marketclock import last_trading_day, now_et, session_state
from .providers import get_provider
from .storage import Store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
STATIC = Path(__file__).resolve().parent.parent / "static"


def create_app(engine: Engine | None = None, start_jobs: bool | None = None) -> FastAPI:
    engine = engine or Engine(get_provider(), Store(settings.db_path))
    start_jobs = settings.enable_scheduler if start_jobs is None else start_jobs

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        sched = None
        if start_jobs:
            from . import scheduler

            sched = scheduler.start(engine)
            for name in ("valuation", "technical"):
                if engine.store.get_snapshot(name) is None:
                    engine.run_in_background(name)
        yield
        if sched:
            sched.shutdown(wait=False)

    app = FastAPI(title="NYSE Market Dashboard", lifespan=lifespan)
    app.state.engine = engine

    @app.get("/api/status")
    def status():
        return {
            "provider": engine.provider.name,
            "demo": engine.provider.is_demo,
            "session": session_state(),
            "now_et": now_et().isoformat(timespec="seconds"),
            "last_trading_day": last_trading_day().isoformat(),
            "jobs": engine.jobs,
        }

    @app.get("/api/movers")
    def movers(limit: int = Query(25, ge=1, le=50)):
        try:
            return engine.movers(limit)
        except Exception as exc:
            raise HTTPException(502, f"Market data unavailable: {exc}") from exc

    def snapshot(name: str):
        snap = engine.store.get_snapshot(name)
        if snap is None:
            started = engine.run_in_background("technical" if name == "technical" else "valuation")
            return {"pending": True, "started": started, "job": engine.jobs[name], "stocks": []}
        snap["job"] = engine.jobs[name]
        return snap

    @app.get("/api/valuation")
    def valuation_view():
        return snapshot("valuation")

    @app.get("/api/technicals")
    def technicals_view():
        return snapshot("technical")

    @app.post("/api/refresh/{job}")
    def refresh(job: str):
        if job not in ("valuation", "technical", "picks"):
            raise HTTPException(404, "job must be valuation, technical or picks")
        return {"started": engine.run_in_background(job), "job": engine.jobs[job]}

    @app.get("/api/picks")
    def picks(day: date | None = Query(None, alias="date")):
        dates = engine.store.pick_dates()
        target = day.isoformat() if day else (dates[0] if dates else None)
        return {
            "date": target,
            "dates": dates,
            "picks": engine.store.picks(target) if target else [],
            "job": engine.jobs["picks"],
        }

    @app.post("/api/picks/generate")
    def generate(force: bool = False):
        if force:
            return {"started": engine.run_in_background("picks"), "job": engine.jobs["picks"]}
        try:
            rows = engine.generate_picks()
        except Exception as exc:
            raise HTTPException(502, f"Could not generate picks: {exc}") from exc
        return {"date": rows[0]["pick_date"] if rows else None, "count": len(rows)}

    @app.get("/api/performance")
    def performance():
        try:
            return engine.performance()
        except Exception as exc:
            raise HTTPException(502, f"Could not price picks: {exc}") from exc

    pages = {"/": "index.html", "/valuation": "valuation.html", "/technical": "technical.html",
             "/picks": "picks.html", "/performance": "performance.html"}
    for route, file in pages.items():
        app.add_api_route(route, (lambda f=file: FileResponse(STATIC / f)), include_in_schema=False)
    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app



