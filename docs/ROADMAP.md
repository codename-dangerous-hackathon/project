# Belong — Engineering Roadmap

> North star (chosen 2026-05-30): **deep engineering playground** — maximize technical depth (memory/RAG architecture, eval harness, tests, observability), not just polish. This doc organizes the work into phases. Check items off as you go.

The MVP works and the README is current. This roadmap takes it from "works in a demo" to "deeply engineered." Phases are ordered so each builds a foundation for the next; within a phase, items are roughly priority-ordered.

---

## Progress log

- **2026-05-30 (cont.)** — **Phase 2 Step 7 done**: `services/consolidation.py` — once-a-day pass that clusters near-duplicate *semantic* memories (cosine ≥0.95, same person scope), keeps the best (use_count→newest), soft-deletes the rest via `superseded_by` (already filtered by retrieval + readers). Episodic/cross-person never merged; non-destructive/reversible; hooked into the existing 20s scheduler (`maybe_run`, once/calendar-day). 60 tests green; eval unchanged. **Remaining: Step 8** (eval-gated embedding-model swap — optional, only on a measured recall win).
- **2026-05-30 (cont.)** — **Phase 2 Step 6 done** (the "measure the win"): added `scripts/eval_retrieval.py` — a hermetic synthetic recall benchmark (recall@1/@3 + MRR, hybrid vs vector-only baseline, weight sweep). It showed the original rerank weights were too aggressive (no net win); retuned to **tie-breaker** magnitude (`0.12/0.10/0.06`) → recall@1 0.90→1.00 on the synthetic set, companion eval unchanged. 54 tests green (+win-guard). Caveat: ~10-query synthetic set — proves the mechanism, not real-user recall. Remaining Phase 2: Step 7 (nightly consolidation), Step 8 (eval-gated embedding swap).
- **2026-05-30 (cont.)** — **Phase 2 Steps 4 & 5 done**: Step 4 surfaces memory provenance (`added_by`/`added_at`) in `/people/{id}`,`/journal`,`/memories` via a provenance JOIN (additive). Step 5 = `database/retrieval.py` — hybrid reranker (vector sim + keyword overlap + temporal decay by kind + use-frequency, with usage feedback) replacing the companion's 2-NN lookup; pure scoring unit-tested, graceful-degrades to []. Backend tests **53 green**; eval unchanged (6/6 grounded). **Open follow-up:** measuring the recall@k *win* needs a richer seed than ~5 facts (extend `eval_companion.py` + `/reset-demo`) and weight tuning. Remaining Phase 2: Step 6 (decay tuning), Step 7 (nightly consolidation), Step 8 (eval-gated embedding swap).
- **2026-05-30 (cont.)** — **Phase 2 Step 3 done**: route cutover — `store.py` (SQLite) is now the read source of truth for people/memories/events/profile; writes go through a new `database/writes.py` dual-write coordinator (SQLite authoritative + Chroma/JSON mirror). Semantic retrieval + face matching stay on Chroma; legacy `/enroll`+`/faces` untouched. Backend tests now **44 green** (+11; centralized Chroma isolation in conftest). Verified live: `/people` serves from SQLite, grounding eval unchanged. **Next: Step 4** (provenance surfacing) then **Step 5** (hybrid retrieval + rerank — the measured win).
- **2026-05-30 (cont.)** — **Phase 2 Step 2 done**: `database/store.py` (typed SQLite accessors) + `database/backfill.py` (`reconcile()`, idempotent JSON+Chroma → SQLite, shared `migration` provenance) wired into `main.py` startup (runs every boot, graceful). Still additive — routes unchanged. Backend tests now 33 green; live boot reconciled real data (4 people / 5 memories / 1 event / profile) read-only on sources; eval unchanged. **Next: Step 3** (route cutover — SQLite becomes authoritative + Chroma dual-write on new writes).
- **2026-05-30** — Phase 0 cleanup done: deleted dead modules (`tools/events.py`, `tools/toronto_db.py`, `database/sqlite_manager.py` [old], the duplicate `GET /events` handler) + 5 scaffold SVGs; moved the two "Anchor"-era spec docs to `docs/history/` with banners. `.claude/` toolkit + the secrets hook landed. Backend test suite stood up (now 24 tests, green). Fixed the `_occurs_on` daily start-date bug (+regression test). **Phase 2 Step 1 (DB foundation)** landed: `database/sqlite_manager.py` + `database/migrations.py` (user_version migrations, v1 schema) + isolation in conftest + migration tests. Nothing reads from SQLite yet (additive).

## Phase 0 — Hygiene & foundations (clear the decks)

Cheap, high-signal cleanup so later work sits on solid ground. All findings below came from a full-repo audit on 2026-05-30.

### Dead code to delete
- [ ] `src/backend/tools/events.py` — 154-line Eventbrite scraper, **never imported**. The same logic is (worse) inlined in a route; delete the module.
- [ ] `src/backend/tools/toronto_db.py` — stub `get_nearest_community_center()` that only `pass`es. `services/places.py` does this for real.
- [ ] `src/backend/database/sqlite_manager.py` — full SQLite schema (caregivers/patients/appointments/…) that **nothing uses**; all data flows through Chroma + JSON. Delete, OR resurrect it intentionally in Phase 2 (see note there).
- [ ] **Duplicate `GET /events` route** in `api/routes.py` (~L251 calendar list vs ~L409 inline Eventbrite scraper). Two handlers, same path — only the last registered wins. Decide the contract: keep calendar listing on `/events`, keep discovery on `/discover/events`, and delete the inline scraper (use `services/eventbrite.py`, which is the clean version already wired to `/discover/events`).
- [ ] Unused Next scaffold assets: `public/{next,vercel,file,window,globe}.svg` — none referenced.
- [ ] `src/frontend/app/v1/` route — confirm whether still used by the Hermes page; if not, remove.

### Doc drift to fix
- [ ] `docs/architecture_features.md` + `docs/claude-output.md` still say **"Anchor"** and reference **Nemotron-Mini-4B**; the app is **"Belong"** on **Nemotron Nano 30B**. Either update them to match reality or clearly mark them as historical design notes (move to `docs/history/`). The README is the source of truth.
- [ ] Spec marks "Daily Briefing" + "Photo Memory Journal" as P0/done, but the e2e tests mark them `fixme` (no UI). Reconcile: either build the UI (Phase 4) or downgrade in the spec.

### Privacy remediation (you chose: roadmap, not this session)
The repo `codename-dangerous-hackathon/project` is **public**, and real patient data (`chroma.sqlite3`) + the VAPID private key are **recoverable from git history** (untracking them did not purge history). This directly contradicts the "nothing leaves the box" thesis. Exact steps when you're ready:
- [ ] `gh repo edit --visibility private` (fastest risk reduction; coordinate — it's a shared team repo).
- [ ] Purge from history: `git filter-repo --path src/backend/keys/vapid_private.pem --path src/backend/database/data --path src/backend/data --invert-paths` then force-push. **Destructive + rewrites shared history** — every collaborator must re-clone. Back up first (`~/belong-data-backup-*.tar.gz`).
- [ ] **Rotate the VAPID keypair** (the old one is compromised the moment it was public): regenerate via `py_vapid`, replace `keys/`, re-subscribe devices.
- [ ] Investigate the Hermes upstream: `src/frontend/app/v1/[...path]/route.ts` hardcodes off-box IP `10.10.53.32:8643`. Confirm it's local or env-gate it; an off-box LLM breaks the thesis. (The new `privacy-auditor` subagent watches for exactly this.)
- [ ] Guard rail is already in place: `.claude/hooks/guard-no-secrets.sh` blocks Claude from `git add`/`commit`-ing these paths going forward.

---

## Phase 1 — Testing & eval harness (make quality measurable)

You can't "deeply engineer" what you can't measure. The backend has **zero automated tests** today.
- [ ] Add `pytest` (+ `httpx`) to `requirements.txt`; create `src/backend/tests/` with a `conftest.py` that isolates state (tmp Chroma + tmp JSON stores — never touch real patient data) and mocks the LLM + on-device models. Use the **`test-author`** subagent.
- [ ] First test targets: companion anti-hallucination (mocked facts in → no invented names out), `reminders._occurs_on` recurrence (once/daily/weekly/monthly), `places` haversine + category normalization, people/memories/events route contracts.
- [ ] **Companion eval harness** (`scripts/eval_companion.py`, driven by `/eval-companion`): a scored battery for grounding, hallucination traps, brevity, language-matching, errorless tone. This is your regression net for every prompt/RAG change — treat the score as a KPI.
- [ ] CI: a GitHub Action running `pytest` + `eslint` + `playwright` on push (frontend e2e needs the app + a mocked or tiny LLM; gate it behind a label if the model is too heavy for CI).

**Bugs surfaced while standing up tests / eval (decide + fix):**
- [ ] `reminders._occurs_on` (`services/reminders.py:148`): the `daily` branch `return True` runs **before** the `if ed > today` start-date guard that `weekly`/`monthly` respect. A med set to recur *daily starting next week* fires push reminders **today**. Fix: move the start-date guard above the `daily` check. (Low severity; a real behavior bug, left intentionally unfixed so you can confirm the intended semantics.)
- [ ] `scripts/eval_companion.py` harness heuristics are noisy: `langdetect` is unreliable on short replies (flagged a correct French answer as Dutch), and the brevity rule (≤3 sentences) is too strict for legitimate family enumerations. Refine: only run langdetect on replies >~40 chars (or use the LLM's own language signal); relax/contextualize brevity. Don't let harness noise hide real regressions.

---

## Phase 2 — Memory & data system (the deep-engineering centerpiece)

> 📐 **Detailed design ready: [`docs/PHASE2_MEMORY_PLAN.md`](./PHASE2_MEMORY_PLAN.md)** — schema, retrieval pipeline, 8-step order, migration strategy, eval gates.

You specifically called this out. Today: 3 flat Chroma collections + JSON files; retrieval is single-shot nearest-neighbor with no ranking, provenance, or temporal awareness. Upgrade it into a real memory system.

- [ ] **Typed, relational core.** Reintroduce SQLite (resurrect `sqlite_manager.py` with intent) as the source of truth for *structured* facts — people, relationships, events, meds, profile — with foreign keys and migrations (Alembic). Keep Chroma purely as the *semantic index* over free-text memories. Today JSON files are the de-facto DB; that doesn't scale or stay consistent.
- [ ] **Episodic vs semantic memory.** Separate "events that happened" (episodic: a visit, a phone call, dated) from "durable facts" (semantic: "Sarah is the daughter"). Different retrieval + decay rules.
- [ ] **Provenance & citations.** Every fact the companion uses should carry *who entered it and when*, so the model can ground answers and you can show the caregiver "Belong said this because you told it X on date Y." Directly strengthens the anti-hallucination thesis.
- [ ] **Hybrid retrieval + rerank.** Combine vector search with keyword/metadata filters (per-person scope already exists) and add a lightweight reranker; measure recall@k with the Phase 1 eval harness before/after.
- [ ] **Temporal decay & consolidation.** Recent + frequently-referenced memories rank higher; periodically consolidate redundant memories (a nightly local job — fits the existing scheduler).
- [ ] **Better embeddings, still on-device.** Benchmark `all-MiniLM-L6-v2` vs a stronger local model on your eval set; only swap if recall improves.
- [ ] Migration script + the `/reset-demo` command keep dev/test data clean throughout.

---

## Phase 3 — Agent architecture (from prompt-stuffing to tool-using)

Today `companion.py` stuffs everything (date, family, schedule, places, RAG) into one prompt every turn. That caps reasoning and wastes context.
- [ ] **Tool-calling companion.** Expose memory lookup, schedule query, person identification, and nearest-place as *tools* the model calls on demand (the served Nemotron is OpenAI-compatible — use function calling) instead of pre-stuffing. Cleaner, cheaper, more accurate.
- [ ] **Structured grounding contract.** Have the model return which facts it used (ties into Phase 2 provenance); reject/repair answers that cite no source when they assert a proper noun.
- [ ] **Guardrail layer.** A deterministic post-check: if the reply contains a name not in the known roster, regenerate or fall back. Make anti-hallucination *enforced*, not just *requested*.
- [ ] **Observability/tracing** for each turn: prompt, tools called, facts retrieved, latency, token counts → a local trace log you can inspect. Essential for tuning and for the eval harness.

---

## Phase 4 — UX polish & missing features

- [ ] Build the **Daily Briefing** patient UI (`/briefing` backend already exists).
- [ ] **Photo Memory Journal** with voice captions (currently text-only).
- [ ] Accessibility pass for the patient app: larger tap targets, higher contrast, simpler flows, reduced-motion — the actual users have cognitive impairment. This is real engineering, not just CSS.
- [ ] Caregiver dashboard: surface the new provenance/trace data ("what Belong knows and why").

---

## Phase 5 — Observability & ops

- [ ] Structured logging (JSON logs, levels) across the backend; a `/health` endpoint that reports model-warmup state + LLM reachability.
- [ ] Metrics for the model loop (latency, fallback rate, eval score over time) — even a local dashboard.
- [ ] Graceful degradation contract: define + test what each feature does when the LLM / a model / the network is down (the patient app must never hard-crash).

---

## How Claude Code accelerates each phase
See `docs/CLAUDE_CODE_GUIDE.md`. Quick map:
- **Phase 0 cleanup** → `/code-review high`, the `privacy-auditor` subagent, the secrets hook.
- **Phase 1 tests** → the `test-author` subagent, `/eval-companion`.
- **Phase 2/3 design** → **plan mode** + the `Plan` subagent before coding; spawn parallel `Explore` agents to map subsystems.
- **Verification throughout** → `/verify`, `/run`, `/reset-demo`.
