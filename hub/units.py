"""Parsing and formatting for the human tokens people actually write.

Everything internal is SI: metres, seconds, metres/second. The parsers here are
the only place strings like "800m", "7:30/mi" or "90s" are understood, so the
rest of the code never has to guess what a number means.
"""
from __future__ import annotations

import re

M_PER_MILE = 1609.344
M_PER_KM = 1000.0
M_PER_YARD = 0.9144


class ParseError(ValueError):
    """A token that was meant to be a distance/duration/pace and wasn't."""


# --------------------------------------------------------------------------- distance

_DISTANCE_RE = re.compile(
    r"^\s*(?P<num>\d+(?:\.\d+)?)\s*(?P<unit>mi|mile|miles|km|k|m|metre|metres|meter|meters|yd|yard|yards)\s*$",
    re.I,
)

# "5k" is 5000 m as a distance, but "5k pace" is an effort — callers disambiguate.
_DISTANCE_UNITS = {
    "mi": M_PER_MILE, "mile": M_PER_MILE, "miles": M_PER_MILE,
    "km": M_PER_KM, "k": M_PER_KM,
    "m": 1.0, "metre": 1.0, "metres": 1.0, "meter": 1.0, "meters": 1.0,
    "yd": M_PER_YARD, "yard": M_PER_YARD, "yards": M_PER_YARD,
}


def parse_distance(text: str) -> float:
    """"800m" -> 800.0, "1.5mi" -> 2414.0, "5k" -> 5000.0. Returns metres."""
    if text is None:
        raise ParseError("no distance given")
    m = _DISTANCE_RE.match(str(text))
    if not m:
        raise ParseError(f"cannot read {text!r} as a distance")
    return float(m.group("num")) * _DISTANCE_UNITS[m.group("unit").lower()]


def format_distance(metres: float, imperial: bool = True) -> str:
    if imperial:
        return f"{metres / M_PER_MILE:.2f} mi"
    return f"{metres / M_PER_KM:.2f} km"


# --------------------------------------------------------------------------- duration

_CLOCK_RE = re.compile(r"^\s*(?:(?P<h>\d+):)?(?P<m>\d{1,2}):(?P<s>\d{2})\s*$")
_UNIT_DUR_RE = re.compile(
    r"^\s*(?P<num>\d+(?:\.\d+)?)\s*(?P<unit>h|hr|hrs|hour|hours|min|mins|minute|minutes|s|sec|secs|second|seconds)\s*$",
    re.I,
)
_DURATION_UNITS = {
    "h": 3600, "hr": 3600, "hrs": 3600, "hour": 3600, "hours": 3600,
    "min": 60, "mins": 60, "minute": 60, "minutes": 60,
    "s": 1, "sec": 1, "secs": 1, "second": 1, "seconds": 1,
}


def parse_duration(text: str) -> float:
    """"90s", "2min", "1:30" (= 1m30s), "1:05:00" (= 1h5m). Returns seconds."""
    if text is None:
        raise ParseError("no duration given")
    text = str(text)
    m = _CLOCK_RE.match(text)
    if m:
        h = int(m.group("h") or 0)
        return h * 3600 + int(m.group("m")) * 60 + int(m.group("s"))
    m = _UNIT_DUR_RE.match(text)
    if m:
        return float(m.group("num")) * _DURATION_UNITS[m.group("unit").lower()]
    raise ParseError(f"cannot read {text!r} as a duration")


def format_duration(seconds: float) -> str:
    seconds = int(round(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


# --------------------------------------------------------------------------- pace

_PACE_RE = re.compile(
    r"^\s*(?P<min>\d{1,3}):(?P<sec>\d{2})\s*(?:/|per\s*)\s*(?P<unit>mi|mile|km|k)\s*$",
    re.I,
)
_PACE_RANGE_RE = re.compile(
    r"^\s*(?P<a>\d{1,3}:\d{2})\s*(?:-|–|to)\s*(?P<b>\d{1,3}:\d{2})\s*(?:/|per\s*)\s*(?P<unit>mi|mile|km|k)\s*$",
    re.I,
)


def parse_pace(text: str) -> float:
    """"7:30/mi" -> metres per second. Single pace only; see parse_pace_range."""
    if text is None:
        raise ParseError("no pace given")
    m = _PACE_RE.match(str(text))
    if not m:
        raise ParseError(f"cannot read {text!r} as a pace")
    secs = int(m.group("min")) * 60 + int(m.group("sec"))
    per = M_PER_MILE if m.group("unit").lower() in ("mi", "mile") else M_PER_KM
    if secs <= 0:
        raise ParseError(f"pace {text!r} is zero")
    return per / secs


def parse_pace_range(text: str) -> tuple[float, float]:
    """"7:00-7:30/mi" -> (slower_mps, faster_mps). A single pace becomes a
    +/-2% band, because Garmin targets want two bounds and a razor-thin one
    buzzes the whole run."""
    text = str(text)
    m = _PACE_RANGE_RE.match(text)
    if m:
        unit = m.group("unit")
        a = parse_pace(f"{m.group('a')}/{unit}")
        b = parse_pace(f"{m.group('b')}/{unit}")
        return (min(a, b), max(a, b))
    mps = parse_pace(text)
    return (mps * 0.98, mps * 1.02)


def format_pace(mps: float, imperial: bool = True) -> str:
    if mps <= 0:
        return "—"
    per = M_PER_MILE if imperial else M_PER_KM
    secs = per / mps
    return f"{int(secs // 60)}:{int(round(secs % 60)):02d}/{'mi' if imperial else 'km'}"
