"""
Discover public dementia-related events from Eventbrite.

Eventbrite shut down its public event-search API years ago, so we read the
schema.org `ld+json` event data that the public search pages embed (stable,
standard format). Results are cached in-memory to keep the page snappy and
avoid hammering Eventbrite.
"""

import json
import re
import time
from html import unescape

import requests

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
_CACHE = {}              # key -> (timestamp, events)
_CACHE_TTL = 6 * 3600    # 6 hours
_TAG_RE = re.compile(r"<[^>]+>")
_LDJSON_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


def _clean(text: str, limit: int = 240) -> str:
    if not text:
        return ""
    text = unescape(_TAG_RE.sub("", text)).strip()
    return text[: limit - 1] + "…" if len(text) > limit else text


def _map_event(e: dict) -> dict:
    loc = e.get("location") or {}
    if isinstance(loc, list):
        loc = loc[0] if loc else {}
    online = (loc.get("@type") == "VirtualLocation") or (
        (loc.get("name") or "").strip().lower() == "online"
    )
    addr = loc.get("address") or {}
    if isinstance(addr, str):
        city = addr
    else:
        city = addr.get("addressLocality") or addr.get("addressRegion") or ""
    image = e.get("image")
    if isinstance(image, dict):
        image = image.get("url")
    if isinstance(image, list):
        image = image[0] if image else None
    return {
        "title": _clean(e.get("name", ""), 140),
        "url": e.get("url", ""),
        "start": e.get("startDate", ""),
        "end": e.get("endDate", ""),
        "online": bool(online),
        "venue": "" if online else (loc.get("name") or ""),
        "city": "" if online else city,
        "image": image or "",
        "description": _clean(e.get("description", ""), 240),
    }


def _parse(html: str, limit: int):
    events = []
    for block in _LDJSON_RE.findall(html):
        try:
            data = json.loads(block)
        except Exception:
            continue
        items = []
        if isinstance(data, dict) and data.get("@type") == "ItemList":
            items = [el.get("item", el) for el in data.get("itemListElement", [])]
        elif isinstance(data, list):
            items = data
        for it in items:
            if isinstance(it, dict) and it.get("@type") == "Event" and it.get("name"):
                events.append(_map_event(it))
    return events[:limit]


def fetch_dementia_events(location: str = "online", query: str = "dementia", limit: int = 20):
    """Return public dementia events from Eventbrite (cached ~6h)."""
    location = re.sub(r"[^a-z0-9\-]", "", (location or "online").lower()) or "online"
    query = re.sub(r"[^a-z0-9\- ]", "", (query or "dementia").lower()).strip() or "dementia"
    key = f"{location}|{query}"

    cached = _CACHE.get(key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL:
        return cached[1][:limit]

    url = f"https://www.eventbrite.com/d/{location}/{query.replace(' ', '-')}/"
    try:
        resp = requests.get(url, headers={"User-Agent": _UA}, timeout=20)
        resp.raise_for_status()
        events = _parse(resp.text, max(limit, 20))
    except Exception as e:
        print(f"Eventbrite fetch failed: {e}")
        # Serve stale cache if we have any, else empty.
        return cached[1][:limit] if cached else []

    _CACHE[key] = (time.time(), events)
    return events[:limit]
