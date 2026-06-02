"""
Step 3: the companion's family roster is built from SQLite, not Chroma.
"""
import agents.companion as companion
from database import writes
from database.chroma_manager import vdb

# Chroma is wiped around every test by the conftest autouse fixture.


def test_build_family_context_renders_from_sqlite(monkeypatch):
    pid = writes.create_person("Jeremy", "Brother", has_photo=False)
    writes.record_memory("He is smart", person_id=pid, person_name="Jeremy",
                         relationship="Brother", scope="person", tags="person")

    # Prove it does NOT read the Chroma people collection anymore.
    def _boom(*a, **k):
        raise AssertionError("build_family_context must not call vdb.list_people")

    monkeypatch.setattr(vdb, "list_people", _boom)

    ctx = companion.build_family_context()
    assert "Jeremy is the patient's Brother." in ctx
    assert "He is smart" in ctx
