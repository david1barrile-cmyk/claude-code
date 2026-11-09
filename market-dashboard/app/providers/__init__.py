from __future__ import annotations

from ..config import settings
from .base import DataProvider


def get_provider(name: str | None = None) -> DataProvider:
    name = (name or settings.provider).lower()
    if name == "demo":
        from .demo import DemoProvider

        return DemoProvider()
    if name == "yahoo":
        from .yahoo import YahooProvider

        return YahooProvider()
    raise ValueError(f"Unknown DATA_PROVIDER {name!r} (expected 'yahoo' or 'demo')")
