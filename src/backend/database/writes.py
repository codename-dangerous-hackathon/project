"""
Dual-write coordinator (Phase 2 Step 3): keeps SQLite (authoritative) and the
legacy Chroma collections in sync on every structured write. Routes/companion
READ from store.py; they WRITE through here.

Ordering, by failure-safety:
  * creates  -> SQLite first (source of truth), then Chroma best-effort (logged).
  * deletes  -> Chroma first, then SQLite. A failed Chroma delete leaving a row
                visible is safer than a ghost vector resurfacing deleted facts to
                the companion (a correctness/privacy issue for a dementia app).

Known accepted gap: a failed Chroma memory write leaves the row in SQLite without
a vector (invisible to semantic retrieval). There is no SQLite->Chroma repair yet
(the every-boot reconcile only heals Chroma->SQLite); that is deferred.

`store.py` stays a pure SQLite layer — all Chroma coupling lives here.
"""
import uuid
from datetime import datetime

from database import store
from database.chroma_manager import vdb


def _now() -> str:
    return datetime.now().isoformat()


# ----- people ----------------------------------------------------------------

def create_person(name: str, relationship: str, has_photo: bool = False) -> str:
    pid = str(uuid.uuid4())
    now = _now()
    store.upsert_person(pid, name, relationship, has_photo, created_at=now, updated_at=now)
    try:
        vdb.add_person(pid, name, relationship, has_photo=has_photo)
    except Exception as e:
        print(f"[writes] Chroma add_person failed (continuing): {e}")
    return pid


def set_photo_flag(person_id: str, name: str, relationship: str, embedding) -> None:
    """Attach a face embedding (Chroma owns the vector) and record has_photo=True
    in SQLite so the reads (list_people/get_person) reflect it."""
    try:
        vdb.set_person_photo(person_id, embedding, name, relationship)
    except Exception as e:
        print(f"[writes] Chroma set_person_photo failed (continuing): {e}")
    now = _now()
    store.upsert_person(person_id, name, relationship, True, created_at=now, updated_at=now)


def delete_person(person_id: str) -> None:
    try:
        vdb.delete_person(person_id)  # Chroma people + face vector + memory vectors
    except Exception as e:
        print(f"[writes] Chroma delete_person failed (continuing): {e}")
    store.delete_person(person_id)  # SQLite (cascades memories + relationships)


# ----- memories --------------------------------------------------------------

def record_memory(text: str, person_id: str | None = None, person_name: str = "",
                  relationship: str = "", scope: str | None = None, tags: str = "",
                  date: str | None = None) -> str:
    """Write a memory to SQLite (authoritative) + Chroma (semantic index). The
    Chroma metadata exactly matches the legacy shape so vdb.query_memories and the
    `where person_id` filters keep working."""
    mem_id = str(uuid.uuid4())
    now = _now()
    when = (date or "").strip()
    kind = "episodic" if when else "semantic"
    prov = store.add_provenance(actor="caregiver", source="manual_entry", entered_at=now)
    store.upsert_memory(mem_id, text=text, kind=kind, person_id=person_id, scope=scope,
                        tags=tags or "", event_time=(when or None), created_at=now, provenance_id=prov)
    if person_id:
        meta = {"person_id": person_id, "person_name": person_name,
                "relationship": relationship, "scope": "person", "tags": tags or "person"}
    else:
        meta = {"date": when, "tags": tags or ""}
    try:
        vdb.add_memory(memory_id=mem_id, text=text, metadata=meta)
    except Exception as e:
        print(f"[writes] Chroma add_memory failed (continuing): {e}")
    return mem_id


def delete_memory(memory_id: str) -> None:
    try:
        vdb.delete_memory(memory_id)
    except Exception as e:
        print(f"[writes] Chroma delete_memory failed (continuing): {e}")
    store.delete_memory(memory_id)
