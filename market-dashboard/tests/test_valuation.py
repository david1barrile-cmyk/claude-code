import math

from app import valuation


def stock(**kw):
    base = dict(symbol="AAA", name="A", sector="Industrials", price=50.0, market_cap=5e9,
                enterprise_value=6e9, shares=1e8, eps_ttm=4.0, eps_forward=4.4, book_value_ps=30.0,
                revenue=4e9, ebitda=8e8, free_cash_flow=4e8, earnings_growth=0.1, revenue_growth=0.06,
                dividend_rate=1.5, payout_ratio=0.375, beta=1.0, return_on_equity=0.13,
                debt_to_equity=80.0, trailing_pe=12.5, forward_pe=11.4, price_to_book=50 / 30,
                price_to_sales=1.25, ev_to_ebitda=7.5, peg_ratio=1.2)
    base.update(kw)
    return base


def test_graham_number():
    res = valuation.graham_number(stock(), {})
    assert math.isclose(res["value"], round(math.sqrt(22.5 * 4 * 30), 2))
    assert valuation.graham_number(stock(eps_ttm=-1), {}) is None


def test_dcf_and_ddm_positive():
    assert valuation.dcf(stock(), {})["value"] > 0
    assert valuation.dcf(stock(free_cash_flow=-1e8), {}) is None
    ddm = valuation.ddm(stock(), {})
    assert ddm["value"] > 0 and ddm["dividend_growth"] <= 0.06
    assert valuation.ddm(stock(payout_ratio=1.5), {}) is None


def test_lynch_requires_growth():
    assert valuation.lynch(stock(), {})["fair_pe"] <= 25
    assert valuation.lynch(stock(earnings_growth=-0.2, revenue_growth=-0.1, eps_forward=3.0), {}) is None


def test_relative_uses_sector_peers():
    peers = [stock(symbol=f"P{i}", trailing_pe=20.0, price_to_book=3.0, price_to_sales=2.5, ev_to_ebitda=12.0) for i in range(4)]
    cheap = stock(symbol="CHEAP")
    out = {s["symbol"]: s for s in valuation.value_universe(peers + [cheap])}
    assert out["CHEAP"]["methods"]["relative"]["upside"] > 0.3
    comp = out["CHEAP"]["composite"]
    assert comp["methods"] >= 4 and comp["upside"] is not None
    assert "magic_formula" in out["CHEAP"]["methods"]


def test_upside_is_capped_in_composite():
    out = valuation.value_universe([stock(price=0.5)])
    assert out[0]["composite"]["upside"] <= valuation.UPSIDE_CAP
