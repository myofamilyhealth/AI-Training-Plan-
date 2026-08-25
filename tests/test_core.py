"""Tests for the parts that would silently corrupt a workout if they broke.

Run with `python3 tests/test_core.py` or `pytest tests/`.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hub import analyze, store, workout as W
from hub.units import (
    ParseError, format_duration, format_pace, parse_distance,
    parse_duration, parse_pace, parse_pace_range,
)

failures: list[str] = []


def check(label, got, want):
    if got != want:
        failures.append(f"{label}: got {got!r}, wanted {want!r}")


def close(label, got, want, tol=0.01):
    if got is None or abs(got - want) > tol:
        failures.append(f"{label}: got {got!r}, wanted ~{want!r}")


# ------------------------------------------------------------------ units
check("800m", parse_distance("800m"), 800.0)
check("5k", parse_distance("5k"), 5000.0)
close("1.5mi", parse_distance("1.5mi"), 2414.02)
check("400yd", round(parse_distance("400yd"), 1), 365.8)
check("90s", parse_duration("90s"), 90.0)
check("2min", parse_duration("2min"), 120.0)
check("1:30 is mm:ss", parse_duration("1:30"), 90)
check("1:05:00 is hh:mm:ss", parse_duration("1:05:00"), 3900)
close("7:30/mi", parse_pace("7:30/mi"), 3.5763)
close("4:00/km", parse_pace("4:00/km"), 4.1667)
check("pace round-trips", format_pace(parse_pace("6:45/mi")), "6:45/mi")
check("duration round-trips", format_duration(3725), "1:02:05")

low, high = parse_pace_range("7:00-7:30/mi")
check("range is ordered slow to fast", low < high, True)
close("range low is 7:30", low, parse_pace("7:30/mi"))
close("range high is 7:00", high, parse_pace("7:00/mi"))

for bad in ("banana", "", "fast"):
    try:
        parse_distance(bad)
        failures.append(f"parse_distance({bad!r}) should have raised")
    except ParseError:
        pass

# ------------------------------------------------------------------ workout DSL
w = W.parse(
    "warmup 10min @ 9:00-9:30/mi\n6x(800m @ 6:30/mi / 90s jog)\ncooldown 1mi",
    name="Test",
)
check("three top-level items", len(w.steps), 3)
check("middle is a repeat", isinstance(w.steps[1], W.Repeat), True)
check("six reps", w.steps[1].iterations, 6)
check("two steps per rep", len(w.steps[1].steps), 2)
check("work step first", w.steps[1].steps[0].role, "interval")
check("recovery second", w.steps[1].steps[1].role, "recovery")
check("recovery left unpaced", w.steps[1].steps[1].target, None)
check("warmup role detected", w.steps[0].role, "warmup")
check("cooldown role detected", w.steps[2].role, "cooldown")
check("cooldown goal is distance", w.steps[2].goal_kind, "distance")

# The slash inside a pace must not split the step.
w2 = W.parse("3x(1mi @ 7:00/mi / 3min jog)")
check("pace slash survives splitting", len(w2.steps[0].steps), 2)
close("interval pace parsed", w2.steps[0].steps[0].target[1], parse_pace("7:00/mi") * 1.02)

# HR zones are a distinct target kind.
w3 = W.parse("20min @ zone 4")
check("zone captured", w3.steps[0].hr_zone, 4)
check("zone sets no pace target", w3.steps[0].target, None)

# Lap-button steps.
w4 = W.parse("lap @ easy")
check("lap goal", w4.steps[0].goal_kind, "lap.button")

# ------------------------------------------------------------------ Garmin JSON
doc = W.to_garmin(w)
steps = doc["workoutSegments"][0]["workoutSteps"]
check("sport id", doc["sportType"]["sportTypeId"], 1)
check("three top steps", len(steps), 3)
check("repeat DTO type", steps[1]["type"], "RepeatGroupDTO")
check("repeat before children", steps[1]["stepOrder"], 2)
check("children numbered after group",
      [s["stepOrder"] for s in steps[1]["workoutSteps"]], [3, 4])
check("cooldown last", steps[2]["stepOrder"], 5)
check("children share childStepId",
      {s["childStepId"] for s in steps[1]["workoutSteps"]}, {steps[1]["childStepId"]})
iv = steps[1]["workoutSteps"][0]
check("interval ends on distance", iv["endCondition"]["conditionTypeKey"], "distance")
check("interval distance in metres", iv["endConditionValue"], 800.0)
check("pace target type", iv["targetType"]["workoutTargetTypeKey"], "pace.zone")
check("pace bounds ordered", iv["targetValueOne"] < iv["targetValueTwo"], True)
check("unpaced recovery has no target",
      steps[1]["workoutSteps"][1]["targetType"]["workoutTargetTypeKey"], "no.target")
check("iterations end condition", steps[1]["endCondition"]["conditionTypeKey"], "iterations")

zone_doc = W.to_garmin(w3)["workoutSegments"][0]["workoutSteps"][0]
check("zone target type", zone_doc["targetType"]["workoutTargetTypeKey"], "heart.rate.zone")
check("zone number carried", zone_doc["zoneNumber"], 4)

lap_doc = W.to_garmin(w4)["workoutSegments"][0]["workoutSteps"][0]
check("lap end condition", lap_doc["endCondition"]["conditionTypeKey"], "lap.button")
check("lap has no end value", lap_doc["endConditionValue"], None)

# ------------------------------------------------------------------ store
base = datetime(2026, 8, 19, 13, 0, 0, tzinfo=timezone.utc)
g = store.normalise_garmin({
    "activityId": 1, "activityName": "Run", "activityType": {"typeKey": "running"},
    "startTimeGMT": base.strftime("%Y-%m-%d %H:%M:%S"),
    "distance": 10021.0, "duration": 2740, "movingDuration": 2740,
    "averageSpeed": 3.657, "averageHR": 142})
s = store.normalise_strava({
    "id": 2, "name": "Run", "sport_type": "Run",
    "start_date": (base + timedelta(seconds=40)).isoformat().replace("+00:00", "Z"),
    "distance": 9994.0, "moving_time": 2738, "average_speed": 3.65,
    "average_heartrate": 142.0})
other = store.normalise_strava({
    "id": 3, "name": "Second run", "sport_type": "Run",
    "start_date": (base + timedelta(seconds=30)).isoformat().replace("+00:00", "Z"),
    "distance": 4000.0, "moving_time": 1200, "average_speed": 3.33})

check("types normalise together", (g["type"], s["type"]), ("running", "running"))
check("same session collapses", len(store.deduped([g, s])), 1)
check("garmin wins the tie", store.deduped([g, s])[0]["source"], "garmin")
check("different distances stay apart", len(store.deduped([g, s, other])), 2)
check("ride maps to cycling", store.canonical_type("VirtualRide"), "cycling")
check("lap swim maps to swimming", store.canonical_type("lap_swimming"), "swimming")

# ------------------------------------------------------------------ analysis
check("hard run outloads easy run",
      analyze.training_load({"moving_s": 3600, "avg_hr": 170}) >
      analyze.training_load({"moving_s": 3600, "avg_hr": 130}), True)
check("no-HR activity still scores",
      analyze.training_load({"moving_s": 3600, "avg_speed_mps": 3.3}) > 0, True)
check("zero-length activity scores zero",
      analyze.training_load({"moving_s": 0, "avg_hr": 150}), 0.0)

today = datetime.now(timezone.utc).date()
steady = [{"id": f"a{i}", "type": "running", "source": "garmin",
           "start": (datetime.now(timezone.utc) - timedelta(days=i)).isoformat(),
           "distance_m": 10000, "moving_s": 3000, "avg_speed_mps": 3.33, "avg_hr": 140}
          for i in range(28)]
ratio = analyze.acwr(steady)
check("steady training reads sustainable", ratio["verdict"], "sustainable")
close("steady ratio near 1", ratio["ratio"], 1.0, tol=0.15)

spike = [a for a in steady if int(a["id"][1:]) >= 7]
spike += [{"id": f"s{i}", "type": "running", "source": "garmin",
           "start": (datetime.now(timezone.utc) - timedelta(days=i)).isoformat(),
           "distance_m": 25000, "moving_s": 8000, "avg_speed_mps": 3.1, "avg_hr": 165}
          for i in range(7)]
check("a big week reads as a spike", analyze.acwr(spike)["ratio"] > 1.3, True)

split = analyze.easy_hard_split(steady)
check("all-easy block is 100% easy", split["easy_pct"], 100.0)
check("no-HR data is reported, not guessed",
      analyze.easy_hard_split([{"type": "running", "moving_s": 3600}])["note"] is not None, True)

# ------------------------------------------------------------------ dashboard
from hub import web

payload = web.build_payload(steady, weeks=6, heatmap_weeks=4)
check("payload carries every activity", len(payload["activities"]), len(steady))
check("weekly buckets requested", len(payload["weekly"]), 6)
check("exactly one week is in progress",
      sum(1 for w in payload["weekly"] if w["partial"]), 1)
check("the in-progress week is the last one", payload["weekly"][-1]["partial"], True)
check("heatmap is whole days", len(payload["heatmap"]) % 1, 0)
check("heatmap starts on a Monday",
      datetime.fromisoformat(payload["heatmap"][0]["date"]).weekday(), 0)
check("acwr rides along", "ratio" in payload["acwr"], True)
check("unit is declared", payload["unit"] in ("mi", "km"), True)

html = web.render(payload, standalone=True)
check("renders a full document", html.startswith("<!doctype html>"), True)
check("payload is embedded", '"weekly"' in html, True)
check("no unreplaced marker", "__PAYLOAD__" in html, False)
check("closing script tag is escaped out of the data", "</script>" in html.split("<script>")[1][:-20], False)
check("both theme scopes defined",
      ('prefers-color-scheme: dark' in html) and ('[data-theme="dark"]' in html), True)

fragment = web.render(payload, standalone=False)
check("fragment has no document skeleton", "<!doctype" in fragment.lower(), False)
check("fragment still has a title", "<title>" in fragment, True)

empty = web.build_payload([], weeks=4)
check("empty payload has no activities", empty["totals"]["activities"], 0)
check("empty payload still renders", "<!doctype html>" in web.render(empty), True)

# ------------------------------------------------------------------ report
if failures:
    print(f"FAILED ({len(failures)})")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("all checks passed")
