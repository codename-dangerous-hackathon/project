import os
import time
from datetime import datetime
from database.chroma_manager import vdb
from database import store
from database import retrieval
from services import reminders
from services import profile
from services import places
from services import observability

# Pseudo-code / NIM API compatibility setup setup
# Assuming standard OpenAI formatting to hit a local NVIDIA NIM endpoint
import requests

NIM_BASE_URL = os.getenv("NIM_BASE_URL", "http://localhost:8000/v1")

# The served model id must match exactly what the NIM/vLLM endpoint advertises,
# otherwise the request 404s and we fall back to a canned line. Prefer an env
# override, else auto-detect the first model the endpoint is serving.
_MODEL_OVERRIDE = os.getenv("NIM_MODEL")
_cached_model = None


def get_companion_model() -> str:
    global _cached_model
    if _MODEL_OVERRIDE:
        return _MODEL_OVERRIDE
    if _cached_model:
        return _cached_model
    try:
        resp = requests.get(f"{NIM_BASE_URL}/models", timeout=5)
        resp.raise_for_status()
        _cached_model = resp.json()["data"][0]["id"]
    except Exception as e:
        print(f"NIM model auto-detect failed: {e}")
        _cached_model = "nemotron"  # harmless placeholder; call will fall back
    return _cached_model

# The Errorless & Validation Therapy System Prompt
SYSTEM_PROMPT = """You are a warm, reassuring companion for someone who experiences memory loss.
RULES (STRICT):
1. ERRORLESS: Never tell the user they are wrong.
2. NEVER QUIZ: Never say "Do you remember?" or "Don't you remember?".
3. VALIDATION: If the user looks for someone who is not there, validate their feeling warmly.
4. CONTEXTUAL: Use the provided memory facts to ground your response, but do it naturally like a friend chatting.
5. SHORT: Keep your answers very short (1-3 sentences) so they can be spoken clearly by TTS.
6. NEVER INVENT: Only state names, relationships, jobs, places, or facts that appear in the context below. If the information isn't there, do NOT make up a name or detail — gently say you're not certain while staying warm (e.g. "I'm not quite sure about that, but I'm right here with you."). Never guess who someone is.
7. LANGUAGE: Always reply in the SAME language the user spoke or wrote in. If they speak French, reply in French; if Spanish, reply in Spanish; if English, reply in English. Match their language naturally.
"""

def fetch_revelant_memories(user_query: str) -> str:
    """Retrieve the most relevant life-story facts to inject into the LLM context,
    via the hybrid reranker (similarity + keyword + recency + frequency)."""
    from database import retrieval
    hits = retrieval.retrieve(user_query, k=3)
    return " ".join(h["text"] for h in hits)

def build_family_context() -> str:
    """A roster of the enrolled family members and the facts about each one,
    so the companion actually knows who 'my sister/brother/daughter' is."""
    lines = []
    for p in store.list_people():
        facts = " ".join(f["text"] for f in store.list_memories_for_person(p["id"]))
        line = f"- {p['name']} is the patient's {p['relationship']}."
        if facts:
            line += f" {facts}"
        lines.append(line)
    return "\n".join(lines)

def ask_companion(user_input: str, history=None, location=None) -> str:
    """
    Main entry point for the infinite-patience conversational loop.
    Fetches RAG context, includes prior turns for a real discussion, and hits
    the local NIM.

    history: optional list of {"role": "user"|"assistant", "content": str} from
    earlier in this conversation, so the companion can actually follow along.
    location: optional {"lat","lng"} so the companion can answer "where is the
    nearest washroom / care home?" using the Toronto places tool.
    """
    # 1. Build grounding context: today's date, family roster, the schedule, memories.
    now = datetime.now()
    family = build_family_context()
    calendar = reminders.calendar_summary(now)
    hits = retrieval.retrieve(user_input, k=3)  # hybrid rerank (traced below)
    rag_context = " ".join(h["text"] for h in hits)
    parts = [f"RIGHT NOW IT IS {now.strftime('%A, %B %d, %Y, at %I:%M %p')}."]
    prof = profile.get_profile()
    if prof.get("name"):
        who = f"YOU ARE SPEAKING WITH THE PATIENT, whose name is {prof['name']}"
        if prof.get("tagline"):
            who += f". About them: {prof['tagline']}"
        parts.append(who + ".")
    extra = []
    if prof.get("emergency_name"):
        ec = f"In an emergency, their contact is {prof['emergency_name']}"
        if prof.get("emergency_phone"):
            ec += f" at {prof['emergency_phone']}"
        extra.append(ec + ".")
    if prof.get("medical"):
        extra.append(f"Medical notes: {prof['medical']}.")
    if extra:
        parts.append(" ".join(extra))
    if location:
        try:
            nearby = places.nearby_summary(location["lat"], location["lng"])
            if nearby:
                parts.append(
                    "NEARBY PLACES around the patient right now — use these to answer "
                    "'where is the nearest washroom / toilet / care home?':\n" + nearby
                )
        except Exception as e:
            print(f"places lookup failed: {e}")
    if family:
        parts.append("KNOWN FAMILY MEMBERS (the only people you may name):\n" + family)
    if calendar:
        parts.append(
            "THE PATIENT'S SCHEDULE — use this to answer anything about medications, "
            "appointments, events, or what is happening today/this week:\n" + calendar
        )
    if rag_context:
        parts.append("OTHER NOTES ABOUT THE PATIENT: " + rag_context)
    context_injection = "\n\n" + "\n\n".join(parts) + "\n"

    # 2. Build the enhanced prompt
    messages = [{"role": "system", "content": SYSTEM_PROMPT + context_injection}]

    # Prior turns (kept short — only the recent ones matter for a TTS chat)
    if history:
        for turn in history[-8:]:
            role = turn.get("role")
            content = turn.get("content")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_input})

    # 3. Call the Local NIM Model (timed + traced for observability)
    model = get_companion_model()
    t0 = time.perf_counter()
    tokens, fallback = None, False
    try:
        response = requests.post(
            f"{NIM_BASE_URL}/chat/completions",
            json={
                "model": model,
                "messages": messages,
                "max_tokens": 200,
                "temperature": 0.3,
                # Nemotron Nano is a reasoning model; turn thinking OFF so it
                # answers directly (warm, fast) instead of spending the token
                # budget on a hidden chain-of-thought.
                "chat_template_kwargs": {"enable_thinking": False},
            },
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
        tokens = data.get("usage")
        content = (data["choices"][0]["message"].get("content") or "").strip()
        if not content:
            raise ValueError("empty content from model")
        reply = content
    except Exception as e:
        # Fallback mechanism if the model is unreachable during development
        print(f"NIM Error: {e}")
        fallback = True
        reply = "I hear you, my friend. Let's take a look at the garden together."

    # 4. Record an on-device trace (full detail to the local JSONL; the HTTP view
    # strips conversation text). Never let tracing break a turn.
    try:
        observability.record({
            "ts": now.isoformat(),
            "latency_ms": round((time.perf_counter() - t0) * 1000),
            "model": model,
            "fallback": fallback,
            "retrieved": [{"id": h["id"], "score": h.get("score"), "text": h["text"]} for h in hits],
            "context": {
                "family": bool(family),
                "calendar": bool(calendar),
                "profile": bool(prof.get("name")),
                "location": bool(location),
            },
            "tokens": tokens,
            "user_input": user_input,
            "reply": reply,
        })
    except Exception:
        pass
    return reply
