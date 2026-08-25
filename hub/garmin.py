"""Garmin Connect — activities, wellness, and pushing workouts to the watch.

A caveat worth stating plainly: Garmin has no public consumer API. This talks
to the same private endpoints the Connect app uses, via `garth` for the login
handshake. Garmin changed that handshake in March 2026 and `garth` is no longer
maintained, so treat this module as the part most likely to need a fix someday.
Reading is duplicated through Strava on purpose — if Garmin login breaks, you
lose workout push, not your training history.
"""
from __future__ import annotations

import warnings
from datetime import date, timedelta

warnings.filterwarnings("ignore", category=DeprecationWarning, module="garth")

from . import config, store

_TOKEN_DIR = config.SECRETS / "garmin"

# garth defaults to an Android user-agent. Garmin's edge has been inconsistent
# about that since the auth change, and a desktop string is the workaround the
# community landed on, so it is set on every client this module builds.
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _garth():
    import garth

    try:
        garth.client.sess.headers.update({"User-Agent": _UA})
    except Exception:
        pass
    return garth


def login(email: str | None = None, password: str | None = None) -> str:
    """Interactive first-time login. Prompts for an MFA code when Garmin asks."""
    garth = _garth()
    email = email or config.get("GARMIN_EMAIL", required=True)
    password = password or config.get("GARMIN_PASSWORD", required=True)
    garth.login(email, password)
    _TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    garth.save(str(_TOKEN_DIR))
    try:
        _TOKEN_DIR.chmod(0o700)
    except OSError:
        pass
    return garth.client.username


def client():
    """Resume from stored tokens, falling back to a fresh login."""
    garth = _garth()
    if _TOKEN_DIR.exists():
        try:
            garth.resume(str(_TOKEN_DIR))
            # Tokens last about a year but the OAuth2 half expires hourly;
            # touching the profile forces garth to refresh it if stale.
            _ = garth.client.username
            return garth
        except Exception:
            pass
    if config.get("GARMIN_EMAIL") and config.get("GARMIN_PASSWORD"):
        login()
        return _garth()
    raise SystemExit("Garmin is not connected yet — run:  ./wk auth garmin")


def _display_name(garth) -> str:
    return garth.client.profile["displayName"]


# --------------------------------------------------------------------------- read

def list_activities(limit: int = 100, start: int = 0) -> list[dict]:
    garth = client()
    return garth.connectapi(
        "/activitylist-service/activities/search/activities",
        params={"start": start, "limit": limit},
    ) or []


def get_activity(activity_id: str) -> dict:
    return client().connectapi(f"/activity-service/activity/{activity_id}")


def get_activity_details(activity_id: str, max_points: int = 2000) -> dict:
    """Per-second-ish samples: HR, pace, elevation, cadence, power."""
    return client().connectapi(
        f"/activity-service/activity/{activity_id}/details",
        params={"maxChartSize": max_points, "maxPolylineSize": max_points},
    )


def sleep(day: date | str) -> dict | None:
    garth = client()
    day = str(day)
    return garth.connectapi(
        f"/wellness-service/wellness/dailySleepData/{_display_name(garth)}",
        params={"date": day, "nonSleepBufferMinutes": 60},
    )


def hrv(day: date | str) -> dict | None:
    return client().connectapi(f"/hrv-service/hrv/{day}")


def daily_summary(day: date | str) -> dict | None:
    """Steps, resting HR, body battery, stress and intensity minutes for a day."""
    garth = client()
    return garth.connectapi(
        f"/usersummary-service/usersummary/daily/{_display_name(garth)}",
        params={"calendarDate": str(day)},
    )


def training_readiness(day: date | str) -> list | dict | None:
    return client().connectapi(f"/metrics-service/metrics/trainingreadiness/{day}")


def sync(limit: int = 200, verbose: bool = True) -> int:
    raw = list_activities(limit=limit)
    for a in raw:
        store.save_activity(store.normalise_garmin(a))
    if verbose:
        print(f"  garmin: {len(raw)} activities")
    return len(raw)


def sync_wellness(days: int = 30, verbose: bool = True) -> int:
    """Wellness is one request per day per metric, so this stays deliberately
    short-range. Re-running it is cheap: existing days are skipped."""
    import json

    config.ensure_dirs()
    written = 0
    today = date.today()
    for offset in range(days):
        day = today - timedelta(days=offset)
        path = config.WELLNESS / f"{day}.json"
        if path.exists():
            continue
        record: dict = {"date": str(day)}
        for key, fn in (("sleep", sleep), ("hrv", hrv), ("summary", daily_summary)):
            try:
                record[key] = fn(day)
            except Exception as exc:                      # one bad day must not stop the sync
                record[key] = {"error": f"{type(exc).__name__}: {exc}"}
        path.write_text(json.dumps(record, indent=2, sort_keys=True))
        written += 1
    if verbose:
        print(f"  garmin wellness: {written} new days")
    return written


# --------------------------------------------------------------------------- write

def list_workouts(limit: int = 50) -> list[dict]:
    return client().connectapi(
        "/workout-service/workouts", params={"start": 1, "limit": limit}
    ) or []


def create_workout(payload: dict) -> dict:
    """POST a Garmin workout document. Returns the created workout, with its id."""
    return client().connectapi(
        "/workout-service/workout", method="POST", json=payload
    )


def delete_workout(workout_id: str | int) -> None:
    client().connectapi(f"/workout-service/workout/{workout_id}", method="DELETE")


def schedule_workout(workout_id: str | int, day: date | str) -> dict:
    """Put a saved workout on the calendar so the watch picks it up that morning."""
    return client().connectapi(
        f"/workout-service/schedule/{workout_id}",
        method="POST",
        json={"date": str(day)},
    )
