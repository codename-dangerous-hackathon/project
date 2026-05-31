"""
Mood check-ins (Phase 4): patient logs a feeling, caregiver reads history.
Hermetic TestClient against the isolated SQLite store (conftest).
"""
from fastapi.testclient import TestClient

import main


def _client():
    return TestClient(main.app)


def test_mood_round_trip_newest_first():
    with _client() as c:
        assert c.get("/mood").json() == {"moods": []}
        a = c.post("/mood", json={"mood": "okay"}).json()
        b = c.post("/mood", json={"mood": "great", "note": "had a nice walk"}).json()
        assert a["status"] == "success" and a["mood"] == "okay"

        moods = c.get("/mood").json()["moods"]
        assert [m["mood"] for m in moods] == ["great", "okay"]  # newest first
        assert moods[0]["note"] == "had a nice walk"
        assert set(moods[0]) == {"id", "mood", "note", "created_at"}

        # delete the latest
        assert c.delete(f"/mood/{b['id']}").status_code == 200
        assert [m["mood"] for m in c.get("/mood").json()["moods"]] == ["okay"]


def test_invalid_mood_rejected():
    with _client() as c:
        r = c.post("/mood", json={"mood": "ecstatic"})
        assert r.status_code == 400
        assert c.get("/mood").json() == {"moods": []}  # nothing stored
