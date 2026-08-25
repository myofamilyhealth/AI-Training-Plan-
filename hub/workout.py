"""Write a workout the way you'd say it out loud; get one the watch can run.

    warmup 10min @ easy
    6x(800m @ 5k pace / 90s jog)
    cooldown 10min @ easy

That text is the whole interface. It parses into a step tree, and the tree
renders either as a summary you can read or as the JSON document Garmin's
workout service expects.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import config
from .units import (
    ParseError, format_distance, format_duration, format_pace,
    parse_distance, parse_duration, parse_pace_range,
)

# ---------------------------------------------------------------- Garmin enums
# These ids are Garmin's, not ours; they are what the workout service validates
# against, so they are written out explicitly rather than computed.
STEP_TYPES = {
    "warmup": 1, "cooldown": 2, "interval": 3,
    "recovery": 4, "rest": 5, "repeat": 6, "other": 7,
}
END_CONDITIONS = {"lap.button": 1, "time": 2, "distance": 3, "iterations": 7}
TARGET_TYPES = {
    "no.target": 1, "power.zone": 2, "cadence": 3,
    "heart.rate.zone": 4, "speed.zone": 5, "pace.zone": 6,
}
SPORTS = {
    "running": 1, "cycling": 2, "other": 3, "swimming": 4,
    "strength_training": 5, "cardio_training": 6,
}

# Words that mean "go easy" without naming a pace, mapped to the step role.
_ROLE_WORDS = {
    "warmup": "warmup", "warm-up": "warmup", "wu": "warmup",
    "cooldown": "cooldown", "cool-down": "cooldown", "cd": "cooldown",
    "recovery": "recovery", "jog": "recovery", "float": "recovery",
    "rest": "rest", "standing": "rest", "walk": "recovery",
}


@dataclass
class Step:
    role: str = "interval"
    goal_kind: str = "distance"        # distance | time | lap.button
    goal_value: float = 0.0            # metres or seconds
    target: tuple[float, float] | None = None   # (slower_mps, faster_mps)
    hr_zone: int | None = None
    label: str | None = None
    note: str | None = None


@dataclass
class Repeat:
    iterations: int = 1
    steps: list = field(default_factory=list)


@dataclass
class Workout:
    name: str = "Workout"
    sport: str = "running"
    steps: list = field(default_factory=list)
    notes: str | None = None


# --------------------------------------------------------------------- parsing

_REPEAT_RE = re.compile(r"^\s*(?P<n>\d+)\s*[x×]\s*\((?P<body>.+)\)\s*$", re.I)
_LEADING_ROLE_RE = re.compile(r"^\s*(?P<word>[a-z][a-z-]*)\s+(?P<rest>.+)$", re.I)
_ZONE_RE = re.compile(r"^\s*(?:hr\s*)?zone\s*(?P<n>[1-5])\s*$", re.I)


def _resolve_target(text: str) -> tuple[tuple[float, float] | None, int | None]:
    """A target is a pace, a pace range, an HR zone, or a name from paces.md."""
    text = text.strip()
    if not text:
        return None, None

    zone = _ZONE_RE.match(text)
    if zone:
        return None, int(zone.group("n"))

    try:
        return parse_pace_range(text), None
    except ParseError:
        pass

    # Named effort: look it up in training/paces.md, tolerating a trailing "pace".
    names = config.named_paces()
    key = text.lower().strip()
    for candidate in (key, key.removesuffix(" pace").strip()):
        if candidate in names:
            return parse_pace_range(names[candidate]), None

    known = ", ".join(sorted(names)) or "(training/paces.md has no paces yet)"
    raise ParseError(
        f"don't know the effort {text!r}. Give a pace like '7:30/mi', an HR "
        f"zone like 'zone 4', or one of: {known}"
    )


def _parse_goal(text: str) -> tuple[str, float, str]:
    text = text.strip()
    if text.lower() in ("lap", "until lap", "lap button", "open"):
        return "lap.button", 0.0, "until lap"
    try:
        return "distance", parse_distance(text), text
    except ParseError:
        pass
    try:
        return "time", parse_duration(text), text
    except ParseError:
        pass
    raise ParseError(f"cannot read {text!r} as a distance or a duration")


def parse_step(text: str, default_role: str = "interval") -> Step:
    text = text.strip().rstrip(",")
    if not text:
        raise ParseError("empty step")

    goal_text, _, target_text = text.partition("@")
    goal_text = goal_text.strip()

    role = default_role
    m = _LEADING_ROLE_RE.match(goal_text)
    if m and m.group("word").lower() in _ROLE_WORDS:
        role = _ROLE_WORDS[m.group("word").lower()]
        goal_text = m.group("rest").strip()
    else:
        # A trailing role word: "90s jog", "2min easy".
        parts = goal_text.split()
        if len(parts) > 1 and parts[-1].lower() in _ROLE_WORDS:
            role = _ROLE_WORDS[parts[-1].lower()]
            goal_text = " ".join(parts[:-1])

    kind, value, label = _parse_goal(goal_text)
    target, zone = _resolve_target(target_text) if target_text.strip() else (None, None)

    # An unpaced recovery is intentional — you should jog it by feel, not chase
    # a number — so no target is inferred for those roles.
    return Step(role=role, goal_kind=kind, goal_value=value,
                target=target, hr_zone=zone, label=label)


# A bare "/" also lives inside a pace ("6:30/mi"), so only a slash with space
# around it — or a comma — separates one step from the next.
_SEP_RE = re.compile(r"\s+/\s+|\s*,\s*")


def _split_top_level(text: str) -> list[str]:
    """Split a repeat body into steps, ignoring separators inside parentheses."""
    out, depth, current = [], 0, ""
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if depth == 0:
            m = _SEP_RE.match(text, i)
            if m and m.end() > m.start():
                out.append(current)
                current = ""
                i = m.end()
                continue
        current += ch
        i += 1
    out.append(current)
    return [p for p in (s.strip() for s in out) if p]


def parse(text: str, name: str | None = None, sport: str = "running") -> Workout:
    steps: list = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        m = _REPEAT_RE.match(line)
        if m:
            inner = _split_top_level(m.group("body"))
            if not inner:
                raise ParseError(f"empty repeat block: {line!r}")
            children = [
                parse_step(part, default_role="interval" if i == 0 else "recovery")
                for i, part in enumerate(inner)
            ]
            steps.append(Repeat(iterations=int(m.group("n")), steps=children))
            continue

        steps.append(parse_step(line))

    if not steps:
        raise ParseError("no steps found — see `./wk workout --help` for the format")
    return Workout(name=name or "Workout", sport=sport, steps=steps)


# ------------------------------------------------------------------- rendering

def _totals(steps: list) -> tuple[float, float]:
    """Best-effort (metres, seconds). Distance steps with a pace target
    contribute an estimated time, and vice versa, so a mixed workout still
    gets a usable total."""
    metres = seconds = 0.0
    for item in steps:
        if isinstance(item, Repeat):
            d, s = _totals(item.steps)
            metres += d * item.iterations
            seconds += s * item.iterations
            continue
        mid = (sum(item.target) / 2) if item.target else None
        if item.goal_kind == "distance":
            metres += item.goal_value
            if mid:
                seconds += item.goal_value / mid
        elif item.goal_kind == "time":
            seconds += item.goal_value
            if mid:
                metres += item.goal_value * mid
    return metres, seconds


def describe(workout: Workout, imperial: bool | None = None) -> str:
    imperial = config.imperial() if imperial is None else imperial

    def goal_str(step: Step) -> str:
        if step.goal_kind == "lap.button":
            return "until lap"
        if step.goal_kind == "distance":
            return format_distance(step.goal_value, imperial)
        return format_duration(step.goal_value)

    def target_str(step: Step) -> str:
        if step.hr_zone:
            return f" @ HR zone {step.hr_zone}"
        if not step.target:
            return ""
        low, high = step.target
        if abs(high - low) / max(high, 1e-9) < 0.05:
            return f" @ {format_pace((low + high) / 2, imperial)}"
        # high m/s is the faster pace; conventional notation leads with it.
        fast = format_pace(high, imperial)
        slow = format_pace(low, imperial)
        return f" @ {fast.rsplit('/', 1)[0]}–{slow}"

    lines = [f"{workout.name}  ({workout.sport})"]
    for item in workout.steps:
        if isinstance(item, Repeat):
            lines.append(f"  {item.iterations}x")
            for child in item.steps:
                lines.append(f"      {child.role:<9} {goal_str(child)}{target_str(child)}")
        else:
            lines.append(f"  {item.role:<9} {goal_str(item)}{target_str(item)}")

    metres, seconds = _totals(workout.steps)
    lines.append("")
    lines.append(f"  ≈ {format_distance(metres, imperial)} in {format_duration(seconds)}")
    return "\n".join(lines)


# -------------------------------------------------------------- Garmin document

def _executable(step: Step, order: int, child_id: int | None) -> dict:
    if step.hr_zone:
        target = {"targetType": {"workoutTargetTypeId": TARGET_TYPES["heart.rate.zone"],
                                 "workoutTargetTypeKey": "heart.rate.zone"},
                  "zoneNumber": step.hr_zone,
                  "targetValueOne": None, "targetValueTwo": None}
    elif step.target:
        low, high = step.target
        # pace.zone carries speed in m/s, ordered low to high.
        target = {"targetType": {"workoutTargetTypeId": TARGET_TYPES["pace.zone"],
                                 "workoutTargetTypeKey": "pace.zone"},
                  "targetValueOne": round(low, 4), "targetValueTwo": round(high, 4),
                  "zoneNumber": None}
    else:
        target = {"targetType": {"workoutTargetTypeId": TARGET_TYPES["no.target"],
                                 "workoutTargetTypeKey": "no.target"},
                  "targetValueOne": None, "targetValueTwo": None, "zoneNumber": None}

    if step.goal_kind == "lap.button":
        end = {"conditionTypeId": END_CONDITIONS["lap.button"], "conditionTypeKey": "lap.button"}
        end_value = None
    else:
        key = "distance" if step.goal_kind == "distance" else "time"
        end = {"conditionTypeId": END_CONDITIONS[key], "conditionTypeKey": key}
        end_value = round(step.goal_value, 2)

    return {
        "type": "ExecutableStepDTO",
        "stepId": None,
        "stepOrder": order,
        "stepType": {"stepTypeId": STEP_TYPES[step.role], "stepTypeKey": step.role},
        "childStepId": child_id,
        "description": step.note,
        "endCondition": end,
        "endConditionValue": end_value,
        "endConditionCompare": None,
        "endConditionZone": None,
        **target,
    }


def to_garmin(workout: Workout) -> dict:
    sport_id = SPORTS.get(workout.sport, SPORTS["running"])
    sport = {"sportTypeId": sport_id, "sportTypeKey": workout.sport}

    steps: list[dict] = []
    order = 1
    child_seq = 1

    for item in workout.steps:
        if isinstance(item, Repeat):
            child_id = child_seq
            child_seq += 1
            group_order = order
            order += 1
            children = []
            for child in item.steps:
                children.append(_executable(child, order, child_id))
                order += 1
            steps.append({
                "type": "RepeatGroupDTO",
                "stepId": None,
                "stepOrder": group_order,
                "stepType": {"stepTypeId": STEP_TYPES["repeat"], "stepTypeKey": "repeat"},
                "childStepId": child_id,
                "numberOfIterations": item.iterations,
                "smartRepeat": False,
                "endCondition": {"conditionTypeId": END_CONDITIONS["iterations"],
                                 "conditionTypeKey": "iterations"},
                "endConditionValue": float(item.iterations),
                "workoutSteps": children,
            })
        else:
            steps.append(_executable(item, order, None))
            order += 1

    return {
        "sportType": sport,
        "workoutName": workout.name,
        "description": workout.notes,
        "workoutSegments": [{
            "segmentOrder": 1,
            "sportType": sport,
            "workoutSteps": steps,
        }],
    }
