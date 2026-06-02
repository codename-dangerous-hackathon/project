"""
Phase 5 observability: per-turn tracing + /health + /traces. The HTTP views must
never expose conversation text (the backend is reachable via the public funnel);
full detail lives only in the local JSONL.
"""
import json

import requests as _requests
from fastapi.testclient import TestClient

import agents.companion as companion
import main
from agents.companion import ask_companion as real_ask  # captured before the conftest mock
from services import observability


class _FakeResp:
    def __init__(self, payload):
        self._p = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._p


def _client():
    return TestClient(main.app)


def test_record_strips_text_in_metrics_but_keeps_full_in_jsonl(monkeypatch, tmp_path):
    monkeypatch.setattr(observability, "TRACE_FILE", str(tmp_path / "traces.jsonl"))
    observability.reset()
    observability.record({
        "ts": "t1", "latency_ms": 100, "model": "m", "fallback": False,
        "retrieved": [{"id": "a", "score": 0.9, "text": "secret fact"}],
        "context": {"family": True}, "tokens": {"prompt_tokens": 10},
        "user_input": "private question", "reply": "private answer",
    })
    row = observability.recent_metrics(5)[0]
    assert "user_input" not in row and "reply" not in row
    assert row["retrieved"] == [{"id": "a", "score": 0.9}]  # id+score only, no text
    assert row["latency_ms"] == 100 and row["model"] == "m"
    assert observability.summary()["turns"] == 1
    # full detail (incl. conversation text) persisted locally only
    saved = json.loads((tmp_path / "traces.jsonl").read_text().strip())
    assert saved["user_input"] == "private question" and saved["reply"] == "private answer"


def test_health_endpoint_shape(monkeypatch):
    monkeypatch.setattr(_requests, "get", lambda *a, **k: _FakeResp({"data": [{"id": "test-model"}]}))
    with _client() as c:
        c.post("/people", json={"name": "Jeremy", "relationship": "Brother"})
        h = c.get("/health").json()
    assert h["status"] == "ok"
    assert set(h["models"]) == {"whisper", "insightface"}  # bools (not warmed in tests)
    assert h["llm"] == {"reachable": True, "model": "test-model"}
    assert h["store"]["people"] == 1


def test_traces_endpoint_has_no_conversation_text(monkeypatch, tmp_path):
    monkeypatch.setattr(observability, "TRACE_FILE", str(tmp_path / "t.jsonl"))
    observability.reset()
    observability.record({"ts": "t", "latency_ms": 5, "model": "m", "fallback": False,
                          "retrieved": [], "context": {}, "tokens": None,
                          "user_input": "secret", "reply": "secret reply"})
    with _client() as c:
        body = c.get("/traces").json()
    assert body["summary"]["turns"] >= 1
    assert all("user_input" not in t and "reply" not in t for t in body["traces"])


def test_ask_companion_records_fallback_trace(monkeypatch, tmp_path):
    monkeypatch.setattr(observability, "TRACE_FILE", str(tmp_path / "t.jsonl"))
    monkeypatch.setattr(companion, "get_companion_model", lambda: "test-model")
    observability.reset()
    # conftest already makes companion.requests.post raise -> fallback path.
    reply = real_ask("where am I?")
    assert "I hear you" in reply
    m = observability.recent_metrics(1)[0]
    assert m["fallback"] is True and m["model"] == "test-model"
    assert "family" in m["context"]


def test_ask_companion_records_success_trace(monkeypatch, tmp_path):
    monkeypatch.setattr(observability, "TRACE_FILE", str(tmp_path / "t.jsonl"))
    monkeypatch.setattr(companion, "get_companion_model", lambda: "test-model")
    monkeypatch.setattr(companion.requests, "post", lambda *a, **k: _FakeResp({
        "choices": [{"message": {"content": "Hello, friend."}}],
        "usage": {"prompt_tokens": 42, "completion_tokens": 7},
    }))
    observability.reset()
    reply = real_ask("hello")
    assert reply == "Hello, friend."
    m = observability.recent_metrics(1)[0]
    assert m["fallback"] is False
    assert m["tokens"] == {"prompt_tokens": 42, "completion_tokens": 7}
    assert m["latency_ms"] >= 0
