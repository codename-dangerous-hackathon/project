# Belong Phase 2 — Memory & Data System: Implementation Plan

> Design output (not yet implemented). Companion to [`ROADMAP.md`](./ROADMAP.md) Phase 2. Baseline eval to beat: `test-results/eval-companion-0.json` (11/13, with the 2 fails being harness artifacts — grounding is effectively 13/13).

## 0. Grounding: what exists today (verified)

- **`database/chroma_manager.py`** — `vdb` singleton, three Chroma collections: `people`, `face_embeddings`, `life_story_memories`. Memories carry ad-hoc metadata (`person_id`, `person_name`, `relationship`, `scope`, `tags`, `date`). Retrieval is single-shot `query_memories(n_results=2/3)` with no ranking/filter. **Structured person/relationship facts currently live inside a vector collection** — i.e., structured data is stored semantically.
- **`services/reminders.py`** — `events.json` + `subscriptions.json` (file-locked JSON). `calendar_summary()` renders schedule text; a 20s `start_scheduler()` thread fires Web Push. Recurrence in `_occurs_on`.
- **`services/profile.py`** — `profile.json`, fixed `_FIELDS`.
- **`api/routes.py`** — frontend contract (`/people`, `/people/{id}`, `/people/{id}/memories`, `/journal`, `/memories`, `/events`, `/profile`, `/identify`, `/briefing`, …). **These response shapes must not change.**
- **`agents/companion.py`** — `ask_companion()` stuffs date + profile + `build_family_context()` + `calendar_summary()` + `fetch_revelant_memories()` (2 nearest vectors) into one prompt. Graceful fallback string on LLM failure.
- **`scripts/eval_companion.py`** — live `/ask` battery (grounded/trap/brevity/language/errorless). The regression metric; asserts against current `/journal`,`/events`,`/profile`.
- **`tests/conftest.py`** — swaps Chroma `PersistentClient`→`EphemeralClient` and redirects JSON stores to `tmp_path`. **Any new SQLite store must be redirectable the same way or tests will touch real data.**
- **Embeddings**: Chroma's bundled default ONNX `all-MiniLM-L6-v2` (no explicit embedding function set).

## 1. Riskiest decisions — recommended call on each

- **D1 — Migrations:** lightweight `PRAGMA user_version` + ordered migration functions in `migrations.py`, stdlib `sqlite3`. **Do NOT add SQLAlchemy/Alembic** (fights the "CWD=src/backend, bare imports" convention the conftest relies on). Door stays open to add Alembic later.
- **D2 — Source of truth:** SQLite becomes authoritative for structured facts; Chroma becomes a *derived, rebuildable* semantic index keyed by `memory_id`. SQLite writes; Chroma is rebuildable from SQLite (makes migration + graceful degradation tractable).
- **D3 — Faces:** leave face vectors in Chroma; `people` row in SQLite is source of truth for name/relationship/has_photo. `/identify` stays a pure-vector path (works even if SQLite is down); identity metadata mirrored into face metadata as today.
- **D4 — Episodic vs semantic:** one `memories` table with a `kind` column + `event_time`, **not** two tables. The split is enforced by retrieval/decay rules keyed on `kind`, not physical tables.
- **D5 — Reranker:** **no ML reranker.** A deterministic local score = vector sim + keyword overlap + temporal-decay + reference-frequency. A cross-encoder = a second model to warm + latency risk for the TTS loop. Fully testable/tunable against the eval.
- **D6 — Embedding swap:** **defer.** Keep MiniLM; build hybrid + measure recall@k first; treat any swap as a separate eval-gated step (Step 8).
- **D7 — No flag day:** dual-write + read-through behind a `store` facade; idempotent startup backfill from JSON+Chroma; route response shapes preserved so the frontend never sees a cutover.

## 2. Proposed SQLite schema

Single DB at `src/backend/database/data/belong.db` (already-gitignored dir). `PRAGMA user_version` drives migrations; `PRAGMA foreign_keys=ON` per connection.

```sql
people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, relationship TEXT NOT NULL,
  has_photo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL )

relationships (                              -- first-class edges
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  object_id  TEXT,                           -- NULL = the patient; else REFERENCES people(id)
  kind TEXT NOT NULL,                        -- "is_daughter_of", "is_married_to", ...
  created_at TEXT NOT NULL, provenance_id TEXT NOT NULL REFERENCES provenance(id) )

profile (                                    -- single row id='patient'
  id TEXT PRIMARY KEY DEFAULT 'patient', name TEXT, tagline TEXT, photo TEXT,
  emergency_name TEXT, emergency_phone TEXT, medical TEXT, updated_at TEXT NOT NULL )

events (                                     -- was events.json
  id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, notes TEXT DEFAULT '',
  time TEXT NOT NULL, date TEXT DEFAULT '', recurrence TEXT DEFAULT 'once',
  created_at TEXT NOT NULL, provenance_id TEXT REFERENCES provenance(id) )

memories (                                   -- canonical text + typing + decay signals
  id TEXT PRIMARY KEY,                        -- same id as the Chroma vector
  text TEXT NOT NULL, kind TEXT NOT NULL,     -- 'semantic' | 'episodic'
  person_id TEXT REFERENCES people(id) ON DELETE CASCADE,  -- NULL = general/patient
  scope TEXT, tags TEXT DEFAULT '',
  event_time TEXT,                            -- episodic: when it happened; semantic: NULL
  created_at TEXT NOT NULL, last_used_at TEXT, use_count INTEGER NOT NULL DEFAULT 0,
  superseded_by TEXT REFERENCES memories(id), -- consolidation soft-delete
  provenance_id TEXT NOT NULL REFERENCES provenance(id) )

provenance (                                 -- who entered it, when, how (citation backbone)
  id TEXT PRIMARY KEY, actor TEXT NOT NULL,   -- 'caregiver'|'patient'|'system'
  actor_label TEXT, source TEXT NOT NULL,     -- 'manual_entry'|'migration'|'consolidation'|...
  entered_at TEXT NOT NULL )

CREATE INDEX idx_memories_person ON memories(person_id);
CREATE INDEX idx_memories_kind   ON memories(kind);
CREATE INDEX idx_memories_active ON memories(superseded_by);
```

**Provenance** is its own table so one entry-event cites identically across facts and we can render "Belong said X because you (Jeremy) told it on 2026-04-12." The Chroma vector entry denormalizes `{actor, entered_at, kind}` into its metadata so retrieval can cite/filter without a SQLite round-trip on the hot path.

## 3. Retrieval pipeline after the change (a companion turn)

New `database/retrieval.py`: `retrieve(query, person_scope=None, k=5) -> list[RankedMemory]`. `ask_companion` calls this instead of `fetch_revelant_memories`.

1. **Candidate gen (vector):** Chroma top-N over-fetch (N≈20); pass `where={"person_id": …}` when a known person is named.
2. **Filter:** drop `superseded_by != NULL`; compute keyword-overlap (query↔text+tags) to catch exact name/med hits vectors blur.
3. **Deterministic rerank:** `score = w_v·sim + w_k·keyword + w_r·recency_decay(kind, created_at|event_time) + w_f·log(1+use_count)`. **Decay differs by kind:** episodic decays fast on `event_time`; semantic decays slowly on `created_at` (durable facts stay high). `exp(-Δdays/half_life)`, `half_life_semantic >> half_life_episodic`.
4. **Top-k + bump** `use_count`/`last_used_at` on survivors (frequency feeds future ranks).
5. **Return with citations** (provenance), rendered as a cited notes block.

**Structured facts (roster, schedule, profile) come from SQLite directly**, not vector search — "who is my brother" is answered from a typed row, not a nearest-neighbor guess. Graceful degradation: Chroma failure ⇒ `retrieve()` returns `[]` (companion still has structured roster/schedule); SQLite failure ⇒ fall back to Chroma `people`/memories (current behavior).

## 4. Phased implementation order (each step re-runs the eval as its gate)

1. **DB foundation** — `sqlite_manager.py` (lazy `get_connection`, `DB_PATH` constant for conftest), `migrations.py` (`user_version`). No read path changes; `pytest` still isolates.
2. **Store facade + backfill** — `store.py` (typed accessors, dual-write SQLite+Chroma), `backfill.py` (idempotent JSON+Chroma → SQLite, `source='migration'`, marker-guarded), wired into `main.py` startup in try/except. Extend `/reset-demo` to seed SQLite too. **Capture eval baseline here.**
3. **Route cutover (pure refactor)** — routes/`reminders`/`profile` call `store.*`; response shapes unchanged. Update `conftest.py` to monkeypatch `DB_PATH`→tmp. **Eval+pytest must match baseline exactly.**
4. **Episodic/semantic typing + provenance** — `add_memory` takes `kind`+provenance; denormalize into Chroma metadata. Additive; baseline unchanged.
5. **Hybrid retrieval + rerank** — `retrieval.py`; companion uses it. **The measured win:** expect `grounded` up, `trap` flat-or-up, others unaffected; tune weights against the harness; record recall@k.
6. **Temporal decay tuning** — validate half-lives; add recency eval cases + seed.
7. **Nightly consolidation** — `consolidation.py` (near-dupe `semantic` merge via `superseded_by` soft-delete, never destroy provenance; episodic not merged); reuse the existing 20s scheduler with a once-per-day guard. Eval must hold; unit-test that superseded rows are excluded.
8. **(Optional, eval-gated) embedding swap** — only on measured recall@k win; full re-embed rebuildable from SQLite `memories.text`.

## 5. Migration strategy (no flag day)
Additive tables first → idempotent startup backfill (never deletes JSON/Chroma source) → route cutover is a pure shape-preserving refactor → rollback = revert commit (no data loss, SQLite additive until Step 3) → `/reset-demo` reseeds both stores.

## 6. Eval tie-in
Baseline at Step 2; Steps 3–4 must reproduce it exactly (any movement = a bug); Step 5 is the measured improvement gated on per-category totals; Steps 6–7 gated on "no `grounded` regression"; Step 8 gated purely on recall@k delta. The harness hits live `/ask`, so it validates the whole new pipeline end-to-end.

### New modules to add
`database/{sqlite_manager,migrations,store,backfill,retrieval}.py`, `services/consolidation.py`.
