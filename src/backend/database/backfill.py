"""
Backfill: shadow-populate the SQLite store from the live Chroma + JSON sources
(Phase 2 Step 2). Read-only on the sources — it never mutates Chroma or the JSON
files. Idempotent (every write is an upsert keyed on id), so it is safe to run on
every startup during the transition window; this keeps SQLite from drifting from
the still-authoritative old stores until the Step 3 route cutover.
"""
from datetime import datetime

from database import store
from database.chroma_manager import vdb
from services import profile, reminders


def _now() -> str:
    return datetime.now().isoformat()


def _classify(meta: dict):
    """Return (kind, event_time) for a memory from its Chroma metadata.
    Episodic if it carries a concrete date/event_time, else durable semantic."""
    when = (meta.get("event_time") or meta.get("date") or "").strip()
    return ("episodic", when) if when else ("semantic", None)


def reconcile() -> dict:
    """Mirror people, memories, events, and the patient profile into SQLite.
    Returns a small count summary (handy for logs/tests)."""
    now = _now()
    # Stable id so re-running the backfill reuses one migration provenance row
    # instead of accumulating an orphan per boot.
    prov = store.add_provenance(actor="system", source="migration", entered_at=now,
                                provenance_id="migration")
    counts = {"people": 0, "memories": 0, "events": 0, "profile": 0}

    # People (id/name/relationship/has_photo from the Chroma people registry).
    for p in vdb.list_people():
        store.upsert_person(
            p["id"], p.get("name", ""), p.get("relationship", ""),
            bool(p.get("has_photo", False)), created_at=now, updated_at=now,
        )
        counts["people"] += 1

    # Memories — read the RAW collection to recover person_id/scope/date that
    # vdb.list_memories() drops.
    res = vdb.memory_collection.get(include=["documents", "metadatas"])
    ids = res.get("ids", []) or []
    docs = res.get("documents", []) or []
    metas = res.get("metadatas", []) or []
    for i, mem_id in enumerate(ids):
        meta = metas[i] or {}
        kind, event_time = _classify(meta)
        store.upsert_memory(
            mem_id,
            text=docs[i] if i < len(docs) else "",
            kind=kind,
            person_id=meta.get("person_id") or None,
            scope=meta.get("scope"),
            tags=meta.get("tags", ""),
            event_time=event_time,
            created_at=now,
            provenance_id=prov,
        )
        counts["memories"] += 1

    # Events (medications / appointments / etc.).
    for ev in reminders.list_events():
        if not ev.get("id"):
            continue
        store.upsert_event(
            ev["id"], type=ev.get("type", ""), title=ev.get("title", ""),
            notes=ev.get("notes", ""), time=ev.get("time", ""), date=ev.get("date", ""),
            recurrence=ev.get("recurrence", "once"), created_at=now, provenance_id=prov,
        )
        counts["events"] += 1

    # Patient profile (single row).
    store.save_profile(profile.get_profile(), updated_at=now)
    counts["profile"] = 1

    return counts


def reconcile_if_first_run() -> dict | None:
    """Bootstrap SQLite from the legacy Chroma/JSON stores ONLY on a fresh DB.

    After the Step-3 cutover SQLite is the source of truth and writes dual-write,
    so reconciling on every boot does nothing useful — and is actively harmful:
    a memory deleted from SQLite whose Chroma vector survived (a best-effort
    delete that didn't fully take) would be re-imported here as a 'system'
    memory — i.e. a "deleted" memory resurrecting. So we only reconcile when the
    store has no people/memories/events (a genuinely fresh DB). Returns the
    counts when it bootstrapped, or None when it skipped.
    """
    if store.list_people() or store.list_memories() or store.list_events():
        return None
    return reconcile()
