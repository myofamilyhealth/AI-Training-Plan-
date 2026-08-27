"""One normalised activity shape, whichever service it came from.

Strava and Garmin describe the same run with different keys and different
units. Everything is funnelled through `normalise_*` into a single dict so
analysis code never branches on source. Files are one-per-activity JSON, which
keeps git diffs readable and makes a single day easy to inspect by hand.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from . import config

# Strava's type strings and Garmin's typeKeys, mapped onto one vocabulary.
_TYPE_MAP = {
    "run": "running", "trailrun": "running", "virtualrun": "running",
    "running": "running", "trail_running": "running", "treadmill_running": "running",
    "indoor_running": "running", "track_running": "running",
    "ride": "cycling", "virtualride": "cycling", "gravelride": "cycling",
    "mountainbikeride": "cycling", "ebikeride": "cycling",
    "cycling": "cycling", "road_biking": "cycling", "indoor_cycling": "cycling",
    "mountain_biking": "cycling", "gravel_cycling": "cycling", "virtual_ride": "cycling",
    "swim": "swimming", "lap_swimming": "swimming", "open_water_swimming": "swimming",
    "swimming": "swimming",
    "walk": "walking", "walking": "walking", "hike": "hiking", "hiking": "hiking",
    "weighttraining": "strength", "strength_training": "strength",
}


def canonical_type(raw: str | None) -> str:
    if not raw:
        return "other"
    return _TYPE_MAP.get(str(raw).strip().lower().replace(" ", "_"), str(raw).strip().lower())


def _iso(value) -> str | None:
    """Everything becomes a UTC ISO-8601 string, so sorting is just string sorting."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000 if value > 1e11 else value, timezone.utc).isoformat()
    text = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return str(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _blank() -> dict:
    return {
        "id": None, "source": None, "source_id": None, "name": None, "type": None,
        "start": None, "date": None, "distance_m": None, "moving_s": None, "elapsed_s": None,
        "elevation_m": None, "avg_hr": None, "max_hr": None, "avg_watts": None,
        "avg_speed_mps": None, "calories": None, "device": None, "description": None,
        "raw_type": None,
    }


def normalise_strava(a: dict) -> dict:
    out = _blank()
    out.update(
        source="strava",
        source_id=str(a.get("id")),
        id=f"strava-{a.get('id')}",
        name=a.get("name"),
        raw_type=a.get("sport_type") or a.get("type"),
        type=canonical_type(a.get("sport_type") or a.get("type")),
        start=_iso(a.get("start_date")),
        date=str(a.get("start_date_local") or a.get("start_date") or "")[:10] or None,
        distance_m=a.get("distance"),
        moving_s=a.get("moving_time"),
        elapsed_s=a.get("elapsed_time"),
        elevation_m=a.get("total_elevation_gain"),
        avg_hr=a.get("average_heartrate"),
        max_hr=a.get("max_heartrate"),
        avg_watts=a.get("average_watts"),
        avg_speed_mps=a.get("average_speed"),
        calories=a.get("calories"),
        device=a.get("device_name"),
        description=a.get("description"),
    )
    return out


def normalise_garmin(a: dict) -> dict:
    type_key = (a.get("activityType") or {}).get("typeKey")
    out = _blank()
    out.update(
        source="garmin",
        source_id=str(a.get("activityId")),
        id=f"garmin-{a.get('activityId')}",
        name=a.get("activityName"),
        raw_type=type_key,
        type=canonical_type(type_key),
        start=_iso(a.get("startTimeGMT") or a.get("startTimeLocal")),
        # Garmin sends both clocks. The rider's own is the one that says
        # which day the ride belongs to: an evening ride in Denver is
        # tomorrow in GMT, and would be filed under a day it never happened.
        date=str(a.get("startTimeLocal") or a.get("startTimeGMT") or "")[:10] or None,
        distance_m=a.get("distance"),
        moving_s=a.get("movingDuration") or a.get("duration"),
        elapsed_s=a.get("elapsedDuration") or a.get("duration"),
        elevation_m=a.get("elevationGain"),
        avg_hr=a.get("averageHR"),
        max_hr=a.get("maxHR"),
        avg_watts=a.get("avgPower"),
        avg_speed_mps=a.get("averageSpeed"),
        calories=a.get("calories"),
        device=a.get("deviceId"),
        description=a.get("description"),
    )
    return out


# --------------------------------------------------------------------------- disk

def _path_for(act: dict) -> Path:
    day = (act.get("date") or act.get("start") or "unknown")[:10]
    return config.ACTIVITIES / f"{day}-{act['id']}.json"


def save_activity(act: dict) -> Path:
    config.ensure_dirs()
    path = _path_for(act)
    path.write_text(json.dumps(act, indent=2, sort_keys=True))
    return path


def load_activities() -> list[dict]:
    config.ensure_dirs()
    out = []
    for path in sorted(config.ACTIVITIES.glob("*.json")):
        try:
            out.append(json.loads(path.read_text()))
        except json.JSONDecodeError:
            continue
    out.sort(key=lambda a: a.get("start") or "")
    return out


def _dedupe_key(act: dict) -> tuple | None:
    """Two records are the same session if they start within a couple of minutes
    and cover a similar distance. Watch and phone rarely agree to the second,
    so an exact timestamp match would miss almost every real duplicate."""
    if not act.get("start"):
        return None
    try:
        dt = datetime.fromisoformat(act["start"])
    except ValueError:
        return None
    bucket = int(dt.timestamp() // 150)          # 2.5-minute buckets
    dist = round((act.get("distance_m") or 0) / 500)
    return (act.get("type"), bucket, dist)


def find_duplicates(activities: list[dict]) -> dict[tuple, list[dict]]:
    groups: dict[tuple, list[dict]] = {}
    for act in activities:
        key = _dedupe_key(act)
        if key is None:
            continue
        groups.setdefault(key, []).append(act)
    return {k: v for k, v in groups.items() if len(v) > 1}


def deduped(activities: list[dict], prefer: str = "garmin") -> list[dict]:
    """Collapse the same session recorded by both services.

    Garmin wins by default: it is the device that measured the run, so its HR
    and elevation are first-hand where Strava's are a re-upload.
    """
    best: dict[tuple, dict] = {}
    loose: list[dict] = []
    for act in activities:
        key = _dedupe_key(act)
        if key is None:
            loose.append(act)
            continue
        current = best.get(key)
        if current is None:
            best[key] = act
        elif act.get("source") == prefer and current.get("source") != prefer:
            best[key] = act
    out = list(best.values()) + loose
    out.sort(key=lambda a: a.get("start") or "")
    return out
