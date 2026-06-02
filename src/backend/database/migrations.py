"""
Lightweight, dependency-free SQLite migrations driven by `PRAGMA user_version`.

No SQLAlchemy / Alembic on purpose: this is a single-file, on-device DB with a
handful of tables, and Alembic would fight the "CWD = src/backend, bare
top-level imports" convention the test suite relies on. Each migration is a
`(version, upgrade_fn(conn))` pair; `run_migrations` applies every step whose
version exceeds the DB's current `user_version`, in order, then stamps the new
version. Idempotent — a DB already at the latest version is left untouched.

To evolve the schema: append a new `(N, _vN)` step. Never edit a shipped step.
"""
import sqlite3


def _v1(conn: sqlite3.Connection) -> None:
    """Baseline schema. See docs/PHASE2_MEMORY_PLAN.md §2 for the rationale.

    Provenance is its own table (the citation backbone: who entered a fact,
    when, how) and is created first because fact-bearing tables FK to it.
    """
    conn.executescript(
        """
        -- who entered a fact, when, and how (anti-hallucination citation backbone)
        CREATE TABLE provenance (
            id          TEXT PRIMARY KEY,
            actor       TEXT NOT NULL,          -- 'caregiver' | 'patient' | 'system'
            actor_label TEXT,                   -- optional display, e.g. "Jeremy (caregiver)"
            source      TEXT NOT NULL,          -- 'manual_entry'|'migration'|'consolidation'|...
            entered_at  TEXT NOT NULL           -- ISO8601 — the "on date Z" in the citation
        );

        CREATE TABLE people (
            id           TEXT PRIMARY KEY,      -- reuses the existing Chroma person uuid
            name         TEXT NOT NULL,
            relationship TEXT NOT NULL,
            has_photo    INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );

        -- first-class relationship edges; object_id NULL = the patient
        CREATE TABLE relationships (
            id            TEXT PRIMARY KEY,
            subject_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
            object_id     TEXT REFERENCES people(id) ON DELETE CASCADE,
            kind          TEXT NOT NULL,        -- "is_daughter_of", "is_married_to", ...
            created_at    TEXT NOT NULL,
            provenance_id TEXT NOT NULL REFERENCES provenance(id)
        );

        -- single-row table (id = 'patient')
        CREATE TABLE profile (
            id              TEXT PRIMARY KEY DEFAULT 'patient',
            name            TEXT,
            tagline         TEXT,
            photo           TEXT,
            emergency_name  TEXT,
            emergency_phone TEXT,
            medical         TEXT,
            updated_at      TEXT NOT NULL
        );

        -- meds / appointments / activities (was data/events.json)
        CREATE TABLE events (
            id            TEXT PRIMARY KEY,
            type          TEXT NOT NULL,        -- medication|appointment|activity|family|waste_pickup
            title         TEXT NOT NULL,
            notes         TEXT DEFAULT '',
            time          TEXT NOT NULL,        -- "HH:MM"
            date          TEXT DEFAULT '',      -- "YYYY-MM-DD"
            recurrence    TEXT DEFAULT 'once',  -- once|daily|weekly|monthly
            created_at    TEXT NOT NULL,
            provenance_id TEXT REFERENCES provenance(id)
        );

        -- canonical memory text + episodic/semantic typing + decay signals.
        -- id == the Chroma vector id (life_story_memories) for the same memory.
        CREATE TABLE memories (
            id            TEXT PRIMARY KEY,
            text          TEXT NOT NULL,
            kind          TEXT NOT NULL,        -- 'semantic' | 'episodic'
            person_id     TEXT REFERENCES people(id) ON DELETE CASCADE,  -- NULL = general/patient
            scope         TEXT,                 -- 'person' | 'general'
            tags          TEXT DEFAULT '',
            event_time    TEXT,                 -- episodic: when it happened; semantic: NULL
            created_at    TEXT NOT NULL,        -- when entered (decay clock for semantic)
            last_used_at  TEXT,                 -- bumped when retrieval surfaces it
            use_count     INTEGER NOT NULL DEFAULT 0,
            superseded_by TEXT REFERENCES memories(id),  -- consolidation soft-delete
            provenance_id TEXT NOT NULL REFERENCES provenance(id)
        );

        CREATE INDEX idx_memories_person ON memories(person_id);
        CREATE INDEX idx_memories_kind   ON memories(kind);
        CREATE INDEX idx_memories_active ON memories(superseded_by);  -- NULL = live
        """
    )


def _v2(conn: sqlite3.Connection) -> None:
    """Patient mood check-ins (Phase 4). A new SQLite-native fact type that reuses
    the provenance table — validates forward migration of the schema."""
    conn.executescript(
        """
        CREATE TABLE mood_logs (
            id            TEXT PRIMARY KEY,
            mood          TEXT NOT NULL,        -- great|good|okay|low|sad
            note          TEXT DEFAULT '',
            created_at    TEXT NOT NULL,
            provenance_id TEXT REFERENCES provenance(id)
        );
        CREATE INDEX idx_mood_created ON mood_logs(created_at);
        """
    )


# Append-only list of (version, upgrade_fn). Never edit a shipped step.
MIGRATIONS = [
    (1, _v1),
    (2, _v2),
]


def run_migrations(conn: sqlite3.Connection) -> int:
    """Apply any pending migrations in order; return the resulting version.
    Idempotent — returns immediately if already at the latest version."""
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    target = MIGRATIONS[-1][0] if MIGRATIONS else 0
    if current >= target:
        return current
    for version, upgrade in MIGRATIONS:
        if version > current:
            upgrade(conn)
            # PRAGMA can't be parameterized; version is an int from our own list.
            conn.execute(f"PRAGMA user_version = {version}")
            conn.commit()
            current = version
    return current
