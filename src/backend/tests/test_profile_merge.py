"""
Step 3: profile dual-write preserves partial-merge semantics, and the SQLite
mirror matches the JSON source.
"""
from fastapi.testclient import TestClient

import main
from database import store
from services import profile


def _client():
    return TestClient(main.app)


def test_profile_partial_merge_and_sqlite_mirror():
    with _client() as c:
        c.post("/profile", json={"name": "Léo Baleras"})
        c.post("/profile", json={"tagline": "engineer"})  # must not wipe name

        prof = c.get("/profile").json()  # route reads SQLite
        assert prof["name"] == "Léo Baleras"
        assert prof["tagline"] == "engineer"

        # the JSON source (still written) and the SQLite mirror agree
        assert profile.get_profile()["name"] == "Léo Baleras"
        assert store.get_profile() == profile.get_profile()
