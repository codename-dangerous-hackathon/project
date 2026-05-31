"""
Step 3: /enroll_memory + /memories keep the legacy {id,text,date,tags} shape;
a semantic (undated) memory reports date == "" (event_time NULL -> "").
"""
from fastapi.testclient import TestClient

import main


def _client():
    return TestClient(main.app)


def test_general_memory_shape_dated_and_undated():
    with _client() as c:
        c.post("/enroll_memory", json={"text": "dated fact", "date": "2026-05-20", "tags": "x"})
        c.post("/enroll_memory", json={"text": "undated fact"})

        mems = c.get("/memories").json()["memories"]
        by_text = {m["text"]: m for m in mems}
        assert set(by_text) == {"dated fact", "undated fact"}
        # keys match the legacy vdb.list_memories() shape exactly
        assert set(by_text["dated fact"]) == {"id", "text", "date", "tags"}
        assert by_text["dated fact"]["date"] == "2026-05-20"
        assert by_text["dated fact"]["tags"] == "x"
        # undated semantic memory -> date "" (not None)
        assert by_text["undated fact"]["date"] == ""
