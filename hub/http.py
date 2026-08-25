"""A very small JSON-over-HTTP helper.

Strava needs nothing more than this, so it stays on the standard library and
the only third-party dependency in the project is the one Garmin genuinely
requires.
"""
from __future__ import annotations

import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request


class HttpError(RuntimeError):
    def __init__(self, status: int, body: str, url: str):
        super().__init__(f"HTTP {status} from {url}: {body[:400]}")
        self.status = status
        self.body = body
        self.url = url


def request(
    url: str,
    method: str = "GET",
    params: dict | None = None,
    data: dict | None = None,
    form: dict | None = None,
    headers: dict | None = None,
    timeout: int = 45,
    retries: int = 3,
):
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        if clean:
            url = f"{url}?{urllib.parse.urlencode(clean)}"

    body = None
    headers = dict(headers or {})
    headers.setdefault("Accept", "application/json")
    headers.setdefault("Accept-Encoding", "gzip")
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    elif form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    last: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    payload = gzip.decompress(payload)
                text = payload.decode("utf-8", "replace")
                return json.loads(text) if text.strip() else None
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            try:
                payload = gzip.decompress(payload)
            except OSError:
                pass
            text = payload.decode("utf-8", "replace")
            # 429 is Strava's rate limit; it resets on the quarter hour.
            if exc.code == 429 and attempt < retries - 1:
                time.sleep(min(60 * (attempt + 1), 120))
                last = exc
                continue
            if exc.code >= 500 and attempt < retries - 1:
                time.sleep(2 ** attempt)
                last = exc
                continue
            raise HttpError(exc.code, text, url) from exc
        except urllib.error.URLError as exc:
            last = exc
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    raise last if last else RuntimeError("unreachable")
