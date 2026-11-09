"""Breakout and breakdown detection across several technical indicator families.

Each signal has a direction (bull/bear), an indicator family (used to group the
Technical Analysis page) and a weight. A stock's technical score is the sum of
bullish weights minus bearish weights, plus small trend-strength confirmations.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import pandas as pd

from . import indicators as ind


@dataclass(frozen=True)
class SignalDef:
    key: str
    family: str
    direction: str  # "bull" | "bear"
    label: str
    weight: float
    description: str


FAMILIES = {
    "52w": "52-Week Range",
    "donchian": "Donchian Channel",
    "ma": "Moving-Average Crosses",
    "macd": "MACD",
    "rsi": "RSI",
    "bollinger": "Bollinger Bands",
    "volume": "Volume",
    "adx": "Trend Strength (ADX)",
}

SIGNALS: dict[str, SignalDef] = {s.key: s for s in [
    SignalDef("high_52w", "52w", "bull", "52-week high breakout", 3.0,
              "Close above the highest high of the prior 252 sessions."),
    SignalDef("low_52w", "52w", "bear", "52-week low breakdown", 3.0,
              "Close below the lowest low of the prior 252 sessions."),
    SignalDef("donchian_up", "donchian", "bull", "20-day channel breakout", 2.0,
              "Close above the prior 20-session high (Turtle-style breakout)."),
    SignalDef("donchian_down", "donchian", "bear", "20-day channel breakdown", 2.0,
              "Close below the prior 20-session low."),
    SignalDef("golden_cross", "ma", "bull", "Golden cross (50/200)", 2.0,
              "50-day SMA crossed above the 200-day SMA in the last 5 sessions."),
    SignalDef("death_cross", "ma", "bear", "Death cross (50/200)", 2.0,
              "50-day SMA crossed below the 200-day SMA in the last 5 sessions."),
    SignalDef("sma50_reclaim", "ma", "bull", "Reclaimed 50-day SMA", 1.0,
              "Close crossed above the 50-day SMA in the last 3 sessions."),
    SignalDef("sma50_lost", "ma", "bear", "Lost 50-day SMA", 1.0,
              "Close crossed below the 50-day SMA in the last 3 sessions."),
    SignalDef("macd_bull", "macd", "bull", "MACD bullish crossover", 1.5,
              "MACD line crossed above its signal line in the last 3 sessions."),
    SignalDef("macd_bear", "macd", "bear", "MACD bearish crossover", 1.5,
              "MACD line crossed below its signal line in the last 3 sessions."),
    SignalDef("rsi_oversold_exit", "rsi", "bull", "RSI exits oversold", 1.0,
              "RSI(14) crossed back above 30 in the last 3 sessions."),
    SignalDef("rsi_overbought_exit", "rsi", "bear", "RSI exits overbought", 1.0,
              "RSI(14) crossed back below 70 in the last 3 sessions."),
    SignalDef("rsi_momentum", "rsi", "bull", "RSI momentum thrust", 0.5,
              "RSI(14) crossed above 60 in the last 3 sessions."),
    SignalDef("rsi_weakness", "rsi", "bear", "RSI momentum breakdown", 0.5,
              "RSI(14) crossed below 40 in the last 3 sessions."),
    SignalDef("bb_upper", "bollinger", "bull", "Upper Bollinger breakout", 1.5,
              "Close above the upper 20-day, 2-sigma Bollinger Band."),
    SignalDef("bb_lower", "bollinger", "bear", "Lower Bollinger breakdown", 1.5,
              "Close below the lower Bollinger Band."),
    SignalDef("bb_squeeze_up", "bollinger", "bull", "Squeeze breakout (up)", 1.0,
              "Band width hit a 6-month low within 10 sessions, then price broke above the upper band."),
    SignalDef("bb_squeeze_down", "bollinger", "bear", "Squeeze breakdown (down)", 1.0,
              "Band width hit a 6-month low within 10 sessions, then price broke below the lower band."),
    SignalDef("volume_up", "volume", "bull", "Volume surge on up day", 1.5,
              "Volume above 2x its 20-day average on a gain of more than 1 ATR/2."),
    SignalDef("volume_down", "volume", "bear", "Volume surge on down day", 1.5,
              "Volume above 2x its 20-day average on a loss of more than 1 ATR/2."),
    SignalDef("adx_up", "adx", "bull", "Strong uptrend (ADX > 25)", 1.0,
              "ADX(14) above 25 and rising with +DI above -DI."),
    SignalDef("adx_down", "adx", "bear", "Strong downtrend (ADX > 25)", 1.0,
              "ADX(14) above 25 and rising with -DI above +DI."),
]}


def _f(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) or math.isinf(v) else round(v, 4)


def analyze(df: pd.DataFrame) -> dict | None:
    """Return indicator readings and triggered signals for one stock, or None if too little data."""
    if df is None or len(df) < 60:
        return None
    df = df.astype(float)
    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    last = close.iloc[-1]
    hits: list[str] = []

    prior_high_252 = high.iloc[-253:-1].max()
    prior_low_252 = low.iloc[-253:-1].min()
    if len(df) >= 200:
        if last > prior_high_252:
            hits.append("high_52w")
        if last < prior_low_252:
            hits.append("low_52w")

    if last > high.iloc[-21:-1].max():
        hits.append("donchian_up")
    if last < low.iloc[-21:-1].min():
        hits.append("donchian_down")

    sma50, sma200 = ind.sma(close, 50), ind.sma(close, 200)
    if len(df) >= 205:
        if ind.crossed_above(sma50, sma200, within=5):
            hits.append("golden_cross")
        if ind.crossed_below(sma50, sma200, within=5):
            hits.append("death_cross")
    if ind.crossed_above(close, sma50, within=3):
        hits.append("sma50_reclaim")
    if ind.crossed_below(close, sma50, within=3):
        hits.append("sma50_lost")

    m = ind.macd(close)
    if ind.crossed_above(m["macd"], m["signal"], within=3):
        hits.append("macd_bull")
    if ind.crossed_below(m["macd"], m["signal"], within=3):
        hits.append("macd_bear")

    r = ind.rsi(close)
    if ind.crossed_above(r, 30, within=3):
        hits.append("rsi_oversold_exit")
    if ind.crossed_below(r, 70, within=3):
        hits.append("rsi_overbought_exit")
    if ind.crossed_above(r, 60, within=3):
        hits.append("rsi_momentum")
    if ind.crossed_below(r, 40, within=3):
        hits.append("rsi_weakness")

    bb = ind.bollinger(close)
    squeeze = bool((bb["bandwidth"].iloc[-10:] <= bb["bandwidth"].iloc[-126:].min() * 1.0001).any())
    if last > bb["upper"].iloc[-1]:
        hits.append("bb_upper")
        if squeeze:
            hits.append("bb_squeeze_up")
    if last < bb["lower"].iloc[-1]:
        hits.append("bb_lower")
        if squeeze:
            hits.append("bb_squeeze_down")

    a = ind.atr(df)
    vol_ratio = vol.iloc[-1] / vol.iloc[-21:-1].mean() if vol.iloc[-21:-1].mean() > 0 else float("nan")
    move = close.iloc[-1] - close.iloc[-2]
    if vol_ratio > 2 and move > a.iloc[-1] / 2:
        hits.append("volume_up")
    if vol_ratio > 2 and move < -a.iloc[-1] / 2:
        hits.append("volume_down")

    dx = ind.adx(df)
    adx_now, adx_prev = dx["adx"].iloc[-1], dx["adx"].iloc[-6]
    if adx_now > 25 and adx_now > adx_prev:
        if dx["plus_di"].iloc[-1] > dx["minus_di"].iloc[-1]:
            hits.append("adx_up")
        else:
            hits.append("adx_down")

    bull = sum(SIGNALS[k].weight for k in hits if SIGNALS[k].direction == "bull")
    bear = sum(SIGNALS[k].weight for k in hits if SIGNALS[k].direction == "bear")
    # Trend context: breakouts with the long-term trend are more reliable.
    trend = 0.0
    if not math.isnan(sma200.iloc[-1]):
        trend = 0.5 if last > sma200.iloc[-1] else -0.5

    return {
        "price": _f(last),
        "change_pct": _f((last / close.iloc[-2] - 1) * 100),
        "signals": hits,
        "bull_score": round(bull, 2),
        "bear_score": round(bear, 2),
        "score": round(bull - bear + (trend if hits else 0), 2),
        "indicators": {
            "rsi14": _f(r.iloc[-1]),
            "macd": _f(m["macd"].iloc[-1]),
            "macd_signal": _f(m["signal"].iloc[-1]),
            "sma50": _f(sma50.iloc[-1]),
            "sma200": _f(sma200.iloc[-1]),
            "bb_upper": _f(bb["upper"].iloc[-1]),
            "bb_lower": _f(bb["lower"].iloc[-1]),
            "adx14": _f(adx_now),
            "atr14": _f(a.iloc[-1]),
            "volume_ratio": _f(vol_ratio),
            "high_52w": _f(high.iloc[-252:].max()),
            "low_52w": _f(low.iloc[-252:].min()),
            "pct_from_52w_high": _f((last / high.iloc[-252:].max() - 1) * 100),
        },
    }
