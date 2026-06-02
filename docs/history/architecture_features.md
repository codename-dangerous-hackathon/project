# Anchor: Advanced AI Features & Architecture

> ⚠️ **Historical design note — original hackathon spec, kept for context.** This captures the *original* plan under the working name **"Anchor."** Some choices changed during the build: the app shipped as **Belong** on **Nemotron Nano 30B** (not Nemotron-Mini-4B) with **Piper** TTS (not FastPitch). For the current system of record, see the root [`README.md`](../../README.md) and [`CLAUDE.md`](../../CLAUDE.md); for forward plans see [`docs/ROADMAP.md`](../ROADMAP.md).

This document describes the core AI-driven features for Anchor, a locally hosted (offline) helper agent for people with dementia. It focuses heavily on privacy, on-device AI models, and therapeutic interactions.

## 1. The "Infinite Patience" Conversational Loop
**The Problem:** People with dementia will often ask the same question dozens of times a day (e.g., "Where is my husband?", "When are we going home?"). Caregivers burn out trying to answer nicely the 40th time.
**The AI Solution (Whisper STT + Nemotron-Mini-4B + FastPitch TTS):**
*   **Feature:** A persistent, voice-first companion loop.
*   **How it works:** The system is prompt-engineered with an "Errorless / Validation" constraint. It must *never* say "I just told you," "You already asked," or "No, you are wrong."
*   **UX Implementation:** A single, massive glowing button on the tablet that listens when pressed. It gently answers the question exactly as warmly the 50th time as it did the 1st, and gracefully pivots the conversation.

## 2. Ambient or Active "Context Dispenser" (Face & Person Recognition)
**The Problem:** Forgetting the faces or names of spouses, children, or grandchildren causes immense fear.
**The AI Solution (InsightFace Embeddings + Vector DB):**
*   **Feature:** "Who is this?" Scanner.
*   **How it works:** The caregiver enrolls family faces. When a visitor walks in, the patient can point the device at them (or it runs ambiently on a stand).
*   **UX Implementation:** The screen shows the camera feed with a gentle box around the face. The voice instantly whispers/says: *"This is Sarah, your daughter. She brought the grandchildren."*

## 3. Automated "Sundowning" & Temporal Orientation
**The Problem:** "Sundowning" translates to severe confusion and agitation that sets in during late afternoon/evening.
**The AI Solution (Cron Triggers + RAG + Piper TTS):**
*   **Feature:** The "Anchor" Briefings.
*   **How it works:** Not tied to user input. The app dictates specific times of day to activate automatically.
*   **UX Implementation:** At 4:00 PM, the screen brightens warmly and chimes. *"Good afternoon, Helen. It is currently 4 PM on Tuesday. Outside is getting a bit dark, but you are safe at home in your living room."*

## 4. Interactive Reminiscence Therapy (The Memory Journal)
**The Problem:** Short-term memory fades, but long-term memories remain vivid. Accessing these triggers joy and anchors identity.
**The AI Solution (LLaVA-v1.5-8B Vision-Language + Vector DB):**
*   **Feature:** AI-Narrated Photo Albums.
*   **How it works:** Caregivers upload old photos in the Caregiver UI.
*   **UX Implementation:** The Patient UI has a "Look at Memories" mode. The system uses local LLaVA to silently "understand" the photo, then the Companion weaves it into a conversation.

## 5. Acoustic Agitation Detection & Caregiver Summary
**The Problem:** Caregivers need to know how the day went without intrusive surveillance.
**The AI Solution (Whisper STT Tone Analysis + Nemotron Offline Summarizer):**
*   **Feature:** Privacy-Preserving Mood & Incident Logging.
*   **How it works:** Offline processing listens for raised voices, repetitive anxious phrases, or crying.
*   **UX Implementation:** Generates an encrypted text log (no audio kept) to summarize the day for the caregiver.
