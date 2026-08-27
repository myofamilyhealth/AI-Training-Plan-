"""Turning a pile of activities into the handful of numbers that change decisions.

The bias here is toward metrics that suggest an action — is the ramp too steep,
is easy day actually easy, is fitness moving — rather than toward a wall of
statistics.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, timedelta

from . import config
from .units import M_PER_MILE, format_distance, format_duration, format_speed


def _day(act: dict) -> date | None:
    """The calendar day a session was completed, as recorded.

    `date` is written by the importer, the .FIT parser and the sync, and is
    already the rider's own day. Falling back to the first ten characters of
    `start` reads that same day off the timestamp without converting it into
    another timezone, which is what moved evening rides onto tomorrow.
    """
    raw = act.get("date") or act.get("start")
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def _hr_reserve_fraction(avg_hr: float, rest_hr: float, max_hr: float) -> float:
    span = max(max_hr - rest_hr, 1.0)
    return min(max((avg_hr - rest_hr) / span, 0.0), 1.0)


def training_load(act: dict, rest_hr: float = 50, max_hr: float = 190) -> float:
    """One session's load.

    With heart rate this is Banister TRIMP, which weights hard minutes far more
    than easy ones. Without it, load falls back to duration scaled by how fast
    the session was relative to an easy jog — cruder, but it keeps activities
    from a device with no HR strap in the picture instead of scoring them zero.
    """
    minutes = (act.get("moving_s") or 0) / 60.0
    if minutes <= 0:
        return 0.0

    avg_hr = act.get("avg_hr")
    if avg_hr:
        frac = _hr_reserve_fraction(avg_hr, rest_hr, max_hr)
        return round(minutes * frac * 0.64 * math.exp(1.92 * frac), 1)

    speed = act.get("avg_speed_mps") or 0
    easy = M_PER_MILE / 600.0                      # a 10:00/mi jog
    intensity = min(max(speed / easy, 0.5), 2.0) if speed else 1.0
    return round(minutes * intensity, 1)


def daily_load(activities: list[dict], **kw) -> dict[date, float]:
    out: dict[date, float] = defaultdict(float)
    for act in activities:
        day = _day(act)
        if day:
            out[day] += training_load(act, **kw)
    return dict(out)


def acwr(activities: list[dict], on: date | None = None, **kw) -> dict:
    """Acute:chronic workload ratio — the last 7 days against the trailing 28.

    Roughly 0.8–1.3 is the range usually described as sustainable; well above
    it means the ramp got steep quickly, which is when people get hurt. It is a
    coarse indicator, not a diagnosis.
    """
    on = on or date.today()
    loads = daily_load(activities, **kw)
    acute = sum(v for d, v in loads.items() if 0 <= (on - d).days < 7)
    chronic28 = sum(v for d, v in loads.items() if 0 <= (on - d).days < 28)
    chronic = chronic28 / 4.0                      # per-week average over 4 weeks
    ratio = (acute / chronic) if chronic > 0 else None

    if ratio is None:
        verdict = "not enough history yet"
    elif ratio < 0.8:
        verdict = "detraining or a deliberate down week"
    elif ratio <= 1.3:
        verdict = "sustainable"
    elif ratio <= 1.5:
        verdict = "ramping fast — watch for niggles"
    else:
        verdict = "spike — high injury risk"

    return {"as_of": str(on), "acute_7d": round(acute, 1),
            "chronic_weekly_avg": round(chronic, 1),
            "ratio": round(ratio, 2) if ratio else None, "verdict": verdict}


def weekly(activities: list[dict], weeks: int = 12, **kw) -> list[dict]:
    """Monday-anchored weekly totals, most recent last."""
    today = date.today()
    this_monday = today - timedelta(days=today.weekday())
    buckets: dict[date, dict] = {
        this_monday - timedelta(weeks=i): {
            "week_of": str(this_monday - timedelta(weeks=i)),
            "activities": 0, "distance_m": 0.0, "moving_s": 0.0,
            "load": 0.0, "elevation_m": 0.0, "by_type": defaultdict(float),
        }
        for i in range(weeks)
    }

    for act in activities:
        day = _day(act)
        if not day:
            continue
        monday = day - timedelta(days=day.weekday())
        bucket = buckets.get(monday)
        if bucket is None:
            continue
        bucket["activities"] += 1
        bucket["distance_m"] += act.get("distance_m") or 0
        bucket["moving_s"] += act.get("moving_s") or 0
        bucket["elevation_m"] += act.get("elevation_m") or 0
        bucket["load"] += training_load(act, **kw)
        bucket["by_type"][act.get("type") or "other"] += act.get("distance_m") or 0

    out = []
    for monday in sorted(buckets):
        b = buckets[monday]
        b["by_type"] = dict(b["by_type"])
        b["load"] = round(b["load"], 1)
        out.append(b)
    return out


def easy_hard_split(activities: list[dict], rest_hr: float = 50, max_hr: float = 190) -> dict:
    """How much of your running is genuinely easy.

    The usual guidance is roughly 80% easy. This uses 76% of heart-rate reserve
    as the line, which sits near most people's first threshold. Activities with
    no heart rate are counted separately rather than guessed at, because
    silently binning them would distort the ratio the metric exists to show.
    """
    easy_s = hard_s = unknown_s = 0.0
    for act in activities:
        if act.get("type") != "running":
            continue
        secs = act.get("moving_s") or 0
        hr = act.get("avg_hr")
        if not hr:
            unknown_s += secs
        elif _hr_reserve_fraction(hr, rest_hr, max_hr) < 0.76:
            easy_s += secs
        else:
            hard_s += secs

    known = easy_s + hard_s
    return {
        "easy_pct": round(100 * easy_s / known, 1) if known else None,
        "hard_pct": round(100 * hard_s / known, 1) if known else None,
        "easy_time": format_duration(easy_s),
        "hard_time": format_duration(hard_s),
        "unmeasured_time": format_duration(unknown_s),
        "note": None if known else "no heart-rate data in this range",
    }


def bests(activities: list[dict]) -> dict:
    """Fastest average speed at each distance band, run-only. Not a true race PR
    — it's the best sustained average over a whole activity of that length."""
    bands = [("5k", 4800, 5400), ("10k", 9600, 10800),
             ("half", 20500, 21800), ("marathon", 41500, 43500)]
    out: dict[str, dict] = {}
    for act in activities:
        if act.get("type") != "running":
            continue
        dist, secs = act.get("distance_m") or 0, act.get("moving_s") or 0
        if not dist or not secs:
            continue
        for label, low, high in bands:
            if low <= dist <= high:
                speed = dist / secs
                if label not in out or speed > out[label]["speed_mps"]:
                    out[label] = {"speed_mps": speed, "date": str(_day(act)),
                                  "name": act.get("name"), "time": format_duration(secs),
                                  "speed_text": format_speed(speed, config.imperial())}
    for value in out.values():
        value.pop("speed_mps", None)
    return out


def fitness_trend(activities: list[dict], days: int = 90) -> dict:
    """Are easy runs getting faster at the same heart rate?

    Pace divided by heart rate on easy runs is a rough efficiency signal: if it
    climbs, the same effort is buying more speed. Compares the recent half of
    the window against the older half.
    """
    cutoff = date.today() - timedelta(days=days)
    points = []
    for act in activities:
        day = _day(act)
        if not day or day < cutoff or act.get("type") != "running":
            continue
        hr, speed = act.get("avg_hr"), act.get("avg_speed_mps")
        if hr and speed and (act.get("moving_s") or 0) > 1200:
            points.append((day, speed / hr))

    if len(points) < 6:
        return {"status": "need at least 6 heart-rate runs over 20 min in this window",
                "samples": len(points)}

    points.sort()
    mid = len(points) // 2
    older = sum(v for _, v in points[:mid]) / mid
    recent = sum(v for _, v in points[mid:]) / (len(points) - mid)
    change = 100 * (recent - older) / older
    return {
        "samples": len(points),
        "change_pct": round(change, 1),
        "direction": "improving" if change > 1.5 else "declining" if change < -1.5 else "flat",
        "note": "speed per heartbeat on easy runs; higher is fitter",
    }


def summary(activities: list[dict], weeks: int = 12, **kw) -> str:
    imperial = config.imperial()
    if not activities:
        return "No activities yet. Run `./wk sync` once your accounts are connected."

    lines = ["", "TRAINING SUMMARY", "=" * 60, ""]

    rows = weekly(activities, weeks=weeks, **kw)
    lines.append(f"{'week of':<12}{'runs':>6}{'distance':>12}{'time':>10}{'load':>8}")
    lines.append("-" * 60)
    for row in rows:
        if not row["activities"]:
            continue
        lines.append(
            f"{row['week_of']:<12}{row['activities']:>6}"
            f"{format_distance(row['distance_m'], imperial):>12}"
            f"{format_duration(row['moving_s']):>10}{row['load']:>8.0f}"
        )

    ratio = acwr(activities, **kw)
    lines += ["", f"Acute:chronic  {ratio['ratio']}  — {ratio['verdict']}",
              f"  last 7 days {ratio['acute_7d']} vs 4-week average {ratio['chronic_weekly_avg']}"]

    split = easy_hard_split(activities)
    if split["easy_pct"] is not None:
        lines += ["", f"Easy/hard      {split['easy_pct']}% easy / {split['hard_pct']}% hard",
                  f"  easy {split['easy_time']}, hard {split['hard_time']}"]

    trend = fitness_trend(activities)
    if "change_pct" in trend:
        lines += ["", f"Efficiency     {trend['direction']} ({trend['change_pct']:+}% over 90 days,"
                      f" {trend['samples']} runs)"]

    best = bests(activities)
    if best:
        lines += ["", "Best sustained efforts"]
        for label in ("5k", "10k", "half", "marathon"):
            if label in best:
                b = best[label]
                lines.append(f"  {label:<9} {b['time']:>9}  {b['speed_text']:>10}   {b['date']}")

    lines.append("")
    return "\n".join(lines)
