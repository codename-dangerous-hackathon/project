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
        # legacy {id,text,date,tags} keys preserved; Step 4 adds provenance fields
        assert {"id", "text", "date", "tags"} <= set(by_text["dated fact"])
        assert {"added_by", "added_at"} <= set(by_text["dated fact"])
        assert by_text["dated fact"]["date"] == "2026-05-20"
        assert by_text["dated fact"]["tags"] == "x"
        # undated semantic memory -> date "" (not None)
        assert by_text["undated fact"]["date"] == ""
