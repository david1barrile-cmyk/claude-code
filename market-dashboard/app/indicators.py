"""Vectorized technical indicators on daily OHLCV DataFrames."""
from __future__ import annotations

import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def _wilder(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = _wilder(delta.clip(lower=0), n)
    loss = _wilder(-delta.clip(upper=0), n)
    rs = gain / loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(loss != 0, 100.0)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return pd.DataFrame({"macd": line, "signal": sig, "hist": line - sig})


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0) -> pd.DataFrame:
    mid = sma(close, n)
    sd = close.rolling(n, min_periods=n).std(ddof=0)
    upper, lower = mid + k * sd, mid - k * sd
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower, "bandwidth": (upper - lower) / mid})


def true_range(df: pd.DataFrame) -> pd.Series:
    prev = df["Close"].shift()
    return pd.concat([df["High"] - df["Low"], (df["High"] - prev).abs(), (df["Low"] - prev).abs()], axis=1).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return _wilder(true_range(df), n)


def adx(df: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    up = df["High"].diff()
    down = -df["Low"].diff()
    plus_dm = up.where((up > down) & (up > 0), 0.0)
    minus_dm = down.where((down > up) & (down > 0), 0.0)
    tr = _wilder(true_range(df), n)
    plus_di = 100 * _wilder(plus_dm, n) / tr
    minus_di = 100 * _wilder(minus_dm, n) / tr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return pd.DataFrame({"adx": _wilder(dx, n), "plus_di": plus_di, "minus_di": minus_di})


def crossed_above(a: pd.Series, b: pd.Series | float, within: int = 1) -> bool:
    """True if `a` moved from <= b to > b in one of the last `within` bars."""
    b = b if isinstance(b, pd.Series) else pd.Series(b, index=a.index)
    above = a > b
    flips = above & ~above.shift(1, fill_value=True)
    return bool(flips.iloc[-within:].any()) and bool(above.iloc[-1])


def crossed_below(a: pd.Series, b: pd.Series | float, within: int = 1) -> bool:
    b = b if isinstance(b, pd.Series) else pd.Series(b, index=a.index)
    below = a < b
    flips = below & ~below.shift(1, fill_value=True)
    return bool(flips.iloc[-within:].any()) and bool(below.iloc[-1])
