"""Command-line entry points: python -m app.cli {scan,picks,marks,serve}."""
from __future__ import annotations

import argparse
import json

from .config import settings
from .engine import Engine
from .providers import get_provider
from .storage import Store


def main() -> None:
    parser = argparse.ArgumentParser(description="NYSE market dashboard")
    parser.add_argument("command", choices=["scan", "picks", "marks", "performance", "serve"])
    parser.add_argument("--force", action="store_true", help="regenerate today's picks")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    if args.command == "serve":
        import uvicorn

        uvicorn.run("app.main:create_app", factory=True, host=args.host, port=args.port)
        return

    engine = Engine(get_provider(), Store(settings.db_path))
    if args.command == "scan":
        v = engine.run_valuation_scan()
        t = engine.run_technical_scan()
        print(f"valued {v['count']} stocks, analyzed {t['count']} charts")
    elif args.command == "picks":
        rows = engine.generate_picks(force=args.force)
        for r in rows:
            print(f"{r['pick_date']} {r['strategy']:<11} {r['side']:<5} #{r['rank']:<2} {r['symbol']:<6} @ {r['entry_price']:.2f}")
    elif args.command == "marks":
        print(f"recorded {engine.record_marks()} prices")
    elif args.command == "performance":
        print(json.dumps(engine.performance()["summary"], indent=2))


if __name__ == "__main__":
    main()
