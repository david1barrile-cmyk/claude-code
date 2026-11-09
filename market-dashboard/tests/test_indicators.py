import numpy as np
import pandas as pd

from app import indicators as ind
from app import technicals


def bars(close, volume=None):
    close = pd.Series(close, dtype=float, index=pd.bdate_range("2024-01-01", periods=len(close)))
    vol = pd.Series(volume if volume is not None else 1e6, index=close.index, dtype=float)
    return pd.DataFrame({"Open": close.shift().fillna(close), "High": close * 1.005,
                         "Low": close * 0.995, "Close": close, "Volume": vol})


def test_rsi_extremes():
    up = pd.Series(np.arange(1, 60, dtype=float))
    assert ind.rsi(up).iloc[-1] == 100
    down = pd.Series(np.arange(60, 1, -1, dtype=float))
    assert ind.rsi(down).iloc[-1] < 1


def test_crossed_above_and_below():
    a = pd.Series([1, 1, 1, 3.0])
    assert ind.crossed_above(a, 2)
    assert not ind.crossed_below(a, 2)
    assert ind.crossed_below(pd.Series([3, 3, 3, 1.0]), 2)


def test_breakout_detected():
    rng = np.random.default_rng(0)
    base = 100 + rng.normal(0, 0.5, 299)
    df = bars(np.append(base, 115), volume=np.append(np.full(299, 1e6), 5e6))
    res = technicals.analyze(df)
    for key in ("high_52w", "donchian_up", "bb_upper", "volume_up"):
        assert key in res["signals"], key
    assert res["score"] > 0


def test_breakdown_detected():
    rng = np.random.default_rng(1)
    base = 100 + rng.normal(0, 0.5, 299)
    res = technicals.analyze(bars(np.append(base, 85)))
    assert {"low_52w", "donchian_down", "bb_lower"} <= set(res["signals"])
    assert res["score"] < 0


def test_too_little_history():
    assert technicals.analyze(bars(np.ones(30))) is None
