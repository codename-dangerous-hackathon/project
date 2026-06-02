"""
Conversation memory: distill a durable fact from a patient turn and store it as
an episodic memory (provenance patient/conversation), with a repetition dedup.
Hermetic (conftest isolation; the LLM call is mocked).
"""
import agents.companion as companion
import database.sqlite_manager as sqlite_manager
from database import store, writes
from services import conversation_memory as cm


class _Resp:
    def __init__(self, content):
        self._c = content

    def raise_for_status(self):
        pass

    def json(self):
        return {"choices": [{"message": {"content": self._c}}]}


def _provenance(mem_id):
    conn = sqlite_manager.get_connection()
    try:
        r = conn.execute(
            "SELECT pv.actor, pv.source, m.kind FROM memories m "
            "LEFT JOIN provenance pv ON m.provenance_id = pv.id WHERE m.id = ?",
            (mem_id,),
        ).fetchone()
        return dict(r) if r else None
    finally:
        conn.close()


def test_extract_fact_returns_a_fact(monkeypatch):
    monkeypatch.setattr(companion, "get_companion_model", lambda: "test-model")
    monkeypatch.setattr(cm.requests, "post", lambda *a, **k: _Resp("Went to the park with daughter Sarah."))
    assert cm._extract_fact("I went to the park with Sarah today") == "Went to the park with daughter Sarah."


def test_extract_fact_none_for_small_talk(monkeypatch):
    monkeypatch.setattr(companion, "get_companion_model", lambda: "test-model")
    monkeypatch.setattr(cm.requests, "post", lambda *a, **k: _Resp("NONE"))
    assert cm._extract_fact("hello, how are you?") is None


def test_capture_stores_episodic_patient_memory(monkeypatch):
    monkeypatch.setattr(cm, "_extract_fact", lambda _u: "Enjoys gardening in spring")
    cm.capture("I really love my garden in spring")  # empty Chroma -> not a dup

    mems = store.list_general_memories()
    assert [m["text"] for m in mems] == ["Enjoys gardening in spring"]
    assert mems[0]["added_by"] == "patient"
    p = _provenance(mems[0]["id"])
    assert p["actor"] == "patient" and p["source"] == "conversation" and p["kind"] == "episodic"


def test_capture_skips_duplicate(monkeypatch):
    # Seed an existing memory; an identical extracted fact must be deduped.
    writes.record_memory("Enjoys gardening in spring", scope="general")
    monkeypatch.setattr(cm, "_extract_fact", lambda _u: "Enjoys gardening in spring")
    cm.capture("the garden again, the garden again")
    assert len(store.list_general_memories()) == 1  # no duplicate


def test_capture_skips_when_nothing_memorable(monkeypatch):
    monkeypatch.setattr(cm, "_extract_fact", lambda _u: None)
    cm.capture("what day is it?")
    assert store.list_general_memories() == []


def test_record_memory_custom_provenance():
    mid = writes.record_memory("a durable fact", scope="general", actor="patient", source="conversation")
    assert _provenance(mid)["actor"] == "patient"
