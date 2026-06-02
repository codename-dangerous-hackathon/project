"""
Step 4: memory reads surface provenance (added_by / added_at). Caregiver-entered
memories report added_by='caregiver'; backfilled ones report 'system'.
"""
from fastapi.testclient import TestClient

import main
from database import store, writes


def _client():
    return TestClient(main.app)


def test_caregiver_memory_surfaces_provenance():
    with _client() as c:
        pid = c.post("/people", json={"name": "Jeremy", "relationship": "Brother"}).json()["person_id"]
        c.post(f"/people/{pid}/memories", json={"text": "He is smart"})

        mem = c.get(f"/people/{pid}").json()["memories"][0]
        assert mem["text"] == "He is smart"
        assert mem["added_by"] == "caregiver"
        assert mem["added_at"]  # a non-empty ISO timestamp

        c.post("/enroll_memory", json={"text": "Loves gardening"})
        gen = next(m for m in c.get("/memories").json()["memories"] if m["text"] == "Loves gardening")
        assert gen["added_by"] == "caregiver" and gen["added_at"]
        assert set(gen) == {"id", "text", "date", "tags", "added_by", "added_at"}


def test_backfilled_memory_reports_system_provenance():
    # A memory written with a 'migration'-style provenance reads back as system.
    prov = store.add_provenance("system", "migration", "2026-05-30T00:00:00")
    store.upsert_memory("m-sys", "old fact", "semantic", None, "general", "", None,
                        "2026-05-30T00:00:00", prov)
    gen = next(m for m in store.list_general_memories() if m["id"] == "m-sys")
    assert gen["added_by"] == "system"
