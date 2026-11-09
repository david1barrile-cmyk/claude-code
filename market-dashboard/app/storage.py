"""SQLite persistence: scan snapshots, fundamentals cache, daily picks and their price marks."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    name TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fundamentals_cache (
    symbol TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pick_date TEXT NOT NULL,
    strategy TEXT NOT NULL CHECK (strategy IN ('fundamental', 'technical')),
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    rank INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT,
    sector TEXT,
    entry_price REAL NOT NULL,
    benchmark_entry REAL,
    score REAL,
    rationale TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (pick_date, strategy, side, symbol)
);
CREATE INDEX IF NOT EXISTS picks_date ON picks (pick_date);
CREATE TABLE IF NOT EXISTS marks (
    symbol TEXT NOT NULL,
    mark_date TEXT NOT NULL,
    price REAL NOT NULL,
    PRIMARY KEY (symbol, mark_date)
);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)

    @contextmanager
    def tx(self):
        with self._lock:
            try:
                yield self._conn
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    # Snapshots -----------------------------------------------------------
    def put_snapshot(self, name: str, data: dict) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT OR REPLACE INTO snapshots (name, created_at, data) VALUES (?, ?, ?)",
                (name, utcnow(), json.dumps(data)),
            )

    def get_snapshot(self, name: str) -> dict | None:
        with self.tx() as c:
            row = c.execute("SELECT created_at, data FROM snapshots WHERE name = ?", (name,)).fetchone()
        if not row:
            return None
        data = json.loads(row["data"])
        data.setdefault("as_of", row["created_at"])
        return data

    # Fundamentals cache ------------------------------------------------------
    def get_fundamentals(self, symbols: list[str], max_age_hours: float) -> dict[str, dict]:
        if not symbols:
            return {}
        cutoff = datetime.now(timezone.utc).timestamp() - max_age_hours * 3600
        out = {}
        with self.tx() as c:
            for i in range(0, len(symbols), 500):
                chunk = symbols[i : i + 500]
                rows = c.execute(
                    f"SELECT symbol, fetched_at, data FROM fundamentals_cache WHERE symbol IN ({','.join('?' * len(chunk))})",
                    chunk,
                ).fetchall()
                for r in rows:
                    if datetime.fromisoformat(r["fetched_at"]).timestamp() >= cutoff:
                        out[r["symbol"]] = json.loads(r["data"])
        return out

    def put_fundamentals(self, records: dict[str, dict]) -> None:
        now = utcnow()
        with self.tx() as c:
            c.executemany(
                "INSERT OR REPLACE INTO fundamentals_cache (symbol, fetched_at, data) VALUES (?, ?, ?)",
                [(s, now, json.dumps(d)) for s, d in records.items()],
            )

    def sectors(self) -> dict[str, str]:
        with self.tx() as c:
            rows = c.execute("SELECT symbol, data FROM fundamentals_cache").fetchall()
        out = {}
        for r in rows:
            sec = json.loads(r["data"]).get("sector")
            if sec:
                out[r["symbol"]] = sec
        return out

    # Picks -------------------------------------------------------------------
    def has_picks(self, pick_date: str) -> bool:
        with self.tx() as c:
            return c.execute("SELECT 1 FROM picks WHERE pick_date = ? LIMIT 1", (pick_date,)).fetchone() is not None

    def replace_picks(self, pick_date: str, picks: list[dict]) -> None:
        now = utcnow()
        with self.tx() as c:
            c.execute("DELETE FROM picks WHERE pick_date = ?", (pick_date,))
            c.executemany(
                """INSERT INTO picks (pick_date, strategy, side, rank, symbol, name, sector, entry_price,
                   benchmark_entry, score, rationale, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (pick_date, p["strategy"], p["side"], p["rank"], p["symbol"], p.get("name"),
                     p.get("sector"), p["entry_price"], p.get("benchmark_entry"), p.get("score"),
                     json.dumps(p.get("rationale", [])), now)
                    for p in picks
                ],
            )

    def picks(self, pick_date: str | None = None) -> list[dict]:
        q = "SELECT * FROM picks"
        args: tuple = ()
        if pick_date:
            q += " WHERE pick_date = ?"
            args = (pick_date,)
        q += " ORDER BY pick_date DESC, strategy, side, rank"
        with self.tx() as c:
            rows = c.execute(q, args).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["rationale"] = json.loads(d["rationale"] or "[]")
            out.append(d)
        return out

    def pick_dates(self) -> list[str]:
        with self.tx() as c:
            rows = c.execute("SELECT DISTINCT pick_date FROM picks ORDER BY pick_date DESC").fetchall()
        return [r["pick_date"] for r in rows]

    # Marks (daily closing prices for tracked symbols) -------------------------
    def put_marks(self, mark_date: str, prices: dict[str, float]) -> None:
        with self.tx() as c:
            c.executemany(
                "INSERT OR REPLACE INTO marks (symbol, mark_date, price) VALUES (?, ?, ?)",
                [(s, mark_date, p) for s, p in prices.items()],
            )

    def marks(self, symbols: list[str], since: str) -> dict[str, list[tuple[str, float]]]:
        if not symbols:
            return {}
        out: dict[str, list[tuple[str, float]]] = {}
        with self.tx() as c:
            rows = c.execute(
                f"SELECT symbol, mark_date, price FROM marks WHERE mark_date >= ? AND symbol IN ({','.join('?' * len(symbols))}) ORDER BY mark_date",
                (since, *symbols),
            ).fetchall()
        for r in rows:
            out.setdefault(r["symbol"], []).append((r["mark_date"], r["price"]))
        return out
