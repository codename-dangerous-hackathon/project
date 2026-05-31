"""
Typed SQLite data-access layer for Belong (Phase 2 Step 2).

This is the structured source of truth the app is migrating onto. In Step 2 it is
populated by `backfill.reconcile()` and exercised by tests; the route layer adopts
it in Step 3 (until then routes still read/write Chroma + JSON, so nothing here is
on a hot path yet).

Conventions:
  * One short-lived connection per call (thread-safe for the app + scheduler).
  * Writers are idempotent upserts keyed on `id` (INSERT ... ON CONFLICT DO UPDATE)
    so a re-run of the backfill never duplicates rows.
  * Readers return the SAME dict shapes the existing routes already emit (see
    api/routes.py and database/chroma_manager.py), so the Step 3 cutover is a
    drop-in swap.
"""
import uuid
from contextlib import closing

from database import sqlite_manager

PROFILE_FIELDS = ("name", "tagline", "photo", "emergency_name", "emergency_phone", "medical")


# ----- writers ---------------------------------------------------------------

def add_provenance(actor: str, source: str, entered_at: str, actor_label: str | None = None,
                   provenance_id: str | None = None) -> str:
    """Record who entered a fact, when, and how. Returns the provenance id.
    Pass a stable `provenance_id` to upsert a shared row (e.g. the single
    'migration' provenance reused by the idempotent backfill); omit it for a
    fresh per-fact uuid."""
    pid = provenance_id or str(uuid.uuid4())
    with closing(sqlite_manager.get_connection()) as conn:
        conn.execute(
            "INSERT INTO provenance (id, actor, actor_label, source, entered_at) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "  actor=excluded.actor, actor_label=excluded.actor_label, "
            "  source=excluded.source, entered_at=excluded.entered_at",
            (pid, actor, actor_label, source, entered_at),
        )
        conn.commit()
    return pid


def upsert_person(person_id: str, name: str, relationship: str, has_photo: bool,
                  created_at: str, updated_at: str) -> None:
    with closing(sqlite_manager.get_connection()) as conn:
        conn.execute(
            "INSERT INTO people (id, name, relationship, has_photo, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "  name=excluded.name, relationship=excluded.relationship, "
            "  has_photo=excluded.has_photo, updated_at=excluded.updated_at",
            (person_id, name, relationship, 1 if has_photo else 0, created_at, updated_at),
        )
        conn.commit()


def upsert_event(event_id: str, type: str, title: str, notes: str, time: str, date: str,
                 recurrence: str, created_at: str, provenance_id: str | None = None) -> None:
    with closing(sqlite_manager.get_connection()) as conn:
        conn.execute(
            "INSERT INTO events (id, type, title, notes, time, date, recurrence, created_at, provenance_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "  type=excluded.type, title=excluded.title, notes=excluded.notes, "
            "  time=excluded.time, date=excluded.date, recurrence=excluded.recurrence, "
            "  provenance_id=excluded.provenance_id",
            (event_id, type, title, notes, time, date, recurrence, created_at, provenance_id),
        )
        conn.commit()


def upsert_memory(memory_id: str, text: str, kind: str, person_id: str | None, scope: str | None,
                  tags: str, event_time: str | None, created_at: str, provenance_id: str) -> None:
    with closing(sqlite_manager.get_connection()) as conn:
        conn.execute(
            "INSERT INTO memories (id, text, kind, person_id, scope, tags, event_time, created_at, provenance_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "  text=excluded.text, kind=excluded.kind, person_id=excluded.person_id, "
            "  scope=excluded.scope, tags=excluded.tags, event_time=excluded.event_time, "
            "  provenance_id=excluded.provenance_id",
            (memory_id, text, kind, person_id, scope, tags or "", event_time, created_at, provenance_id),
        )
        conn.commit()


def save_profile(updates: dict, updated_at: str) -> None:
    """Upsert the single patient profile row (id='patient')."""
    vals = {k: (updates.get(k) or "") for k in PROFILE_FIELDS}
    cols = ", ".join(PROFILE_FIELDS)
    placeholders = ", ".join("?" for _ in PROFILE_FIELDS)
    setters = ", ".join(f"{k}=excluded.{k}" for k in PROFILE_FIELDS)
    with closing(sqlite_manager.get_connection()) as conn:
        conn.execute(
            f"INSERT INTO profile (id, {cols}, updated_at) VALUES ('patient', {placeholders}, ?) "
            f"ON CONFLICT(id) DO UPDATE SET {setters}, updated_at=excluded.updated_at",
            (*[vals[k] for k in PROFILE_FIELDS], updated_at),
        )
        conn.commit()


# ----- readers (mirror existing route shapes) --------------------------------

def list_people() -> list[dict]:
    with closing(sqlite_manager.get_connection()) as conn:
        rows = conn.execute(
            "SELECT id, name, relationship, has_photo, "
            "  (SELECT COUNT(*) FROM memories m WHERE m.person_id = p.id AND m.superseded_by IS NULL) AS memory_count "
            "FROM people p ORDER BY name"
        ).fetchall()
    return [
        {"id": r["id"], "name": r["name"], "relationship": r["relationship"],
         "has_photo": bool(r["has_photo"]), "memory_count": r["memory_count"]}
        for r in rows
    ]


def get_person(person_id: str) -> dict | None:
    with closing(sqlite_manager.get_connection()) as conn:
        r = conn.execute(
            "SELECT id, name, relationship, has_photo FROM people WHERE id = ?", (person_id,)
        ).fetchone()
    if not r:
        return None
    return {"id": r["id"], "name": r["name"], "relationship": r["relationship"],
            "has_photo": bool(r["has_photo"])}


def list_memories_for_person(person_id: str) -> list[dict]:
    with closing(sqlite_manager.get_connection()) as conn:
        rows = conn.execute(
            "SELECT id, text FROM memories WHERE person_id = ? AND superseded_by IS NULL", (person_id,)
        ).fetchall()
    return [{"id": r["id"], "text": r["text"]} for r in rows]


def list_general_memories() -> list[dict]:
    with closing(sqlite_manager.get_connection()) as conn:
        rows = conn.execute(
            "SELECT id, text FROM memories WHERE person_id IS NULL AND superseded_by IS NULL"
        ).fetchall()
    return [{"id": r["id"], "text": r["text"]} for r in rows]


def list_events() -> list[dict]:
    with closing(sqlite_manager.get_connection()) as conn:
        rows = conn.execute(
            "SELECT id, type, title, notes, time, date, recurrence FROM events"
        ).fetchall()
    return [dict(r) for r in rows]


def get_profile() -> dict:
    with closing(sqlite_manager.get_connection()) as conn:
        r = conn.execute(
            f"SELECT {', '.join(PROFILE_FIELDS)} FROM profile WHERE id = 'patient'"
        ).fetchone()
    if not r:
        return {k: "" for k in PROFILE_FIELDS}
    return {k: (r[k] or "") for k in PROFILE_FIELDS}
