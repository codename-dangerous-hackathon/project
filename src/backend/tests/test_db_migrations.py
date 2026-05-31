"""
Tests for the SQLite foundation (Phase 2 Step 1): migrations create the schema,
are idempotent, and foreign keys are enforced. DB_PATH is redirected to tmp by
the autouse fixture in conftest.py, so these never touch a real belong.db.
"""
import sqlite3

import pytest

import database.sqlite_manager as sqlite_manager

EXPECTED_TABLES = {"provenance", "people", "relationships", "profile", "events", "memories"}


def _tables(conn):
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    return {r[0] for r in rows}


def test_migrations_create_schema_and_stamp_version():
    conn = sqlite_manager.get_connection()
    try:
        assert EXPECTED_TABLES.issubset(_tables(conn))
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
        # indexes exist
        idx = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index'"
        ).fetchall()}
        assert {"idx_memories_person", "idx_memories_kind", "idx_memories_active"} <= idx
    finally:
        conn.close()


def test_migrations_are_idempotent():
    # Two independent connections (each runs run_migrations) must not error and
    # must leave the version and schema unchanged.
    c1 = sqlite_manager.get_connection()
    v1 = c1.execute("PRAGMA user_version").fetchone()[0]
    c1.close()

    c2 = sqlite_manager.get_connection()
    try:
        assert c2.execute("PRAGMA user_version").fetchone()[0] == v1 == 1
        assert EXPECTED_TABLES.issubset(_tables(c2))
    finally:
        c2.close()


def test_foreign_keys_enforced():
    conn = sqlite_manager.get_connection()
    try:
        # A memory referencing a non-existent provenance_id must be rejected.
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO memories (id, text, kind, created_at, provenance_id) "
                "VALUES ('m1', 'hi', 'semantic', '2026-05-30T00:00:00', 'nope')"
            )
            conn.commit()
    finally:
        conn.close()


def test_valid_insert_chain_round_trips():
    conn = sqlite_manager.get_connection()
    try:
        conn.execute(
            "INSERT INTO provenance (id, actor, source, entered_at) "
            "VALUES ('p1', 'caregiver', 'manual_entry', '2026-05-30T00:00:00')"
        )
        conn.execute(
            "INSERT INTO people (id, name, relationship, has_photo, created_at, updated_at) "
            "VALUES ('per1', 'Jeremy', 'Brother', 1, '2026-05-30T00:00:00', '2026-05-30T00:00:00')"
        )
        conn.execute(
            "INSERT INTO memories (id, text, kind, person_id, scope, created_at, provenance_id) "
            "VALUES ('m1', 'He is smart', 'semantic', 'per1', 'person', '2026-05-30T00:00:00', 'p1')"
        )
        conn.commit()
        row = conn.execute(
            "SELECT text, kind, use_count FROM memories WHERE id='m1'"
        ).fetchone()
        assert row["text"] == "He is smart"
        assert row["kind"] == "semantic"
        assert row["use_count"] == 0  # default applied
    finally:
        conn.close()
