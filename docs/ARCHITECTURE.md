# Belong — Architecture

How Belong is built *today*. (The original hackathon design notes live in [`history/`](./history/) under the working name "Anchor" and are superseded by this doc. Forward plans: [`ROADMAP.md`](./ROADMAP.md). The memory-system design rationale: [`PHASE2_MEMORY_PLAN.md`](./PHASE2_MEMORY_PLAN.md).)

## 1. Topology — everything on the Spark

```
Browser (PWA)  ──relative /api/*──►  Next.js 16 (:3000, prod)
                                        │  next.config.ts rewrites /api/:path* (server-side)
                                        ▼
                                   FastAPI / uvicorn (127.0.0.1:8001)
                                        │  calls as its "brain":
                                        ▼
                                   vLLM Nemotron (localhost:8000/v1, OpenAI-compatible)
```

- The backend is **not** the LLM — it calls a separate **vLLM Nemotron** server that permanently holds `:8000` (`NIM_BASE_URL`). That's why the backend is on **:8001**.
- The browser only ever calls relative `/api/*`; Next rewrites it to `:8001` **server-side**, so there's no CORS/mixed-content and the backend can bind localhost-only.
- The only outbound calls: Toronto Open Data (CKAN), OpenStreetMap tiles, Eventbrite scrape, and (optionally) Web Push. Everything else is on-device.

## 2. Backend layering

```
api/routes.py            HTTP surface (~37 endpoints). Thin — delegates down.
   │ reads ▼                    │ writes ▼
database/store.py          database/writes.py            services/*
(pure SQLite,              (dual-write coordinator:       reminders · profile · places ·
 source of truth)           SQLite + Chroma, ordered)     photos · eventbrite ·
   │                            │                          conversation_memory · consolidation ·
   ▼                            ▼                          observability
database/sqlite_manager.py   database/chroma_manager.py
+ migrations.py (user_version)  (vdb: 3 Chroma collections)
   │                            │
   ▼                            ▼
   SQLite belong.db          ChromaDB (vectors) + data/*.json (legacy mirror) + data/photos/
```

**Key rule:** reads come from `store` (SQLite, authoritative); writes go through `writes` (SQLite **and** Chroma) or the JSON services (which also mirror to SQLite). `store.py` stays pure SQLite — all Chroma coupling lives in `writes.py`.

## 3. Memory & data system

- **SQLite (`belong.db`) is the source of truth** for structured facts: `people`, `relationships`, `profile`, `events`, `memories`, `mood_logs`, and **`provenance`** (who entered a fact, when, how). Schema evolves via dependency-free `PRAGMA user_version` migrations (`migrations.py`, currently v2).
- **ChromaDB** is the **semantic index** over memory text (collection `life_story_memories`), plus `people` and `face_embeddings`. It is rebuildable from SQLite.
- **Legacy JSON** (`events.json`, `profile.json`, `subscriptions.json`) is still dual-written for rollback safety; its readers feed the boot-time `reconcile()`.
- **Memory typing:** every memory is `semantic` (a durable fact — "Sarah is the daughter") or `episodic` (a dated event — "fed the ducks today", `event_time` set). Typing drives retrieval decay.
- **Provenance** is surfaced in reads as `added_by` / `added_at` (e.g. `caregiver`, `patient`, `system`) so the caregiver UI can show *why* Belong knows something.
- **Backfill / reconcile** (`backfill.py`): on every boot, mirrors the live Chroma + JSON into SQLite (idempotent). A transition mechanism while legacy stores remain.

## 4. Retrieval — hybrid rerank (`database/retrieval.py`)

`retrieve(query, k=3)` replaces the old 2-NN lookup:

1. **Candidates** — Chroma vector search over-fetches ~20.
2. **Join + filter** — pull the SQLite rows for those ids; drop superseded/ghost rows.
3. **Rerank** (pure, unit-tested `_score`):
   `w_sim·similarity + w_kw·keyword_overlap + w_rec·recency_decay(kind) + w_freq·use_frequency`
   - decay differs by kind: `episodic` fades fast (~30-day half-life on `event_time`); `semantic` barely decays (~10-year half-life).
   - weights are **tie-breakers** (`1.0 / 0.12 / 0.10 / 0.06`) — tuned via `scripts/eval_retrieval.py` (similarity dominates; the rest break near-ties).
4. **Top-k**, then bump `use_count`/`last_used_at` (frequency feedback). Degrades to `[]` on any failure.

## 5. A companion turn (`POST /ask`)

```
user_input ─► ask_companion():
   build context  = today's date + profile + family roster (from SQLite)
                  + calendar_summary + nearby places (if location)
                  + retrieval.retrieve(user_input)  ← hybrid RAG
   → system prompt (errorless/validation rules) + history + user_input
   → vLLM Nemotron (enable_thinking:false, max_tokens 200)   [timed]
   → reply  (or a canned fallback if the LLM is unreachable)
   → observability.record(trace)            ← retrieved ids/scores, latency, tokens, fallback
   → if not fallback: spawn conversation_memory.capture(user_input)   ← async, non-blocking
```

The companion is grounded entirely in stored facts and instructed never to invent names/relationships or quiz the patient. Family roster comes from SQLite; free-text recall from the reranked retrieval; the schedule from the calendar.

## 6. Conversation memory (`services/conversation_memory.py`)

After a real reply, a background thread distills **one durable fact** the patient shared (a second, tightly-prompted Nemotron call — "use ONLY what was explicitly stated; never invent") and stores it as an **episodic** memory (`actor="patient", source="conversation"`). A cosine **dedup (≥0.85)** guards against the constant repetition typical of dementia. Recall is automatic — these flow through `retrieve()` like any memory and surface in later sessions. Only the patient's words are captured (never the reply ⇒ no feedback loop).

## 7. Consolidation (`services/consolidation.py`)

Once per day (on the reminder scheduler thread), near-duplicate **semantic** memories within the same person scope (cosine ≥0.95) are merged: the best survivor (max `use_count`, newest) is kept and the rest **soft-deleted** via `superseded_by` (which retrieval + readers already filter). Episodic and cross-person memories are never merged; nothing is hard-deleted (provenance preserved).

## 8. Observability (`services/observability.py`)

Every companion turn is traced: retrieved ids+scores, context flags, latency, token usage, fallback. Full detail (incl. the conversation text) goes only to a local gitignored `data/traces.jsonl`. Because the backend is reachable via the public funnel, the HTTP views expose **metrics only**:
- `GET /health` — model-warmup state, LLM reachability, store counts (non-PII).
- `GET /traces` — recent turn metrics + summary (turns, fallback-rate, avg/p95 latency) with **no conversation text**.

## 9. On-device models (`tools/`, `main.py`)

Warmed in a background thread on startup. `audio.py`: faster-whisper STT (multilingual, auto-detect) + Piper TTS (one voice per language via `langdetect`). `vision.py`: InsightFace `buffalo_l` (RetinaFace + ArcFace) on onnxruntime. The LLM is the external vLLM Nemotron. First load is slow (downloads to `~/.insightface`, `~/.cache/huggingface`).

## 10. Reminders & Web Push (`services/reminders.py`)

Events (meds/appointments/activities, with `once|daily|weekly|monthly` recurrence) drive a 20s scheduler thread that `webpush()`-es due events to subscribed devices (VAPID keys in `keys/`). The same thread runs the daily consolidation pass.

## 11. Testing

77 hermetic backend tests (`src/backend/tests/`): the conftest isolates SQLite (`DB_PATH`→tmp), Chroma (→ EphemeralClient), the JSON stores, and `photos.PHOTO_DIR`→tmp, and mocks the LLM + warmups, so tests never touch real patient data or the network. Plus two live eval harnesses: `scripts/eval_companion.py` (grounding/anti-hallucination) and `scripts/eval_retrieval.py` (recall@k benchmark + weight sweep).

## 12. Privacy posture & known gaps

- **On-device:** localhost-bind, faces as embeddings, traces metric-only over HTTP, no third-party AI.
- **Known gaps (tracked in `ROADMAP.md`):**
  - The public repo's **git history** still contains real patient data + the VAPID key + e2e screenshots (untracked going forward; not purged). Remediation: make private + `git filter-repo` + rotate VAPID.
  - **No auth** — the app is reachable, unauthenticated, via the Tailscale funnel.
  - The Hermes web channel's upstream LLM is configured to an off-box IP — confirm/​gate to stay on-thesis.
- **Recently fixed:** the reconcile-resurrection bug (deleted memories reappearing as `system` rows) — `reconcile()` is now gated to a first-run bootstrap only (`reconcile_if_first_run`), since post-cutover SQLite is authoritative and writes dual-write.
