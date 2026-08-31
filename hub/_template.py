"""Loads the dashboard's static assets.

The markup, styles and client code live as real files under hub/static/ so they
can be edited, linted and tested with ordinary tooling — app.js in particular
runs under node in the test suite. This module only reads them in; the
`__PAYLOAD__` marker in app.js is replaced with JSON at build time.
"""
from __future__ import annotations

from pathlib import Path

STATIC = Path(__file__).parent / "static"


def _read(name: str) -> str:
    return (STATIC / name).read_text(encoding="utf-8")


STYLE = _read("style.css")
BODY = _read("body.html")

# Order matters: app.js calls into both of these at load.
SCRIPT = "\n".join((
    _read("importer.js"),
    _read("zip.js"),
    _read("fit.js"),
    _read("analytics.js"),
    _read("cycling.js"),
    _read("library.js"),
    _read("workouts.js"),
    _read("coach.js"),
    _read("riders.js"),
    _read("app.js"),
))
