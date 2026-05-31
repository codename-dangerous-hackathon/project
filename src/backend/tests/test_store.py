"""
Unit tests for the SQLite data-access layer (database/store.py). DB is isolated
to a per-test tmp file by the conftest autouse fixture (Step 1).
"""
import database.sqlite_manager as sqlite_manager
import database.store as store

NOW = "2026-05-30T12:00:00"


def _provenance_count():
    conn = sqlite_manager.get_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM provenance").fetchone()[0]
    finally:
        conn.close()


def test_add_provenance_returns_id_and_persists():
    pid = store.add_provenance("caregiver", "manual_entry", NOW, actor_label="Jeremy")
    assert pid
    assert _provenance_count() == 1


def test_add_provenance_stable_id_upserts():
    a = store.add_provenance("system", "migration", NOW, provenance_id="migration")
    b = store.add_provenance("system", "migration", "2026-05-31T00:00:00", provenance_id="migration")
    assert a == b == "migration"
    assert _provenance_count() == 1  # upserted, not duplicated


def test_person_upsert_and_readers():
    store.upsert_person("per1", "Jeremy", "Brother", True, NOW, NOW)
    p = store.get_person("per1")
    assert p == {"id": "per1", "name": "Jeremy", "relationship": "Brother", "has_photo": True}

    # update via upsert (same id) -> one row, new values
    store.upsert_person("per1", "Jeremy R", "Brother", False, NOW, "2026-06-01T00:00:00")
    people = store.list_people()
    assert len(people) == 1
    assert people[0]["name"] == "Jeremy R"
    assert people[0]["has_photo"] is False
    assert people[0]["memory_count"] == 0


def test_memory_upsert_person_and_general():
    prov = store.add_provenance("caregiver", "manual_entry", NOW)
    store.upsert_person("per1", "Jeremy", "Brother", False, NOW, NOW)
    store.upsert_memory("m1", "He is smart", "semantic", "per1", "person", "person", None, NOW, prov)
    store.upsert_memory("g1", "Loves gardening", "semantic", None, "general", "", None, NOW, prov)

    assert [m["text"] for m in store.list_memories_for_person("per1")] == ["He is smart"]
    assert [m["text"] for m in store.list_general_memories()] == ["Loves gardening"]
    # person memory_count reflects only person-scoped rows
    assert store.list_people()[0]["memory_count"] == 1


def test_event_upsert_and_list():
    store.upsert_event("e1", "medication", "Sleep pills", "one", "16:00", "2026-05-30", "weekly", NOW)
    evs = store.list_events()
    assert len(evs) == 1
    assert evs[0] == {"id": "e1", "type": "medication", "title": "Sleep pills",
                      "notes": "one", "time": "16:00", "date": "2026-05-30", "recurrence": "weekly"}
    # upsert same id -> still one row, updated
    store.upsert_event("e1", "medication", "Sleep pills", "two", "17:00", "2026-05-30", "daily", NOW)
    evs = store.list_events()
    assert len(evs) == 1 and evs[0]["recurrence"] == "daily" and evs[0]["notes"] == "two"


def test_profile_upsert_and_defaults():
    # empty before any save
    assert store.get_profile()["name"] == ""
    store.save_profile({"name": "Léo Baleras", "tagline": "engineer"}, NOW)
    prof = store.get_profile()
    assert prof["name"] == "Léo Baleras"
    assert prof["tagline"] == "engineer"
    assert prof["photo"] == ""  # unset field defaults to empty string
    # second save updates the single row
    store.save_profile({"name": "Léo"}, "2026-06-01T00:00:00")
    assert store.get_profile()["name"] == "Léo"
