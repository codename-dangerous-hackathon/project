"""
Step 5: hybrid retrieval + rerank. The scoring is a pure function (deterministic,
no Chroma/LLM); integration tests cover ordering, usage feedback, superseded
filtering, and graceful degradation. Chroma + SQLite isolated by conftest.
"""
from datetime import datetime

import database.sqlite_manager as sqlite_manager
from database import retrieval, store, writes
from database.chroma_manager import vdb

NOW = datetime(2026, 6, 1, 12, 0, 0)


# ---- pure scoring -----------------------------------------------------------

def test_recency_recent_episodic_outranks_old():
    base = {"sim": 0.5, "text": "x", "use_count": 0, "kind": "episodic", "created_at": None}
    recent = {**base, "event_time": "2026-05-30"}
    old = {**base, "event_time": "2026-01-01"}
    assert retrieval._score(recent, "", NOW) > retrieval._score(old, "", NOW)


def test_semantic_barely_decays_vs_episodic():
    old = "2020-01-01T00:00:00"
    sem = retrieval._recency_decay("semantic", old, None, NOW)
    epi = retrieval._recency_decay("episodic", None, old, NOW)
    assert sem > 0.4          # durable fact still strongly weighted years later
    assert epi < 0.01         # a years-old dated event has faded
    assert retrieval._recency_decay("semantic", None, None, NOW) == 0.5  # undated neutral


def test_keyword_match_outranks_non_match_at_equal_similarity():
    common = {"sim": 0.3, "kind": "semantic", "created_at": NOW.isoformat(), "event_time": None, "use_count": 0}
    match = {**common, "text": "plays guitar in a band"}
    nomatch = {**common, "text": "enjoys a cup of tea"}
    assert retrieval._score(match, "guitar", NOW) > retrieval._score(nomatch, "guitar", NOW)


def test_higher_use_count_ranks_higher():
    common = {"sim": 0.4, "text": "x", "kind": "semantic", "created_at": NOW.isoformat(), "event_time": None}
    hot = {**common, "use_count": 8}
    cold = {**common, "use_count": 0}
    assert retrieval._score(hot, "", NOW) > retrieval._score(cold, "", NOW)


# ---- integration ------------------------------------------------------------

def test_retrieve_ranks_keyword_match_first_and_bumps_usage():
    writes.record_memory("plays the guitar in a band", scope="general")
    writes.record_memory("loves gardening in spring", scope="general")
    writes.record_memory("enjoys playing chess", scope="general")

    hits = retrieval.retrieve("guitar", k=2)
    assert hits and "guitar" in hits[0]["text"]

    # surfaced memories had their use_count incremented (frequency feedback)
    rows = store.get_memories_by_ids([h["id"] for h in hits])
    assert all(rows[h["id"]]["use_count"] == 1 for h in hits)


def test_retrieve_excludes_superseded():
    a = writes.record_memory("plays the guitar nightly", scope="general")
    b = writes.record_memory("used to play guitar long ago", scope="general")
    # mark b as consolidated-away (points at the survivor a)
    conn = sqlite_manager.get_connection()
    conn.execute("UPDATE memories SET superseded_by = ? WHERE id = ?", (a, b))
    conn.commit()
    conn.close()

    ids = [h["id"] for h in retrieval.retrieve("guitar", k=5)]
    assert a in ids
    assert b not in ids


def test_retrieve_degrades_gracefully(monkeypatch):
    def _boom(*args, **kwargs):
        raise RuntimeError("chroma down")

    monkeypatch.setattr(vdb, "query_memories", _boom)
    assert retrieval.retrieve("anything") == []
