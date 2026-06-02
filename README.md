# 🪻 Belong — A Local AI Caregiving Companion

**Belong** is a private, on-device AI companion for people living with dementia — and the caregivers who support them. It runs **100% locally on the NVIDIA Spark (GB10)**: no cloud, no data leaving the home. Voice, memory, faces, schedules, moods, photos, and city services all stay on the device.

> Built for **The Spark Hack Series, presented by NVIDIA (Toronto)** — powered by **NVIDIA Nemotron** and **City of Toronto Open Data**.

⭐ Winner of the Nvidia Hackathon Toronto May 2026 Public Services track ⭐

---

## 💡 Why Belong

Dementia steals the small certainties — *who is this person? what am I supposed to do today? where am I?* Belong answers those questions gently, over and over, without judgment, and **only from facts a caregiver (or the patient) has actually shared** — it never invents a name, a relationship, or an appointment. Because everything runs on the Spark in the home, the most intimate data a family has — faces, memories, routines, moods — never touches the internet.

---

## 🧠 The System — Everything Runs on the Spark

```
                       ┌────────────────────────────────────────────────┐
                       │         NVIDIA Spark (GB10) — 100% local         │
                       │                                                  │
 Patient  ─voice/text─ │   Next.js PWA  ──/api──►  FastAPI backend (:8001)│
 Caregiver ──────────  │   (Patient · Caregiver · Map · Chat)             │
                       │        │                       │                 │
                       │        ▼                       ▼                 │
                       │   Whisper STT            Companion agent          │
                       │   Piper  TTS             → grounding context      │
                       │   InsightFace            → Nemotron (vLLM :8000)  │
                       │   (faces)                → turn trace             │
                       │        │                       │                 │
                       │        ▼                       ▼                 │
                       │   Memory system: SQLite (source of truth) +      │
                       │   ChromaDB (semantic index) + JSON · on-device   │
                       │   photos · hybrid retrieval · provenance         │
                       └────────────────────────────────────────────────┘
                                   ▲
                         Toronto Open Data  +  OpenStreetMap tiles
                         (city-services map · nearby places · events)
```

Everything — the language model, the speech models, the face model, the database, and the memory/retrieval pipeline — runs **on the Spark**. The only outbound calls are optional public-data lookups (Toronto Open Data, map tiles, community events). See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full design.

---

## ✨ Features

### 👵 Patient app (`/patient`) — a calm, voice-first companion
- **Press-to-talk voice loop**: speak → local **Whisper** transcription → companion → **Piper** warm voice reply. Multilingual (auto-detects the spoken language and replies in kind).
- **"Who is this?"** — point the camera at a person; on-device **InsightFace** matches them against enrolled family and the companion says who they are (plus a remembered fact).
- **🌅 Daily Briefing** — a warm "good morning" with today's date and schedule, read aloud.
- **🙂 Mood check-in** — tap how you feel; logged for the caregiver to see.
- **📷 Photo Journal** — browse captioned photo memories, tap any to hear the story.
- **📖 Memories / 👤 About Me** — life-story facts and family, grouped and tap-to-hear.
- **Memory-grounded, errorless answers** — the companion speaks only stored facts, gently admits uncertainty, and **never quizzes or corrects**.

### 🧑‍⚕️ Caregiver app (`/caregiver`)
- Enroll **family members** (name, relationship, optional photo) and record **memories**.
- Manage **reminders & appointments** (medications, visits) with **Web Push** notifications and a month-grid calendar.
- **💚 Wellbeing** — review the patient's mood check-in history.
- **Photo Memories** — add a photo + caption that appears in the patient's Photo Journal.
- Review the **journal** — everything Belong knows, grouped by person, each fact showing **who added it and when**.

### 🗺️ City services map (`/map`)
- **Leaflet + OpenStreetMap** map of Toronto plotting **City of Toronto Open Data** (washrooms, long-term-care homes, community centres), with a "nearest to me" finder.

### 🤖 Hermes chat (`/hermes`)
- A text chat surface backed by the **Hermes** agent (Nemotron), grounded with the same memories, schedule, and family roster.

### 🧠 Under the hood — a real memory system
- **SQLite is the source of truth** for structured facts (people, relationships, events, profile, memories, provenance); **ChromaDB** is the semantic index; legacy JSON is dual-written for safety.
- **Hybrid retrieval + rerank** — vector similarity + keyword overlap + temporal decay (semantic vs episodic) + use-frequency, tuned against a recall benchmark.
- **Conversation memory** — the companion **remembers across sessions**: it distills durable facts the patient shares into episodic memories and recalls them later.
- **Nightly consolidation** of near-duplicate memories; **provenance** on every fact; **observability** (`/health`, `/traces`) for every companion turn — all on-device.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **LLM** | NVIDIA **Nemotron Nano 30B** (`NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4`) served locally via **vLLM** |
| **Speech** | **faster-whisper** (STT) · **Piper** (TTS) · **langdetect** — fully on-device |
| **Vision** | **InsightFace** (`buffalo_l`: RetinaFace + ArcFace) via **onnxruntime** |
| **Memory** | **SQLite** (source of truth, `PRAGMA user_version` migrations) + **ChromaDB** (`all-MiniLM-L6-v2`) semantic index + hybrid retrieval/rerank |
| **Backend** | **FastAPI** + Uvicorn (localhost-only, port `8001`) |
| **Frontend** | **Next.js 16** PWA (port `3000`) + **Leaflet** + Web Push |
| **Open Data** | **City of Toronto Open Data** + custom local service API |
| **Hardware** | **NVIDIA Spark (GB10)** — Grace-Blackwell, unified memory, ARM64/CUDA |

---

## 🔒 Privacy

- The backend binds to **`127.0.0.1` only**.
- Faces are stored **as embeddings, never as images leaving the device**; photos are local on-device thumbnails.
- Memories, schedules, profiles, moods, and per-turn traces live in **local stores on the Spark**.
- The language, speech, and vision models all run **locally** — no third-party AI APIs. Belong can demo with **wifi physically off** (web-push reminders and the map are the only internet-using extras).

---

## 📂 Project Structure

```
src/
├── backend/                  FastAPI app (localhost:8001)
│   ├── main.py               bootstrap; model warmup; reconcile; reminder scheduler
│   ├── api/routes.py         all HTTP endpoints
│   ├── agents/companion.py   the grounded companion (context → Nemotron → trace)
│   ├── database/
│   │   ├── sqlite_manager.py + migrations.py   SQLite + user_version migrations
│   │   ├── store.py          typed SQLite data-access (source of truth)
│   │   ├── writes.py         dual-write coordinator (SQLite + Chroma)
│   │   ├── retrieval.py      hybrid retrieval + rerank
│   │   └── chroma_manager.py ChromaDB: memories · people · face embeddings
│   ├── services/
│   │   ├── reminders.py · profile.py · places.py · eventbrite.py · photos.py
│   │   ├── conversation_memory.py   remember durable facts across sessions
│   │   ├── consolidation.py         nightly near-duplicate merge
│   │   └── observability.py         per-turn traces + summary
│   ├── tools/  audio.py (Whisper/Piper) · vision.py (InsightFace)
│   └── tests/  77 hermetic backend tests (LLM + models mocked, state in tmp)
└── frontend/                 Next.js 16 PWA (localhost:3000)
    └── app/  / · /patient · /caregiver · /map · /hermes

docs/        ARCHITECTURE.md · ROADMAP.md · PHASE2_MEMORY_PLAN.md · CLAUDE_CODE_GUIDE.md
hermes-agent/  config/helpers for the separately-provisioned Hermes agent
```

---

## 🚀 Getting Started

**Prerequisites:** NVIDIA Spark (or a CUDA box), Python 3.12, Node.js 20+, and a local **Nemotron** endpoint served via vLLM (OpenAI-compatible) on `:8000`.

```bash
make install   # backend venv (requirements.txt) + frontend npm deps
make build     # Next.js production bundle (serve prod — see CLAUDE.md)
make start     # backend :8001 + frontend :3000 in the background
```

Open **http://localhost:3000**. Useful: `make logs`, `make stop`. Key backend env vars: `NIM_BASE_URL` (default `http://localhost:8000/v1`), `NIM_MODEL` (optional override; otherwise auto-detected).

---

## 🌐 Key API Endpoints (backend `:8001`)

| Area | Endpoints |
|---|---|
| **Voice** | `POST /transcribe` (STT) · `POST /synthesize` (TTS) |
| **Companion** | `POST /ask` · `GET /briefing` |
| **People & faces** | `POST/GET/DELETE /people` · `POST /identify` · `POST /people/{id}/photo` |
| **Memories** | `POST /enroll_memory` · `POST /memories/photo` · `GET /memories` · `GET /journal` · `GET /photo-journal` |
| **Schedule** | `GET/POST/DELETE /events` · `POST /push/subscribe` |
| **Wellbeing** | `POST/GET/DELETE /mood` |
| **City services** | `GET /places/nearest` · `GET /discover/events` · `/map/data/{dataset}` |
| **Profile** | `GET/POST /profile` |
| **Ops** | `GET /health` · `GET /traces` |

---

## 🏆 NVIDIA Ecosystem

Belong runs on **NVIDIA Nemotron** locally via vLLM on the **Spark (GB10)** — no external LLM APIs. Nemotron powers companion conversation, retrieval-augmented memory grounding, care-summary generation, and the conversation-memory distillation, combined with City of Toronto Open Data for the public-services map.

---

*Belong — keeping people connected to the ones, the places, and the moments that matter. Privately, at home, on the Spark.* 🪻
