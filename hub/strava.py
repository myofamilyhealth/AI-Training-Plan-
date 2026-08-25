"""Strava, straight from the public API — no middleman service involved.

You register your own API application once (README explains it), which means
the token is yours, the rate limit is yours, and nobody else is between you and
your history.
"""
from __future__ import annotations

import time
import webbrowser

from . import config, store
from .http import request

API = "https://www.strava.com/api/v3"
OAUTH = "https://www.strava.com/oauth"
SCOPE = "activity:read_all,profile:read_all"
REDIRECT = "http://localhost/exchange_token"


def authorize_url() -> str:
    client_id = config.get("STRAVA_CLIENT_ID", required=True)
    from urllib.parse import urlencode

    return f"{OAUTH}/authorize?" + urlencode(
        {
            "client_id": client_id,
            "redirect_uri": REDIRECT,
            "response_type": "code",
            "approval_prompt": "force",
            "scope": SCOPE,
        }
    )


def exchange_code(code: str) -> dict:
    payload = request(
        f"{OAUTH}/token",
        method="POST",
        form={
            "client_id": config.get("STRAVA_CLIENT_ID", required=True),
            "client_secret": config.get("STRAVA_CLIENT_SECRET", required=True),
            "code": code,
            "grant_type": "authorization_code",
        },
    )
    config.write_secret("strava", payload)
    return payload


def access_token() -> str:
    """Return a live token, refreshing it when it is within five minutes of expiry."""
    tok = config.read_secret("strava")
    if not tok:
        raise SystemExit("Strava is not connected yet — run:  ./wk auth strava")
    if tok.get("expires_at", 0) - 300 > time.time():
        return tok["access_token"]

    refreshed = request(
        f"{OAUTH}/token",
        method="POST",
        form={
            "client_id": config.get("STRAVA_CLIENT_ID", required=True),
            "client_secret": config.get("STRAVA_CLIENT_SECRET", required=True),
            "refresh_token": tok["refresh_token"],
            "grant_type": "refresh_token",
        },
    )
    # Strava rotates the refresh token, so the whole payload has to be kept.
    tok.update(refreshed)
    config.write_secret("strava", tok)
    return tok["access_token"]


def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {access_token()}"}


def athlete() -> dict:
    return request(f"{API}/athlete", headers=_auth_headers())


def list_activities(after_epoch: int | None = None, max_pages: int = 20) -> list[dict]:
    out: list[dict] = []
    for page in range(1, max_pages + 1):
        batch = request(
            f"{API}/athlete/activities",
            params={"after": after_epoch, "page": page, "per_page": 100},
            headers=_auth_headers(),
        )
        if not batch:
            break
        out.extend(batch)
        if len(batch) < 100:
            break
    return out


def get_activity(activity_id: str) -> dict:
    """The detail endpoint carries description, calories and splits that the
    list endpoint omits."""
    return request(
        f"{API}/activities/{activity_id}",
        params={"include_all_efforts": "false"},
        headers=_auth_headers(),
    )


STREAM_KEYS = "time,distance,heartrate,velocity_smooth,altitude,cadence,watts,latlng"


def get_streams(activity_id: str, keys: str = STREAM_KEYS) -> dict:
    data = request(
        f"{API}/activities/{activity_id}/streams",
        params={"keys": keys, "key_by_type": "true"},
        headers=_auth_headers(),
    )
    return {k: v.get("data") for k, v in (data or {}).items() if isinstance(v, dict)}


def sync(after_epoch: int | None = None, verbose: bool = True) -> int:
    raw = list_activities(after_epoch=after_epoch)
    for a in raw:
        store.save_activity(store.normalise_strava(a))
    if verbose:
        print(f"  strava: {len(raw)} activities")
    return len(raw)


def open_browser(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception:
        pass
