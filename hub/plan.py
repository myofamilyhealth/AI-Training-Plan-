"""Training plans as markdown you can read, edit, and push to the watch.

The split is deliberate: designing a plan is judgement, so Claude writes the
file. Executing it is mechanical, so this module parses the file and puts each
session on your Garmin calendar. That means a plan stays reviewable and
hand-editable — it never becomes an opaque row in someone's database.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

from . import config, workout as W

_FRONTMATTER_RE = re.compile(r"^---\s*\n(?P<body>.*?)\n---\s*\n", re.S)
_WEEK_RE = re.compile(r"^##\s+Week\s+(?P<n>\d+)\s*(?:[—–-]\s*(?P<label>.*?))?\s*$", re.I | re.M)
_DAY_RE = re.compile(r"^###\s+(?P<day>[A-Za-z]{3,9})\s*(?:[—–-]\s*(?P<label>.*?))?\s*$", re.I | re.M)
_FENCE_RE = re.compile(r"```workout\s*\n(?P<body>.*?)```", re.S)

_WEEKDAYS = {d: i for i, d in enumerate(
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])}
_WEEKDAYS.update({d[:3]: i for d, i in list(_WEEKDAYS.items())})


@dataclass
class Day:
    weekday: str
    label: str | None = None
    workout_text: str | None = None      # DSL, when it's a structured session
    descriptor: str | None = None        # prose, for easy/long days
    date: date | None = None


@dataclass
class Week:
    number: int
    label: str | None = None
    focus: str | None = None
    days: list[Day] = field(default_factory=list)


@dataclass
class Plan:
    name: str = "Training Plan"
    meta: dict = field(default_factory=dict)
    weeks: list[Week] = field(default_factory=list)
    path: Path | None = None

    @property
    def start_date(self) -> date | None:
        raw = self.meta.get("start_date")
        if raw:
            return date.fromisoformat(str(raw))
        # Work backwards from the race so week 1 lands correctly.
        race, weeks = self.meta.get("race_date"), len(self.weeks)
        if race and weeks:
            race_day = date.fromisoformat(str(race))
            race_monday = race_day - timedelta(days=race_day.weekday())
            return race_monday - timedelta(weeks=weeks - 1)
        return None


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group("body").splitlines():
        if ":" in line and not line.strip().startswith("#"):
            key, _, value = line.partition(":")
            meta[key.strip().lower()] = value.strip().strip('"').strip("'")
    return meta, text[m.end():]


def parse(text: str, path: Path | None = None) -> Plan:
    meta, body = _parse_frontmatter(text)
    plan = Plan(name=meta.get("name", "Training Plan"), meta=meta, path=path)

    week_marks = list(_WEEK_RE.finditer(body))
    for i, mark in enumerate(week_marks):
        chunk = body[mark.end(): week_marks[i + 1].start() if i + 1 < len(week_marks) else len(body)]
        week = Week(number=int(mark.group("n")), label=(mark.group("label") or "").strip() or None)

        focus = re.search(r"^focus:\s*(?P<t>.+)$", chunk, re.I | re.M)
        if focus:
            week.focus = focus.group("t").strip()

        day_marks = list(_DAY_RE.finditer(chunk))
        for j, day_mark in enumerate(day_marks):
            day_chunk = chunk[day_mark.end(): day_marks[j + 1].start() if j + 1 < len(day_marks) else len(chunk)]
            day = Day(weekday=day_mark.group("day").strip().lower(),
                      label=(day_mark.group("label") or "").strip() or None)
            fence = _FENCE_RE.search(day_chunk)
            if fence:
                day.workout_text = fence.group("body").strip()
            else:
                prose = [ln.strip() for ln in day_chunk.strip().splitlines()
                         if ln.strip() and not ln.strip().startswith("#")]
                day.descriptor = prose[0] if prose else None
            week.days.append(day)

        plan.weeks.append(week)

    _assign_dates(plan)
    return plan


def _assign_dates(plan: Plan) -> None:
    start = plan.start_date
    if not start:
        return
    monday = start - timedelta(days=start.weekday())
    for week in plan.weeks:
        week_monday = monday + timedelta(weeks=week.number - 1)
        for day in week.days:
            offset = _WEEKDAYS.get(day.weekday)
            if offset is not None:
                day.date = week_monday + timedelta(days=offset)


def load(path: str | Path) -> Plan:
    path = Path(path)
    if not path.exists():
        candidate = config.TRAINING / "plans" / path.name
        if candidate.exists():
            path = candidate
        else:
            raise SystemExit(f"No plan at {path}")
    return parse(path.read_text(), path=path)


def latest() -> Plan | None:
    plans = sorted((config.TRAINING / "plans").glob("*.md"))
    return load(plans[-1]) if plans else None


def current_week(plan: Plan, on: date | None = None) -> Week | None:
    on = on or date.today()
    for week in plan.weeks:
        days = [d.date for d in week.days if d.date]
        if days and min(days) - timedelta(days=min(days).weekday()) <= on <= max(days) + timedelta(days=2):
            return week
    return None


def describe(plan: Plan, weeks: int | None = None) -> str:
    lines = [plan.name]
    if plan.meta.get("race_date"):
        race = date.fromisoformat(str(plan.meta["race_date"]))
        days_out = (race - date.today()).days
        goal = plan.meta.get("goal", "race")
        target = f", target {plan.meta['target_time']}" if plan.meta.get("target_time") else ""
        lines.append(f"{goal} on {race} — {days_out} days away{target}")
    lines.append("=" * 60)

    today = date.today()
    shown = plan.weeks[:weeks] if weeks else plan.weeks
    for week in shown:
        header = f"Week {week.number}"
        if week.label:
            header += f" — {week.label}"
        dates = [d.date for d in week.days if d.date]
        if dates:
            header += f"   ({min(dates)} → {max(dates)})"
        marker = "  <- this week" if any(d and abs((d - today).days) < 4 for d in dates) else ""
        lines += ["", header + marker]
        if week.focus:
            lines.append(f"  focus: {week.focus}")
        for day in week.days:
            when = day.date.strftime("%a %m-%d") if day.date else day.weekday[:3].title()
            what = day.label or ""
            if day.workout_text:
                first = day.workout_text.splitlines()
                what = f"{what} ({len(first)} steps)" if what else f"{len(first)}-step session"
            elif day.descriptor:
                what = f"{what}: {day.descriptor}" if what else day.descriptor
            lines.append(f"    {when}  {what}")
    return "\n".join(lines)


def build_workouts(week: Week, sport: str = "running") -> list[tuple[Day, W.Workout]]:
    """Compile a week's fenced sessions into watch-ready workouts."""
    out = []
    for day in week.days:
        if not day.workout_text:
            continue
        name = day.label or f"{day.weekday.title()} session"
        out.append((day, W.parse(day.workout_text, name=name, sport=sport)))
    return out
