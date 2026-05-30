"""In-memory memory places for the caregiver Memory Journal."""

from __future__ import annotations

import os
import uuid
from typing import Any

import requests

_places: list[dict[str, Any]] = []

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
STREETVIEW_METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
STREETVIEW_STATIC_URL = "https://maps.googleapis.com/maps/api/streetview"


def _api_key() -> str:
    key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not key:
        raise ValueError("GOOGLE_API_KEY is not set. Add it to src/backend/.env")
    return key


def _toronto_address(address: str) -> str:
    a = address.strip()
    if "toronto" not in a.lower():
        a = f"{a}, Toronto, ON, Canada"
    return a


def geocode_address(address: str) -> tuple[float, float]:
    """Convert a street address to lat/lng via Google Geocoding API."""
    key = _api_key()
    params = {"address": _toronto_address(address), "key": key}
    resp = requests.get(GEOCODE_URL, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if data.get("status") != "OK" or not data.get("results"):
        raise ValueError(
            data.get("error_message")
            or f"Could not find that address ({data.get('status', 'unknown')})."
        )
    loc = data["results"][0]["geometry"]["location"]
    return float(loc["lat"]), float(loc["lng"])


def streetview_available(lat: float, lng: float) -> bool:
    """True if Google Street View has imagery at this location."""
    key = _api_key()
    params = {"location": f"{lat},{lng}", "key": key}
    resp = requests.get(STREETVIEW_METADATA_URL, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    status = data.get("status")
    if status == "OK":
        return True
    if status in {"ZERO_RESULTS", "NOT_FOUND"}:
        return False
    raise ValueError(
        data.get("error_message")
        or f"Street View metadata error: {status}"
    )


def streetview_image_url(lat: float, lng: float, size: str = "600x400") -> str:
    """Build the Google Street View Static API URL (server-side only)."""
    key = _api_key()
    return (
        f"{STREETVIEW_STATIC_URL}?size={size}"
        f"&location={lat},{lng}&key={key}"
    )


def fetch_streetview_bytes(lat: float, lng: float, size: str = "600x400") -> bytes:
    """Download Street View image bytes for the proxy endpoint."""
    url = streetview_image_url(lat, lng, size=size)
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    return resp.content


def proxy_image_path(lat: float, lng: float) -> str:
    """Frontend-safe image URL (no API key)."""
    return f"/api/streetview?lat={lat}&lng={lng}"


def list_places() -> list[dict[str, Any]]:
    return list(_places)


def get_place(place_id: str) -> dict[str, Any] | None:
    return next((p for p in _places if p["id"] == place_id), None)


def add_place(label: str, address: str, note: str) -> dict[str, Any]:
    lat, lng = geocode_address(address)
    streetview_error = None
    try:
        has_sv = streetview_available(lat, lng)
    except ValueError as e:
        has_sv = False
        streetview_error = str(e)

    place = {
        "id": str(uuid.uuid4()),
        "label": label.strip(),
        "address": address.strip(),
        "note": note.strip(),
        "lat": lat,
        "lng": lng,
        "has_streetview": has_sv,
        "image_url": proxy_image_path(lat, lng) if has_sv else None,
        "streetview_error": streetview_error,
    }
    _places.append(place)
    return place


def delete_place(place_id: str) -> bool:
    global _places
    before = len(_places)
    _places = [p for p in _places if p["id"] != place_id]
    return len(_places) < before
