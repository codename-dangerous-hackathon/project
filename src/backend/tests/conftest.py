"""
Shared pytest fixtures for the Belong backend.

Goals (HERMETIC):
  * The app normally runs with CWD = src/backend, so `import main`, `import
    services.reminders`, etc. resolve as bare top-level packages. We put
    src/backend on sys.path here so the tests resolve them the same way no
    matter what CWD pytest is launched from.
  * NEVER touch real on-disk state. All event/subscription/profile JSON is
    redirected under the per-test tmp_path. The ChromaDB singleton (created at
    import time in database.chroma_manager) is forced onto an in-memory
    EphemeralClient so it never opens or mutates the real database/data dir.
  * NEVER load the heavy models (Whisper/Piper/InsightFace) and NEVER hit the
    real vLLM/NIM LLM. Warmups, the reminder scheduler, and ask_companion are
    all neutralized.
"""

import os
import sys

import pytest

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # src/backend
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)


# --- Force ChromaDB onto an in-memory client BEFORE anything imports the
# database.chroma_manager singleton (which constructs a PersistentClient at
# import time against the real database/data dir). This must happen at
# collection time, hence module level rather than inside a fixture. ---
import chromadb  # noqa: E402

_real_persistent_client = chromadb.PersistentClient


def _ephemeral(*args, **kwargs):
    # Drop the on-disk `path` so no real patient data is read or written.
    return chromadb.EphemeralClient()


chromadb.PersistentClient = _ephemeral


@pytest.fixture(autouse=True)
def _isolate_state(tmp_path, monkeypatch):
    """Redirect all JSON state files to tmp_path and neutralize the LLM,
    model warmups, and the reminder scheduler for every test."""
    import services.reminders as reminders
    import services.profile as profile

    # These module-level constants exist (verified by reading the source).
    monkeypatch.setattr(reminders, "EVENTS_FILE", str(tmp_path / "events.json"))
    monkeypatch.setattr(reminders, "SUBS_FILE", str(tmp_path / "subscriptions.json"))
    monkeypatch.setattr(profile, "PROFILE_FILE", str(tmp_path / "profile.json"))

    # Redirect the SQLite store (Phase 2) to a per-test tmp DB so migrations run
    # against a throwaway file and never create/mutate a real belong.db. Keyed on
    # DB_PATH at call time, so get_connection() picks this up.
    import database.sqlite_manager as sqlite_manager

    monkeypatch.setattr(sqlite_manager, "DB_PATH", str(tmp_path / "belong.db"))

    # Drop any duplicate-suppression state carried between tests.
    monkeypatch.setattr(reminders, "_fired", set())

    # The LLM must never be reached. Patch the entrypoint to a canned string and
    # also the underlying requests.post as a belt-and-suspenders guard.
    import agents.companion as companion

    monkeypatch.setattr(
        companion, "ask_companion", lambda *a, **k: "CANNED_TEST_REPLY"
    )

    def _no_network(*a, **k):  # pragma: no cover - safety net
        raise AssertionError("Test attempted a real network call to the LLM/NIM.")

    monkeypatch.setattr(companion.requests, "post", _no_network)

    # Never load Whisper/Piper/InsightFace, and never start the 20s scheduler
    # thread (which would otherwise tick forever in the background).
    import tools.audio as audio
    import tools.vision as vision

    monkeypatch.setattr(audio, "warmup", lambda: None)
    monkeypatch.setattr(vision, "warmup", lambda: None)
    monkeypatch.setattr(reminders, "start_scheduler", lambda: None)

    # Wipe the shared in-memory Chroma collections around every test. The
    # EphemeralClient is a process-wide singleton (the vdb object is built once at
    # import), so without this, vectors leak between tests — and the startup
    # reconcile would then import another test's leftover Chroma rows into this
    # test's fresh SQLite.
    from database.chroma_manager import vdb

    def _wipe_chroma():
        for col in (vdb.people_collection, vdb.memory_collection, vdb.face_collection):
            ids = col.get().get("ids", []) or []
            if ids:
                col.delete(ids=ids)

    _wipe_chroma()
    yield
    _wipe_chroma()
