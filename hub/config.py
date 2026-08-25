"""Where secrets, paths and your personal training constants come from.

Nothing here ever gets committed: .env and .secrets/ are both gitignored. The
one thing that IS committed is training/paces.md, because your threshold pace
is context Claude should have, not a credential.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SECRETS = ROOT / ".secrets"
TRAINING = ROOT / "training"

ACTIVITIES = DATA / "activities"
STREAMS = DATA / "streams"
WELLNESS = DATA / "wellness"


def ensure_dirs() -> None:
    for d in (DATA, SECRETS, ACTIVITIES, STREAMS, WELLNESS, TRAINING / "plans", TRAINING / "log"):
        d.mkdir(parents=True, exist_ok=True)
    # Tokens are bearer credentials; keep them off other users on the box.
    try:
        SECRETS.chmod(0o700)
    except OSError:
        pass


def load_env() -> None:
    """Read .env into os.environ without adding a dependency.

    Real environment variables win, so CI or a shell export can override the file.
    """
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def get(name: str, required: bool = False) -> str | None:
    load_env()
    value = os.environ.get(name)
    if required and not value:
        raise SystemExit(
            f"Missing {name}. Copy .env.example to .env and fill it in — "
            f"see README.md 'Connecting your accounts'."
        )
    return value


def read_secret(name: str) -> dict | None:
    path = SECRETS / f"{name}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def write_secret(name: str, payload: dict) -> None:
    ensure_dirs()
    path = SECRETS / f"{name}.json"
    path.write_text(json.dumps(payload, indent=2))
    try:
        path.chmod(0o600)
    except OSError:
        pass


def imperial() -> bool:
    return (get("UNITS") or "imperial").lower() != "metric"


# ----------------------------------------------------------------- named efforts

_PACE_LINE = re.compile(r"^\s*[-*]\s*(?P<name>[^:]+?)\s*:\s*(?P<pace>.+?)\s*$")


def named_paces() -> dict[str, str]:
    """Pull "- threshold: 6:40/mi" style lines out of training/paces.md.

    This is what lets you say "threshold" or "5k pace" in a workout instead of
    doing the arithmetic yourself. Editing that file re-tunes every future workout.
    """
    path = TRAINING / "paces.md"
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        m = _PACE_LINE.match(line)
        if not m:
            continue
        name = m.group("name").strip().lower()
        pace = m.group("pace").strip()
        # Skip prose bullets that aren't actually paces.
        if re.search(r"\d{1,3}:\d{2}\s*(?:/|per)", pace):
            out[name] = pace
    return out
