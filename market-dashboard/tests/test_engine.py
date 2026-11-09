from datetime import date, datetime, time

import pytest
from fastapi.testclient import TestClient

import app.engine as engine_mod
import app.marketclock as clock
import app.providers.demo as demo_mod
from app.engine import Engine
from app.main import create_app
from app.providers.demo import DemoProvider
from app.storage import Store


@pytest.fixture
def at(monkeypatch):
    """Freeze the market clock at a given ET date/time."""
    def set_time(d: date, t: time = time(16, 30)):
        now = datetime.combine(d, t, tzinfo=clock.ET)
        fake = lambda: now
        for mod in (clock, demo_mod, engine_mod):
            monkeypatch.setattr(mod, "now_et", fake, raising=False)
        monkeypatch.setattr(engine_mod, "last_trading_day", lambda at=None: clock.last_trading_day(now))
    return set_time


@pytest.fixture
def engine():
    return Engine(DemoProvider(), Store(":memory:"))


def test_generate_picks_lists(engine, at):
    at(date(2026, 3, 2))
    rows = engine.generate_picks()
    assert rows
    for strategy in ("fundamental", "technical"):
        for side in ("long", "short"):
            lst = [r for r in rows if r["strategy"] == strategy and r["side"] == side]
            assert 0 < len(lst) <= 10
            assert [r["rank"] for r in lst] == list(range(1, len(lst) + 1))
            sectors = [r["sector"] for r in lst]
            assert max(sectors.count(s) for s in sectors) <= 3
    # Idempotent unless forced.
    assert engine.generate_picks() == rows


def test_tracking_over_days(engine, at):
    at(date(2026, 3, 2))
    picks = engine.generate_picks()
    for d in (date(2026, 3, 3), date(2026, 3, 4)):
        at(d)
        engine.record_marks()
    at(date(2026, 3, 9))
    perf = engine.performance()
    assert len(perf["cohorts"]) == 4
    provider = engine.provider
    for c in perf["cohorts"]:
        for p in c["picks"]:
            now = provider.close_on(p["symbol"], date(2026, 3, 9))
            raw = now / p["entry_price"] - 1
            expected = -raw if p["side"] == "short" else raw
            assert p["return_pct"] == pytest.approx(expected, abs=1e-4)
            assert p["days_held"] == 7
    series = {(s["strategy"], s["side"]): s["points"] for s in perf["series"]}
    assert [pt["date"] for pt in series["fundamental", "long"]] == ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-09"]
    assert series["fundamental", "long"][0]["avg_return"] == 0
    assert {s["strategy"] for s in perf["summary"]} == {"fundamental", "technical"}
    assert len(picks) == sum(c["count"] for c in perf["cohorts"])


def test_api_endpoints(engine, at):
    at(date(2026, 3, 2), time(11, 0))
    client = TestClient(create_app(engine, start_jobs=False))
    st = client.get("/api/status").json()
    assert st["demo"] and st["session"] == "open"
    movers = client.get("/api/movers?limit=5").json()
    assert len(movers["gainers"]) == 5 and all(g["change_pct"] > 0 for g in movers["gainers"])
    assert all(l["change_pct"] < 0 for l in movers["losers"])
    assert movers["gainers"][0]["sector"]
    engine.run_valuation_scan()
    engine.run_technical_scan()
    val = client.get("/api/valuation").json()
    assert val["count"] > 100 and len(val["methods"]) == 8
    tech = client.get("/api/technicals").json()
    assert tech["stocks"] and "signals" in tech
    assert client.post("/api/picks/generate").json()["count"] > 0
    picks = client.get("/api/picks").json()
    assert picks["date"] == "2026-03-02" and len(picks["picks"]) > 0
    assert client.get("/api/performance").json()["cohorts"]
    for page in ("/", "/valuation", "/technical", "/picks", "/performance", "/static/common.js"):
        assert client.get(page).status_code == 200
