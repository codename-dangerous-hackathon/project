"""
Step 3 cutover: full /people lifecycle via TestClient, asserting the response
shapes are unchanged and reads now come from SQLite. No photo path (so no face
model is needed). Isolation via conftest (tmp SQLite + tmp JSON + ephemeral Chroma).
"""
from fastapi.testclient import TestClient

import main


def _client():
    return TestClient(main.app)


def test_person_lifecycle():
    with _client() as c:
        assert c.get("/people").json() == {"people": []}

        body = c.post("/people", json={"name": "Jeremy", "relationship": "Brother"}).json()
        assert body["status"] == "success" and body["has_photo"] is False
        pid = body["person_id"]

        people = c.get("/people").json()["people"]
        assert len(people) == 1
        assert people[0] == {"id": pid, "name": "Jeremy", "relationship": "Brother",
                             "has_photo": False, "memory_count": 0}

        r = c.post(f"/people/{pid}/memories", json={"text": "He is smart"})
        assert r.status_code == 200 and r.json()["memory_id"]

        person = c.get(f"/people/{pid}").json()
        assert person["name"] == "Jeremy"
        assert [m["text"] for m in person["memories"]] == ["He is smart"]

        j = c.get("/journal").json()
        assert len(j["people"]) == 1 and j["people"][0]["id"] == pid
        assert [m["text"] for m in j["people"][0]["memories"]] == ["He is smart"]
        assert c.get("/people").json()["people"][0]["memory_count"] == 1

        r = c.delete(f"/people/{pid}")
        assert r.status_code == 200 and r.json() == {"status": "deleted", "id": pid}
        assert c.get("/people").json() == {"people": []}
        assert c.get("/journal").json()["people"] == []
        assert c.get(f"/people/{pid}").status_code == 404


def test_create_person_requires_name_and_relationship():
    with _client() as c:
        assert c.post("/people", json={"name": " ", "relationship": "Brother"}).status_code == 400


def test_add_memory_to_unknown_person_404():
    with _client() as c:
        assert c.post("/people/nope/memories", json={"text": "x"}).status_code == 404


def test_delete_person_cascades_memories_in_journal():
    with _client() as c:
        pid = c.post("/people", json={"name": "Lebna", "relationship": "Mom"}).json()["person_id"]
        c.post(f"/people/{pid}/memories", json={"text": "wears black"})
        c.delete(f"/people/{pid}")
        # the person's memory must not linger anywhere
        assert c.get("/journal").json() == {"people": [], "general": []}
