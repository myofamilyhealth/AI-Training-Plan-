"""Build the dashboard: one self-contained HTML file, no server required.

Everything the page needs — data, styles, chart code — is inlined, so the
output opens by double-clicking it and keeps working with no network. The
charts are hand-drawn SVG rather than a library, which is what keeps the file
self-contained and small.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path

from . import analyze, config, plan as plan_mod, store
from .units import format_distance, format_duration, format_pace

M_PER_MILE = 1609.344


def _day(act: dict) -> date | None:
    if not act.get("start"):
        return None
    try:
        return datetime.fromisoformat(act["start"]).date()
    except ValueError:
        return None


def build_payload(activities: list[dict], rest_hr: float = 50, max_hr: float = 190,
                  weeks: int = 16, heatmap_weeks: int = 26,
                  demo_note: str | None = None) -> dict:
    imperial = config.imperial()
    unit = "mi" if imperial else "km"
    divisor = M_PER_MILE if imperial else 1000.0
    today = date.today()

    weekly_rows = analyze.weekly(activities, weeks=weeks, rest_hr=rest_hr, max_hr=max_hr)
    this_monday = today - timedelta(days=today.weekday())
    weekly = [
        {
            "week": row["week_of"],
            "distance": round(row["distance_m"] / divisor, 2),
            "hours": round(row["moving_s"] / 3600, 2),
            "load": row["load"],
            "count": row["activities"],
            # The current week is still being run. Plotting it like a finished
            # week reads as a collapse in volume, so it is flagged and drawn
            # differently rather than silently compared against full weeks.
            "partial": row["week_of"] == str(this_monday),
        }
        for row in weekly_rows
    ]

    loads = analyze.daily_load(activities, rest_hr=rest_hr, max_hr=max_hr)
    start = today - timedelta(days=heatmap_weeks * 7 - 1)
    start -= timedelta(days=start.weekday())          # begin on a Monday
    heatmap = [
        {"date": str(start + timedelta(days=i)),
         "load": round(loads.get(start + timedelta(days=i), 0.0), 1)}
        for i in range((today - start).days + 1)
    ]

    rows = []
    for act in activities:
        day = _day(act)
        if not day:
            continue
        speed = act.get("avg_speed_mps") or 0
        rows.append({
            "id": act.get("id"),
            "date": str(day),
            "name": act.get("name") or "",
            "type": act.get("type") or "other",
            "source": act.get("source"),
            "distance": round((act.get("distance_m") or 0) / divisor, 2),
            "seconds": int(act.get("moving_s") or 0),
            "duration": format_duration(act.get("moving_s") or 0),
            "pace": format_pace(speed, imperial) if speed else "",
            "speed": round(speed, 4),
            "hr": int(act["avg_hr"]) if act.get("avg_hr") else None,
            "elevation": round(act.get("elevation_m") or 0),
            "load": analyze.training_load(act, rest_hr=rest_hr, max_hr=max_hr),
        })
    rows.sort(key=lambda r: r["date"], reverse=True)

    ratio = analyze.acwr(activities, rest_hr=rest_hr, max_hr=max_hr)
    split = analyze.easy_hard_split(activities, rest_hr=rest_hr, max_hr=max_hr)
    trend = analyze.fitness_trend(activities)

    last7 = sum(a.get("distance_m") or 0 for a in activities
                if (d := _day(a)) and 0 <= (today - d).days < 7) / divisor
    prev7 = sum(a.get("distance_m") or 0 for a in activities
                if (d := _day(a)) and 7 <= (today - d).days < 14) / divisor

    plan_payload = None
    p = plan_mod.latest()
    if p:
        week = plan_mod.current_week(p)
        plan_payload = {
            "name": p.name,
            "goal": p.meta.get("goal"),
            "race_date": p.meta.get("race_date"),
            "target_time": p.meta.get("target_time"),
            "days_out": ((date.fromisoformat(str(p.meta["race_date"])) - today).days
                         if p.meta.get("race_date") else None),
            "week_number": week.number if week else None,
            "week_label": week.label if week else None,
            "total_weeks": max(len(p.weeks), (week.number if week else 0)),
            "days": [
                {"date": str(d.date) if d.date else None,
                 "weekday": d.weekday[:3].title(),
                 "label": d.label or d.descriptor or "",
                 "structured": bool(d.workout_text),
                 "today": d.date == today}
                for d in (week.days if week else [])
            ],
        }

    return {
        "demo_note": demo_note,
        "generated": datetime.now().isoformat(timespec="seconds"),
        "unit": unit,
        "today": str(today),
        "totals": {
            "activities": len(activities),
            "last7": round(last7, 1),
            "prev7": round(prev7, 1),
            "first": rows[-1]["date"] if rows else None,
        },
        "weekly": weekly,
        "heatmap": heatmap,
        "activities": rows,
        "acwr": ratio,
        "split": split,
        "trend": trend,
        "bests": analyze.bests(activities),
        "plan": plan_payload,
    }


def render(payload: dict | None, standalone: bool = True,
           title: str = "Training Hub") -> str:
    """Assemble the page.

    `standalone` wraps the content in a full HTML document for opening off the
    filesystem. Without it the output is a fragment — a <title>, styles, body
    and script — which is what a host that supplies its own document skeleton
    expects.
    """
    from ._template import BODY, SCRIPT, STYLE

    blob = json.dumps(payload, separators=(",", ":")) if payload is not None else "null"
    # </script> inside the data would close the tag early; the escape is inert
    # to JSON.parse but no longer matches the closing-tag pattern.
    blob = blob.replace("</", "<\\/")
    script = SCRIPT.replace("__PAYLOAD__", blob)

    inner = (
        f"<title>{title}</title>\n"
        f"<style>{STYLE}</style>\n"
        f"{BODY}\n"
        f"<script>{script}</script>"
    )
    if not standalone:
        return inner
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="color-scheme" content="light dark">\n'
        # A personal training page on a public URL should not be indexed.
        # This is politeness to crawlers, not access control.
        '<meta name="robots" content="noindex, nofollow">\n'
        f'<title>{title}</title>\n'
        f'<style>{STYLE}</style>\n'
        '</head>\n<body>\n'
        f'{BODY}\n'
        f'<script>{script}</script>\n'
        '</body>\n</html>\n'
    )


def build(out: Path | str | None = None, standalone: bool = True, **kw) -> Path:
    activities = store.deduped(store.load_activities())
    # With nothing synced, ship the page with no payload at all: it then offers
    # the visitor its import screen instead of an empty dashboard.
    payload = build_payload(activities, **kw) if activities else None
    html = render(payload, standalone=standalone)

    # docs/ rather than site/: it is the folder GitHub Pages can serve straight
    # from a branch, so publishing works with or without the Actions workflow.
    out = Path(out) if out else config.ROOT / "docs" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out
