"""
SQLite foundation for Belong's structured data (Phase 2 — Memory & data system).

This is the source of truth for *typed* facts — people, relationships, events,
profile, and memory rows + provenance. ChromaDB remains the semantic index over
memory text (see database/chroma_manager.py). Nothing reads from this module yet;
it is introduced additively (Phase 2 Step 1) ahead of the store facade.

Design notes:
  * Connection-per-call. The FastAPI app and the 20s scheduler thread both touch
    this, and a single sqlite3 connection isn't safe to share across threads.
    get_connection() hands back a fresh connection with FK enforcement on.
  * Migrations run on every get_connection() but are idempotent and cheap — a
    DB already at the latest PRAGMA user_version is left untouched (one PRAGMA
    read). This is deliberately keyed on the *connection's* version rather than a
    process-global flag, so tests that redirect DB_PATH to a fresh tmp file get a
    correctly-migrated DB (mirrors how the Chroma singleton is swapped in
    conftest.py).
  * DB_PATH is a module-level constant so tests can monkeypatch it to tmp_path.
"""
import os
import sqlite3

from database import migrations

_BASE = os.path.dirname(os.path.dirname(__file__))  # src/backend
DB_PATH = os.path.join(_BASE, "database", "data", "belong.db")


def get_connection() -> sqlite3.Connection:
    """A fresh SQLite connection (row access + foreign keys on), migrated to the
    latest schema. Caller is responsible for closing it (use as a context
    manager or call .close())."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    migrations.run_migrations(conn)
    return conn
