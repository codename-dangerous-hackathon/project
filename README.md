# 🪻 Belong — A Local AI Caregiving Companion

**Belong** is a private, on-device AI companion for people living with dementia — and the caregivers who support them. It runs **100% locally on the NVIDIA Spark (GB10)**: no cloud, no data leaving the home. Voice, memory, faces, schedules, and city services all stay on the device.

> Built for **The Spark Hack Series, presented by NVIDIA (Toronto)** — Public Services track, powered by **NVIDIA Nemotron** and **City of Toronto Open Data**.

---

## 💡 Why Belong

Dementia steals the small certainties — *who is this person? what am I supposed to do today? where am I?* Belong answers those questions gently, over and over, without judgment, and **only from facts a caregiver has actually entered** — it never invents a name, a relationship, or an appointment. Because everything runs on the Spark in the home, the most intimate data a family has — faces, memories, routines — never touches the internet.

---

## 🧠 The System — Everything Runs on the Spark

```
                          ┌──────────────────────────────────────────┐
                          │      NVIDIA Spark (GB10) — 100% local      │
                          │                                            │
  Patient  ──voice/text── │   Next.js PWA  ──►  FastAPI backend        │
  Caregiver ──────────── │   (Patient · Caregiver · Map · Chat)       │
                          │        │                  │               │
                          │        ▼                  ▼               │
                          │   Whisper STT        Hermes / Nemotron     │
                          │   Piper  TTS         Nano 30B  (vLLM)      │
                          │   InsightFace        + Memory / RAG        │
                          │   (faces)            + Care summaries       │
                          │        │                  │               │
                          │        ▼                  ▼               │
                          │   Local Data:  ChromaDB vectors · JSON     │
                          │   stores (events/profile) · Photos         │
                          └──────────────────────────────────────────┘
                                   ▲
                         Toronto Open Data  +  Custom local API
                         (city services map · nearby places · events)
```

Everything — the language model, the speech models, the face model, and the database — is served **on the Spark**. The only outbound calls are optional public-data lookups (Toronto Open Data, nearby places, community events).

---

## ✨ Features

### 👵 Patient app (`/patient`) — voice & text companion
- **Press-to-talk voice loop**: speak → local **Whisper** transcription → Nemotron companion → **Piper** warm voice reply.
- **"Who is this?"** — point the camera at a person; on-device **InsightFace** matches them against enrolled family members and the companion says who they are.
- **Memory-grounded answers** — the companion only speaks facts that are actually stored (errorless, reassuring, never guessing).

### 🧑‍⚕️ Caregiver app (`/caregiver`) — manage the patient's world
- Enroll **family members** (name, relationship, optional photo) and record **memories** about each.
- Manage **reminders & appointments** (medications, visits) with **Web Push** notifications.
- Review the **journal** — everything Belong knows, grouped by person.

### 🗺️ City services map (`/map`)
- **Leaflet + OpenStreetMap** map of Toronto plotting **City of Toronto Open Data** points, with per-dataset toggles, plus nearby-places and community-event discovery.

### 🤖 Hermes chat (`/hermes`)
- A text chat surface backed by the **Hermes** agent (Nemotron Nano 30B), grounded with the same memories, schedule, and family roster.

### 🧠 AI layer — Hermes, powered by Nemotron Nano 30B
- **Companion conversation** grounded by **RAG** over the patient's life-story memories and family roster.
- **Care summaries / morning briefing** generated from the schedule.
- **Anti-hallucination by design** — strict instructions to use only stored facts and to gently admit uncertainty otherwise.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **LLM** | NVIDIA **Nemotron Nano 30B** (`NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4`) served locally via **vLLM** |
| **Agent** | **Hermes** (NemoClaw) — OpenAI-compatible local agent with memory grounding |
| **Speech** | **faster-whisper** (STT) · **Piper** (TTS) — fully on-device |
| **Vision** | **InsightFace** (`buffalo_l`: RetinaFace + ArcFace) via **onnxruntime** |
| **Memory / RAG** | **ChromaDB** (SQLite-backed) with `all-MiniLM-L6-v2` embeddings |
| **Backend** | **FastAPI** + Uvicorn (localhost-only, port `8001`) |
| **Frontend** | **Next.js 16** Progressive Web App (port `3000`) + **Leaflet** |
| **Open Data** | **City of Toronto Open Data** + custom local service API |
| **Hardware** | **NVIDIA Spark (GB10)** — Grace-Blackwell, unified memory, ARM64/CUDA |

---

## 🔒 Privacy

- The backend binds to **`127.0.0.1` only**.
- Faces are stored **as embeddings, never as images leaving the device**.
- Memories, schedules, and profiles live in **local stores on the Spark**.
- The language, speech, and vision models all run **locally** — no third-party AI APIs.

---

## 📂 Project Structure

```
src/
├── backend/                 FastAPI app (localhost:8001)
│   ├── main.py              app bootstrap, model warmup, reminder scheduler
│   ├── api/routes.py        all HTTP endpoints
│   ├── agents/companion.py  RAG companion (memories + schedule → Nemotron)
│   ├── database/
│   │   ├── chroma_manager.py  ChromaDB: memories · people · face embeddings
│   │   └── data/              ChromaDB store (local)
│   ├── tools/
│   │   ├── audio.py         Whisper STT + Piper TTS
│   │   └── vision.py        InsightFace enroll / recognize
│   ├── services/            reminders · places · photos · profile · events
│   └── data/                events.json (schedule), profile
└── frontend/                Next.js 16 PWA (localhost:3000)
    └── app/                 / · /patient · /caregiver · /map · /hermes

hermes-agent/                Config/helpers for the separately-provisioned Hermes agent
├── SOUL.md                  Hermes persona (Belong dementia-companion identity)
├── SOUL.default.md          stock persona backup
├── memory-proxy/            memory-injecting proxy (RAG grounding for the Hermes web channel)
└── webchat/                 standalone OpenAI-compatible chat front end
```

---

## 🤖 Hermes Agent (provisioned separately)

The **Hermes** agent is **not** started by `make start`. It runs as its own service — a **NemoClaw** security-sandboxed agent wired to the locally-served Nemotron model — and is set up independently of the Belong app. The Belong repo only includes its **supporting config and helpers** under `hermes-agent/`:

- **`SOUL.md`** — the Hermes persona, customized into Belong's warm, errorless-learning dementia companion (`SOUL.default.md` keeps the stock persona).
- **`memory-proxy/`** — a small proxy that sits in front of Hermes' OpenAI-compatible API and injects the patient's memories, family roster, and schedule into each request **read-only**, so the Hermes web channel is grounded in exactly the same facts as the in-app companion (without ever writing to the app's database).
- **`webchat/`** — a self-contained chat front end for the Hermes endpoint.

The core Belong app (patient + caregiver) talks to the Nemotron vLLM endpoint directly (`NIM_BASE_URL`); the Hermes agent is an additional, optional channel.

---

## 🚀 Getting Started

**Prerequisites:** NVIDIA Spark (or a CUDA box), Python 3.12, Node.js 20+, and a local **Nemotron** endpoint served via vLLM (OpenAI-compatible) on `:8000`.

```bash
# 1. Install backend (venv) + frontend (npm) dependencies
make install

# 2. Build the Next.js production bundle
make build

# 3. Start backend (:8001) and frontend (:3000)
make start
```

Then open **http://localhost:3000**. Useful targets: `make logs`, `make stop`.

**Key env vars** (backend):
- `NIM_BASE_URL` — local LLM endpoint (default `http://localhost:8000/v1`)
- `NIM_MODEL` — optional model id override (otherwise auto-detected)

---

## 🌐 Key API Endpoints (backend `:8001`)

| Area | Endpoints |
|---|---|
| **Voice** | `POST /transcribe` (STT) · `POST /synthesize` (TTS) |
| **Companion** | `POST /ask` · `GET /briefing` (morning care summary) |
| **People & faces** | `POST /people` · `POST /enroll` · `POST /identify` · `GET /faces` |
| **Memories** | `POST /people/{id}/memories` · `GET /memories` · `GET /journal` |
| **Schedule** | `GET/POST /events` · `POST /push/subscribe` · `POST /push/test` |
| **City services** | `GET /places/nearest` · `GET /discover/events` · `/map/data/{dataset}` |
| **Profile** | `GET/POST /profile` |

---

## 🏆 NVIDIA Ecosystem

Belong is built on **NVIDIA Nemotron** running locally via vLLM on the **Spark (GB10)** — no external LLM APIs. The Nemotron model powers companion conversation, retrieval-augmented memory grounding, and care-summary generation, combined with the City of Toronto Open Data for the public-services map.

---

*Belong — keeping people connected to the ones, the places, and the moments that matter. Privately, at home, on the Spark.* 🪻
