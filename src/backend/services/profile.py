"""
The patient's own profile — name, photo, and a short "about you" — so the
person can re-anchor on who they are. Stored locally as JSON (the photo is the
patient's own, on their own device; it's for them to see themselves).
"""

import json
import os
import threading

_BASE = os.path.dirname(os.path.dirname(__file__))  # src/backend
_DATA = os.path.join(_BASE, "data")
os.makedirs(_DATA, exist_ok=True)
PROFILE_FILE = os.path.join(_DATA, "profile.json")

_lock = threading.Lock()
_DEFAULT = {"name": "", "tagline": "", "photo": ""}


def get_profile() -> dict:
    try:
        with open(PROFILE_FILE) as f:
            data = json.load(f)
        return {**_DEFAULT, **data}
    except Exception:
        return dict(_DEFAULT)


def save_profile(updates: dict) -> dict:
    with _lock:
        current = get_profile()
        for k in ("name", "tagline", "photo"):
            if k in updates and updates[k] is not None:
                current[k] = updates[k]
        tmp = PROFILE_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(current, f)
        os.replace(tmp, PROFILE_FILE)
    return current
