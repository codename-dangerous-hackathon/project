# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Belong** (internal codename "Anchor") is a 100%-on-device AI companion for people with dementia and their caregivers, built for the NVIDIA Spark (GB10) hackathon. A Next.js 16 PWA frontend talks to a FastAPI backend; all AI (LLM, speech, face) runs locally on the box. Nothing leaves the device except optional Toronto Open Data lookups.

## Commands

All orchestration is via the root `Makefile`:

- `make install` — venv + `pip install -r requirements.txt`, then `npm install` in `src/frontend`
- `make build` — Next.js production build (`cd src/frontend && npm run build`)
- `make start` — backend (uvicorn on **:8001**, `--reload`) + frontend (`npm start`, production) in the background; depends on `make build` first
- `make stop` / `make logs` / `make clean`

Lint frontend: `cd src/frontend && npm run lint` (eslint).

### E2E tests (Playwright)
The app **must already be running** (`make build && make start`) — backend on :8001, frontend prod on :3000. Then:
```
cd src/frontend && npx playwright test              # all
cd src/frontend && npx playwright test -g "name"    # single test by title
```
Tests feed real audio/faces through the real models via Chromium fake-media flags (`e2e/fixtures/voice_sarah.wav`, `voice_fr.wav`, `faceA.jpg`, `faceB.jpg`). Service workers are blocked in tests to avoid stale-cache flakiness.

## Architecture

```
src/backend/   FastAPI app (127.0.0.1:8001 only)
  main.py              bootstrap; warms Whisper/Piper/InsightFace in a bg thread on startup; starts reminder scheduler
  api/routes.py        ALL HTTP endpoints (single router, ~486 lines)
  agents/companion.py  RAG companion: assembles context → calls local Nemotron
  database/chroma_manager.py   ChromaDB (3 collections, see below)
  tools/audio.py       faster-whisper STT + Piper TTS
  tools/vision.py      InsightFace (buffalo_l) enroll/recognize
  services/            reminders · places · photos · profile · eventbrite
  data/                events.json, profile.json, subscriptions.json, photos/
  keys/                VAPID keypair for Web Push
src/frontend/  Next.js 16 PWA (:3000): app/{patient,caregiver,map,hermes}/
hermes-agent/  Config ONLY for a separately-provisioned Hermes agent (NOT started by make)
scripts/       fetch_toronto_data.py; one-off importers/cleaners
```

**Request/LLM topology:** The backend (`:8001`) is NOT the LLM. It calls a **vLLM Nemotron** server that permanently holds **`:8000`** (`NIM_BASE_URL`, default `http://localhost:8000/v1`). This is why the backend uses 8001 — do not move it to 8000. The frontend calls relative `/api/*`, which `next.config.ts` `rewrites()` proxies server-side to `127.0.0.1:8001` (so no CORS/mixed-content).

**Data model is people-centric** — three Chroma collections in `chroma_manager.py` (accessed via the `vdb` singleton):
- `people` — one record per family member (id = person_id); photo is optional
- `face_embeddings` — InsightFace vectors, **id == person_id** (only for people with a photo)
- `life_story_memories` — facts; person facts carry `{person_id, scope:"person"}`, general patient facts have no person_id

The companion (`/ask`) grounds every reply in: today's date/time + family roster + the calendar/schedule (`reminders.calendar_summary`) + RAG over memories + (optionally) nearest Toronto places. It only answers from stored facts — anti-hallucination is enforced by the system prompt in `companion.py`.

## Non-obvious gotchas (these cost real debugging time)

- **LLM model id must match exactly** or the request 404s → canned fallback ("I hear you, my friend…"). `get_companion_model()` auto-detects via `GET /v1/models`; `NIM_MODEL` env overrides. Never hardcode a model name.
- **Nemotron is a reasoning model**: requests send `chat_template_kwargs: {"enable_thinking": false}`, else it spends the budget on a hidden reasoning field and leaves `content` empty. Read `message.content` defensively.
- **Serve production, not dev, when deployed.** Next 16 dev chunks aren't content-hashed → the PWA service worker serves stale JS → hydration mismatch. `make start` runs `next start`; after code changes you must `make build` then restart (no hot reload in prod).
- **The service worker must NOT cache `/api/*`** (it was cache-first on GETs → mutations succeeded but re-fetched cached data, so add/delete "didn't work" on the phone). `sw.js` bypasses `/api/`; data GETs use `cache:"no-store"`.
- **Voice is multilingual:** Whisper `base` (not `base.en`) auto-detects language; companion replies in the same language (system-prompt rule 7); Piper picks a voice per language via `langdetect`. Endpoints (`/transcribe`, `/synthesize`) are unchanged, so the FE voice loop is automatically multilingual. Add a language = add a Piper voice to `PIPER_VOICES`.
- **VAPID web push:** keys live in `src/backend/keys/` and are **gitignored** — a `git clean` can delete `vapid_private.pem`, after which pushes fail with "Could not deserialize key data" (restore from the `~/anchor-data-backup-*.tar.gz`). The VAPID `sub` must be a real `mailto:` (Apple/FCM reject `.local`).
- **Next.js 16 is not the version in your training data** — `src/frontend/AGENTS.md` instructs reading `node_modules/next/dist/docs/` before writing frontend code; APIs/conventions have breaking changes.
- First model load is slow (Whisper ~5s; InsightFace/HF models download to `~/.insightface`, `~/.cache/huggingface`).

## ⚠️ Repo exposure (unresolved)

The GitHub repo `codename-dangerous-hackathon/project` is **PUBLIC**. Real patient data (`database/data/chroma.sqlite3`) and the VAPID private key were committed earlier and are **still recoverable from git history** even though they're now gitignored — the untracking commit did NOT purge history. The VAPID key is compromised. Remediation (if asked): make repo private, `git filter-repo` to purge + force-push (destructive, shared repo), rotate the VAPID keypair.

## Hermes agent

`hermes-agent/` holds only supporting config (`SOUL.md` persona, `memory-proxy/` read-only RAG-grounding proxy, `webchat/`) for a separately-provisioned NemoClaw agent. It is **not** started by `make`. The core app talks to the Nemotron vLLM endpoint directly; Hermes is an optional extra channel.
