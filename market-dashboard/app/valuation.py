"""Fundamental valuation models, grouped by valuation theory.

Every intrinsic-value model returns a per-share value and the implied upside versus
the current price. Ranking models (yield and quality) return a 0-100 score instead.
All models are deliberately simple, transparent screens built on trailing data;
they are a starting point for research, not a substitute for it.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Callable

from .config import settings

UPSIDE_CAP = 3.0  # clip +300% / -95% when ranking so bad data cannot dominate
UPSIDE_FLOOR = -0.95


@dataclass(frozen=True)
class Method:
    key: str
    name: str
    theory: str
    kind: str  # "intrinsic" (value + upside) or "score" (0-100 rank)
    description: str


METHODS: list[Method] = [
    Method("dcf", "Discounted Cash Flow", "Intrinsic value (cash flows)", "intrinsic",
           "Two-stage DCF of free cash flow per share: 5 years at the estimated growth rate, 5 years "
           "fading to terminal growth, then a Gordon terminal value. Discount rate from CAPM (risk-free "
           "rate + beta x equity risk premium, bounded 7-14%)."),
    Method("ddm", "Dividend Discount Model", "Intrinsic value (cash flows)", "intrinsic",
           "Gordon growth model: next year's dividend / (discount rate - dividend growth). Growth is the "
           "sustainable rate ROE x (1 - payout), capped at 6%. Dividend payers only."),
    Method("graham_number", "Graham Number", "Classic value (Benjamin Graham)", "intrinsic",
           "sqrt(22.5 x EPS x book value per share): the most a defensive investor should pay, "
           "equivalent to P/E x P/B <= 22.5."),
    Method("graham_formula", "Graham Growth Formula", "Classic value (Benjamin Graham)", "intrinsic",
           "Revised Graham formula V = EPS x (8.5 + 2g) x 4.4 / Y, with g the growth estimate in percent "
           "(capped at 15) and Y the current AAA corporate bond yield."),
    Method("lynch", "Lynch Fair Value (PEG)", "Growth at a reasonable price", "intrinsic",
           "Peter Lynch's rule that a fairly valued stock's P/E equals its growth rate plus dividend yield. "
           "Fair value = EPS x (growth % + yield %), with the fair P/E capped at 25."),
    Method("relative", "Sector Multiples", "Relative valuation", "intrinsic",
           "Average price implied by re-rating the stock to its sector's median P/E, EV/EBITDA, P/B and "
           "P/S (each needs at least 3 peers with positive values)."),
    Method("fcf_yield", "Free-Cash-Flow Yield", "Yield and quality", "score",
           "Free cash flow / market cap, ranked as a percentile across the universe."),
    Method("magic_formula", "Earnings Yield + ROE (Greenblatt-style)", "Yield and quality", "score",
           "Joel Greenblatt's Magic Formula idea: rank cheapness (EBITDA / enterprise value) and quality "
           "(return on equity) separately, then combine the two percentile ranks."),
]
METHOD_KEYS = [m.key for m in METHODS]
INTRINSIC_KEYS = [m.key for m in METHODS if m.kind == "intrinsic"]


def _pos(x) -> bool:
    return x is not None and not math.isnan(x) and x > 0


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def discount_rate(f: dict) -> float:
    beta = f.get("beta") if f.get("beta") is not None else 1.0
    return _clamp(settings.risk_free_rate + beta * settings.equity_risk_premium, 0.07, 0.14)


def growth_estimate(f: dict) -> float | None:
    cands = []
    if f.get("eps_forward") is not None and _pos(f.get("eps_ttm")):
        cands.append(f["eps_forward"] / f["eps_ttm"] - 1)
    if f.get("earnings_growth") is not None:
        cands.append(f["earnings_growth"])
    if f.get("revenue_growth") is not None:
        cands.append(f["revenue_growth"])
    if not cands:
        return None
    return _clamp(statistics.median(cands), -0.05, 0.20)


def _result(value: float | None, price: float, **extra) -> dict | None:
    if value is None or not _pos(price) or math.isnan(value) or value <= 0:
        return None
    return {"value": round(value, 2), "upside": round(value / price - 1, 4), **extra}


def dcf(f: dict, ctx: dict) -> dict | None:
    fcf, shares, price = f.get("free_cash_flow"), f.get("shares"), f.get("price")
    if not (_pos(fcf) and _pos(shares)):
        return None
    g = growth_estimate(f)
    g = 0.03 if g is None else _clamp(g, 0.0, 0.20)
    r, tg = discount_rate(f), settings.terminal_growth
    cf, pv = fcf / shares, 0.0
    for year in range(1, 11):
        growth = g if year <= 5 else g + (tg - g) * (year - 5) / 5
        cf *= 1 + growth
        pv += cf / (1 + r) ** year
    pv += cf * (1 + tg) / (r - tg) / (1 + r) ** 10
    return _result(pv, price, growth=round(g, 4), discount_rate=round(r, 4))


def ddm(f: dict, ctx: dict) -> dict | None:
    div, price = f.get("dividend_rate"), f.get("price")
    if not _pos(div):
        return None
    payout = f.get("payout_ratio")
    if payout is not None and payout > 1.0:
        return None  # dividend not covered by earnings
    r = discount_rate(f)
    roe = f.get("return_on_equity")
    g = roe * (1 - payout) if roe is not None and payout is not None else settings.terminal_growth
    g = min(_clamp(g, 0.0, 0.06), r - 0.015)
    return _result(div * (1 + g) / (r - g), price, dividend_growth=round(g, 4), discount_rate=round(r, 4))


def graham_number(f: dict, ctx: dict) -> dict | None:
    eps, bvps = f.get("eps_ttm"), f.get("book_value_ps")
    if not (_pos(eps) and _pos(bvps)):
        return None
    return _result(math.sqrt(22.5 * eps * bvps), f.get("price"))


def graham_formula(f: dict, ctx: dict) -> dict | None:
    eps = f.get("eps_ttm")
    if not _pos(eps):
        return None
    g = growth_estimate(f)
    g_pct = _clamp((g or 0) * 100, 0, 15)
    value = eps * (8.5 + 2 * g_pct) * 4.4 / settings.aaa_bond_yield
    return _result(value, f.get("price"), growth=round(g_pct / 100, 4))


def lynch(f: dict, ctx: dict) -> dict | None:
    eps, price = f.get("eps_ttm"), f.get("price")
    g = growth_estimate(f)
    if not (_pos(eps) and g is not None and g > 0):
        return None
    yield_pct = (f.get("dividend_rate") or 0) / price * 100 if _pos(price) else 0
    fair_pe = min(g * 100 + yield_pct, 25)
    pe = price / eps
    peg = pe / (g * 100)
    return _result(eps * fair_pe, price, fair_pe=round(fair_pe, 2), peg=round(peg, 2))


def _sector_medians(stocks: list[dict]) -> dict[str, dict[str, float]]:
    fields = ["trailing_pe", "ev_to_ebitda", "price_to_book", "price_to_sales"]
    by_sector: dict[str, dict[str, list[float]]] = {}
    for f in stocks:
        sec = f.get("sector")
        if not sec:
            continue
        bucket = by_sector.setdefault(sec, {k: [] for k in fields})
        for k in fields:
            v = f.get(k)
            if _pos(v) and v < 500:  # ignore absurd multiples from near-zero denominators
                bucket[k].append(v)
    return {
        sec: {k: statistics.median(vals) for k, vals in bucket.items() if len(vals) >= 3}
        for sec, bucket in by_sector.items()
    }


def relative(f: dict, ctx: dict) -> dict | None:
    med = ctx["sector_medians"].get(f.get("sector") or "", {})
    price = f.get("price")
    if not med or not _pos(price):
        return None
    implied, used = [], {}
    for k in ("trailing_pe", "price_to_book", "price_to_sales"):
        own = f.get(k)
        if k in med and _pos(own):
            implied.append(price * med[k] / own)
            used[k] = round(med[k], 2)
    own_ev = f.get("ev_to_ebitda")
    ebitda, ev, mcap, shares = f.get("ebitda"), f.get("enterprise_value"), f.get("market_cap"), f.get("shares")
    if "ev_to_ebitda" in med and _pos(own_ev) and _pos(ebitda) and ev and mcap and _pos(shares):
        net_debt = ev - mcap
        equity = med["ev_to_ebitda"] * ebitda - net_debt
        if equity > 0:
            implied.append(equity / shares)
            used["ev_to_ebitda"] = round(med["ev_to_ebitda"], 2)
    if not implied:
        return None
    return _result(statistics.mean(implied), price, sector_medians=used)


INTRINSIC_FUNCS: dict[str, Callable[[dict, dict], dict | None]] = {
    "dcf": dcf, "ddm": ddm, "graham_number": graham_number,
    "graham_formula": graham_formula, "lynch": lynch, "relative": relative,
}


def _percentiles(values: dict[str, float]) -> dict[str, float]:
    """Map symbol -> percentile (0-100, higher value = higher percentile)."""
    if not values:
        return {}
    ordered = sorted(values, key=values.get)
    n = len(ordered)
    return {s: (i / (n - 1) * 100 if n > 1 else 100.0) for i, s in enumerate(ordered)}


def capped(upside: float) -> float:
    return _clamp(upside, UPSIDE_FLOOR, UPSIDE_CAP)


def value_universe(stocks: list[dict]) -> list[dict]:
    """Run every model over the universe and attach a composite view to each stock."""
    stocks = [f for f in stocks if _pos(f.get("price"))]
    ctx = {"sector_medians": _sector_medians(stocks)}

    fcf_yield = {
        f["symbol"]: f["free_cash_flow"] / f["market_cap"]
        for f in stocks if f.get("free_cash_flow") is not None and _pos(f.get("market_cap"))
    }
    ey = {
        f["symbol"]: f["ebitda"] / f["enterprise_value"]
        for f in stocks if f.get("ebitda") is not None and _pos(f.get("enterprise_value"))
    }
    roe = {f["symbol"]: f["return_on_equity"] for f in stocks if f.get("return_on_equity") is not None}
    fcf_pct, ey_pct, roe_pct = _percentiles(fcf_yield), _percentiles(ey), _percentiles(roe)

    out = []
    for f in stocks:
        sym = f["symbol"]
        methods: dict[str, dict] = {}
        for key, fn in INTRINSIC_FUNCS.items():
            try:
                res = fn(f, ctx)
            except (ZeroDivisionError, TypeError, ValueError):
                res = None
            if res:
                methods[key] = res
        if sym in fcf_pct:
            methods["fcf_yield"] = {"score": round(fcf_pct[sym], 1), "yield": round(fcf_yield[sym], 4)}
        if sym in ey_pct and sym in roe_pct:
            methods["magic_formula"] = {
                "score": round((ey_pct[sym] + roe_pct[sym]) / 2, 1),
                "earnings_yield": round(ey[sym], 4),
                "roe": round(roe[sym], 4),
            }
        ups = [capped(methods[k]["upside"]) for k in INTRINSIC_KEYS if k in methods]
        composite = {
            "upside": round(statistics.median(ups), 4) if len(ups) >= 2 else None,
            "methods": len(ups),
            "agreement": round(sum(u > 0 for u in ups) / len(ups), 2) if ups else None,
        }
        out.append({
            "symbol": sym, "name": f.get("name"), "sector": f.get("sector") or "Unknown",
            "industry": f.get("industry"), "price": f.get("price"), "market_cap": f.get("market_cap"),
            "metrics": {k: f.get(k) for k in (
                "trailing_pe", "forward_pe", "price_to_book", "price_to_sales", "ev_to_ebitda",
                "peg_ratio", "eps_ttm", "dividend_rate", "return_on_equity", "debt_to_equity",
                "earnings_growth", "revenue_growth", "beta")},
            "methods": methods,
            "composite": composite,
        })
    return out
