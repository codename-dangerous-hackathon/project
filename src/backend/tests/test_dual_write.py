"""
Step 3 core invariant: writes land in BOTH SQLite (authoritative) and Chroma
(semantic index), and deletes remove from both. Plus the documented best-effort
contract: a Chroma write failure still persists to SQLite and does not fail the
request.
"""
from database import store, writes
from database.chroma_manager import vdb

# Chroma is wiped around every test by the conftest autouse fixture.


def test_record_memory_lands_in_both_stores():
    pid = writes.create_person("Jeremy", "Brother", has_photo=False)
    # person exists in SQLite and Chroma
    assert store.get_person(pid)["name"] == "Jeremy"
    assert vdb.get_person(pid)["name"] == "Jeremy"

    mid = writes.record_memory("He likes AI", person_id=pid, person_name="Jeremy",
                               relationship="Brother", scope="person", tags="person")
    # SQLite
    assert [m["text"] for m in store.list_memories_for_person(pid)] == ["He likes AI"]
    # Chroma — the vector is retrievable and filterable by person_id (what the
    # companion's semantic retrieval relies on)
    got = vdb.memory_collection.get(ids=[mid], include=["documents", "metadatas"])
    assert got["documents"][0] == "He likes AI"
    assert got["metadatas"][0]["person_id"] == pid
    q = vdb.memory_collection.get(where={"person_id": pid})
    assert mid in (q.get("ids") or [])


def test_delete_removes_from_both_stores():
    pid = writes.create_person("Rob", "Friend", has_photo=False)
    mid = writes.record_memory("plays guitar", person_id=pid, person_name="Rob",
                               relationship="Friend", scope="person", tags="person")
    writes.delete_memory(mid)
    assert store.list_memories_for_person(pid) == []
    assert (vdb.memory_collection.get(ids=[mid]).get("ids") or []) == []

    writes.delete_person(pid)
    assert store.get_person(pid) is None
    assert vdb.get_person(pid) is None


def test_general_memory_chroma_metadata_shape():
    # general memory must keep the legacy {date, tags} Chroma metadata
    mid = writes.record_memory("Loves gardening", person_id=None, scope="general",
                               tags="hobby", date="2026-05-20")
    meta = vdb.memory_collection.get(ids=[mid], include=["metadatas"])["metadatas"][0]
    assert meta == {"date": "2026-05-20", "tags": "hobby"}
    # and SQLite classified it episodic (it has a date) under general scope
    assert [m["text"] for m in store.list_general_memories()] == ["Loves gardening"]


def test_chroma_write_failure_still_persists_to_sqlite(monkeypatch, capsys):
    # Best-effort contract: if Chroma add_memory raises, SQLite still has the row.
    def _boom(*a, **k):
        raise RuntimeError("chroma down")

    monkeypatch.setattr(vdb, "add_memory", _boom)
    mid = writes.record_memory("survives", person_id=None, scope="general", tags="")
    assert [m["text"] for m in store.list_general_memories()] == ["survives"]
    assert mid  # call returned normally despite the Chroma failure
    assert "Chroma add_memory failed" in capsys.readouterr().out
