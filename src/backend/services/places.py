"""
Nearest-place tool — finds the closest public washroom or long-term-care home
to the patient's location, using the same Toronto Open Data the /map page uses.

This is the "tool" the companion uses to answer "where is the nearest washroom?"
"""

import math
import time

import requests

_UA = "Belong/1.0 (dementia companion)"

SOURCES = {
    "washroom": {
        "url": "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/"
        "394b9f09-d5d6-43dc-a7a0-660c99fc2318/resource/"
        "8a9905cf-1b5b-49ca-8359-ac7971099b24/download/washroom-facilities-4326.geojson",
        "name_keys": ["location", "alternative_name"],
        "default": "Public Washroom",
        "label": "public washroom",
    },
    "carehome": {
        "url": "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/"
        "308a036a-ceb5-488a-859f-4d7dc2fd592d/resource/"
        "6bac587f-d8a7-4403-b279-8f1cf05ed20a/download/long-term-care-locations-4326.geojson",
        "name_keys": ["NAME"],
        "default": "Long-Term Care Home",
        "label": "long-term care home",
    },
    "community": {
        "url": "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/"
        "cbea3a67-9168-4c6d-8186-16ac1a795b5b/resource/"
        "f6cdcd50-da7b-4ede-8e60-c3cdba70b559/download/parks-and-recreation-facilities-4326.geojson",
        "name_keys": ["ASSET_NAME"],
        "default": "Community Centre",
        "label": "community & recreation centre",
        # The dataset mixes Parks and Community Centres — keep only the centres.
        "filter": lambda p: str(p.get("TYPE", "")).strip().lower() == "community centre",
    },
}

# Words a patient might use -> our category keys
CATEGORY_ALIASES = {
    "washroom": "washroom", "washrooms": "washroom", "toilet": "washroom",
    "toilets": "washroom", "bathroom": "washroom", "restroom": "washroom",
    "carehome": "carehome", "care home": "carehome", "care-home": "carehome",
    "ltc": "carehome", "long term care": "carehome", "long-term care": "carehome",
    "nursing home": "carehome", "retirement home": "carehome",
    "community centre": "community", "community center": "community",
    "recreation centre": "community", "recreation center": "community",
    "rec centre": "community", "rec center": "community",
    "community centres": "community", "activity centre": "community",
}

_cache = {}            # category -> (timestamp, points)
_TTL = 86400           # 1 day


def _addr_of(props: dict) -> str:
    full = str(props.get("address") or props.get("ADDRESS_FULL") or props.get("ADDRESS") or "").strip()
    pc = str(props.get("POSTAL_CODE") or "").strip()
    return f"{full}, {pc}".strip(", ") if pc else full


def _nice(name: str) -> str:
    # Some datasets store names in ALL CAPS — title-case those for display.
    return name.title() if name.isupper() else name


def _load(category: str):
    src = SOURCES[category]
    cached = _cache.get(category)
    if cached and (time.time() - cached[0]) < _TTL:
        return cached[1]
    try:
        r = requests.get(src["url"], headers={"User-Agent": _UA}, timeout=30)
        r.raise_for_status()
        gj = r.json()
        flt = src.get("filter")
        points = []
        for feat in gj.get("features", []):
            props = feat.get("properties") or {}
            if flt and not flt(props):
                continue
            geom = feat.get("geometry") or {}
            if geom.get("type") == "Point":
                coords = [geom.get("coordinates")]
            elif geom.get("type") == "MultiPoint":
                coords = geom.get("coordinates") or []
            else:
                continue
            name = _nice(next(
                (str(props[k]).strip() for k in src["name_keys"] if props.get(k)),
                src["default"],
            ))
            addr = _addr_of(props)
            for co in coords:
                if not co or len(co) < 2:
                    continue
                # GeoJSON order is [lng, lat]
                points.append({"lat": float(co[1]), "lng": float(co[0]), "name": name, "address": addr})
        _cache[category] = (time.time(), points)
        return points
    except Exception as e:
        print(f"places fetch failed for {category}: {e}")
        return cached[1] if cached else []


def _haversine(lat1, lng1, lat2, lng2) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def normalize_category(text: str):
    t = (text or "").lower()
    for word, cat in CATEGORY_ALIASES.items():
        if word in t:
            return cat
    return None


def find_nearest(category: str, lat: float, lng: float, n: int = 3):
    category = CATEGORY_ALIASES.get(category, category)
    if category not in SOURCES:
        return []
    scored = [
        {**p, "distance_m": round(_haversine(lat, lng, p["lat"], p["lng"]))}
        for p in _load(category)
    ]
    scored.sort(key=lambda x: x["distance_m"])
    return scored[:n]


def _fmt_dist(m: int) -> str:
    return f"{m} metres" if m < 1000 else f"{m / 1000:.1f} km"


def nearby_summary(lat: float, lng: float) -> str:
    """One nearest place per category, for the companion's context."""
    lines = []
    for cat in ("washroom", "carehome", "community"):
        near = find_nearest(cat, lat, lng, 1)
        if near:
            p = near[0]
            addr = f" at {p['address']}" if p["address"] else ""
            lines.append(
                f"- Nearest {SOURCES[cat]['label']}: {p['name']}{addr}, "
                f"about {_fmt_dist(p['distance_m'])} away."
            )
    return "\n".join(lines)
