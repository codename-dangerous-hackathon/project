"""
Step 7: near-duplicate semantic memories are consolidated (soft-deleted via
superseded_by); episodic and cross-person memories are never merged; the pass is
idempotent and runs at most once per calendar day. Isolation via conftest.
"""
from datetime import datetime

import database.sqlite_manager as sqlite_manager
from database import retrieval, store, writes
from services import consolidation


def _set_use_count(mid, n):
    c = sqlite_manager.get_connection()
    c.execute("UPDATE memories SET use_count = ? WHERE id = ?", (n, mid))
    c.commit()
    c.close()


def test_identical_semantic_memories_are_consolidated():
    a = writes.record_memory("loves tending the garden", scope="general")
    b = writes.record_memory("loves tending the garden", scope="general")  # cosine ~1.0
    _set_use_count(a, 5)  # a wins as survivor (higher use_count)

    assert consolidation.consolidate() == {"clusters": 1, "superseded": 1}

    # only the survivor remains visible
    assert [m["text"] for m in store.list_general_memories()] == ["loves tending the garden"]
    rows = store.get_memories_by_ids([a, b])
    assert rows[a]["superseded_by"] is None
    assert rows[b]["superseded_by"] == a
    # retrieval no longer surfaces the superseded duplicate
    assert b not in [h["id"] for h in retrieval.retrieve("garden", k=5)]


def test_distinct_memories_not_merged():
    writes.record_memory("loves tending the garden", scope="general")
    writes.record_memory("served in the navy as a young man", scope="general")
    assert consolidation.consolidate()["superseded"] == 0
    assert len(store.list_general_memories()) == 2


def test_episodic_memories_not_merged():
    writes.record_memory("went to the park", scope="general", date="2026-05-01")
    writes.record_memory("went to the park", scope="general", date="2026-05-02")
    assert consolidation.consolidate()["superseded"] == 0


def test_cross_person_duplicates_not_merged():
    p1 = writes.create_person("Anna", "Daughter")
    p2 = writes.create_person("Bob", "Son")
    writes.record_memory("likes the garden", person_id=p1, person_name="Anna",
                         relationship="Daughter", scope="person", tags="person")
    writes.record_memory("likes the garden", person_id=p2, person_name="Bob",
                         relationship="Son", scope="person", tags="person")
    assert consolidation.consolidate()["superseded"] == 0  # different person scopes


def test_consolidate_is_idempotent():
    writes.record_memory("loves tending the garden", scope="general")
    writes.record_memory("loves tending the garden", scope="general")
    assert consolidation.consolidate()["superseded"] == 1
    assert consolidation.consolidate()["superseded"] == 0


def test_maybe_run_at_most_once_per_day(monkeypatch):
    monkeypatch.setattr(consolidation, "_last_run_date", None)
    writes.record_memory("loves tending the garden", scope="general")
    writes.record_memory("loves tending the garden", scope="general")

    r1 = consolidation.maybe_run(datetime(2026, 6, 1, 3, 0))
    assert r1 and r1["superseded"] == 1
    assert consolidation.maybe_run(datetime(2026, 6, 1, 12, 0)) is None  # same day -> skip
    r3 = consolidation.maybe_run(datetime(2026, 6, 2, 3, 0))            # next day -> runs again
    assert r3 is not None and r3["superseded"] == 0                     # nothing left to merge
