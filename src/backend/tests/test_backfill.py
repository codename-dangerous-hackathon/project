"""
Tests for database/backfill.reconcile() — shadow-populating SQLite from the live
Chroma + JSON sources.

SQLite is tmp-isolated per test (conftest). Chroma's `vdb` is a process-wide
EphemeralClient singleton (conftest swaps PersistentClient->Ephemeral), so we
wipe its collections around each test to prevent cross-test leakage. JSON stores
(events/profile) are already redirected to tmp by conftest.
"""
import database.backfill as backfill
import database.sqlite_manager as sqlite_manager
import database.store as store
from database.chroma_manager import vdb
from services import profile, reminders

# Chroma is wiped around every test by the conftest autouse fixture.


def _seed():
    vdb.add_person("per1", "Jeremy", "Brother", has_photo=True)
    # semantic person memory (no date), an episodic one (has date), and a general one
    vdb.add_memory("m1", "He is smart", {"person_id": "per1", "scope": "person", "tags": "person"})
    vdb.add_memory("e1", "Visited the park together",
                   {"person_id": "per1", "scope": "person", "date": "2026-05-20"})
    vdb.add_memory("g1", "Loves gardening", {"scope": "general"})
    reminders.add_event({"type": "medication", "title": "Sleep pills", "notes": "one",
                         "time": "16:00", "date": "2026-05-30", "recurrence": "weekly"})
    profile.save_profile({"name": "Léo Baleras", "tagline": "engineer"})


def _memory_kinds():
    conn = sqlite_manager.get_connection()
    try:
        rows = conn.execute("SELECT id, kind, event_time, person_id FROM memories").fetchall()
        return {r["id"]: (r["kind"], r["event_time"], r["person_id"]) for r in rows}
    finally:
        conn.close()


def test_reconcile_populates_sqlite():
    _seed()
    counts = backfill.reconcile()
    assert counts == {"people": 1, "memories": 3, "events": 1, "profile": 1}

    # People
    people = store.list_people()
    assert len(people) == 1
    assert people[0]["name"] == "Jeremy"
    assert people[0]["has_photo"] is True
    assert people[0]["memory_count"] == 2  # m1 + e1 (general g1 not counted)

    # Memories: text + kind classification + person linkage
    kinds = _memory_kinds()
    assert kinds["m1"] == ("semantic", None, "per1")
    assert kinds["e1"] == ("episodic", "2026-05-20", "per1")
    assert kinds["g1"] == ("semantic", None, None)
    assert {m["text"] for m in store.list_memories_for_person("per1")} == {"He is smart", "Visited the park together"}
    assert [m["text"] for m in store.list_general_memories()] == ["Loves gardening"]

    # Events + profile
    evs = store.list_events()
    assert len(evs) == 1 and evs[0]["title"] == "Sleep pills" and evs[0]["recurrence"] == "weekly"
    assert store.get_profile()["name"] == "Léo Baleras"


def test_reconcile_is_idempotent():
    _seed()
    backfill.reconcile()
    backfill.reconcile()  # second run must not duplicate anything

    assert len(store.list_people()) == 1
    assert len(store.list_events()) == 1
    conn = sqlite_manager.get_connection()
    try:
        assert conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 3
        # single shared 'migration' provenance row, not one per run
        assert conn.execute(
            "SELECT COUNT(*) FROM provenance WHERE source='migration'"
        ).fetchone()[0] == 1
    finally:
        conn.close()


def test_reconcile_on_empty_sources_is_safe():
    # No Chroma/JSON data seeded -> only an (empty) profile row + migration provenance.
    counts = backfill.reconcile()
    assert counts == {"people": 0, "memories": 0, "events": 0, "profile": 1}
    assert store.list_people() == []
    assert store.get_profile()["name"] == ""


def test_reconcile_if_first_run_bootstraps_empty_store():
    # Fresh SQLite + legacy Chroma data -> bootstrap once.
    vdb.add_person("p1", "Jeremy", "Brother", has_photo=False)
    vdb.add_memory("m1", "He is smart", {"person_id": "p1", "scope": "person"})
    counts = backfill.reconcile_if_first_run()
    assert counts is not None and counts["people"] == 1 and counts["memories"] == 1
    assert [p["name"] for p in store.list_people()] == ["Jeremy"]


def test_reconcile_if_first_run_skips_and_does_not_resurrect():
    # Non-empty SQLite + an ORPHAN Chroma vector (a memory whose SQLite row was
    # deleted but whose vector lingered). reconcile must NOT run -> no resurrection.
    store.upsert_person("p1", "Anna", "Daughter", False, "2026-05-31T00:00:00", "2026-05-31T00:00:00")
    vdb.add_memory("orphan1", "a deleted fact that lingered in chroma", {"scope": "general"})
    assert backfill.reconcile_if_first_run() is None
    assert all(m["text"] != "a deleted fact that lingered in chroma"
               for m in store.list_general_memories())
