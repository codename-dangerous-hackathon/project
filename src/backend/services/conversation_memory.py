"""
Conversation memory (auto-captured).

After a patient turn, distill ONE durable fact the patient shared and persist it
as an EPISODIC memory, so future sessions can gently recall it. Runs in a
background thread (non-blocking) and is heavily guarded — it must never affect a
turn. Recall is automatic: these flow through retrieval.retrieve like any memory.

Only the patient's words are captured (never the companion's reply), and a
similarity dedup guards against the constant repetition typical of dementia.
"""
from datetime import datetime

import requests

from database import writes
from database.chroma_manager import vdb

DEDUP_THRESHOLD = 0.85  # cosine sim above which a fact counts as "already known"

_EXTRACT_PROMPT = (
    "You distill durable memories from what a person with memory loss says, so a "
    "companion can gently recall them later.\n"
    "From the user's message, output ONE short third-person fact worth remembering "
    "long-term — something that happened, a feeling, a person, a place, or a "
    "preference. Under 15 words, no preamble.\n"
    "CRITICAL: use ONLY information explicitly stated in the message. Never invent, "
    "infer, or embellish any detail. Stay faithful to exactly what was said.\n"
    "If the message is only a greeting, a question, or small talk with nothing to "
    "remember, output exactly: NONE"
)


def _extract_fact(user_input: str) -> str | None:
    """One local-LLM call → a short durable fact, or None for nothing-to-remember."""
    from agents.companion import get_companion_model, NIM_BASE_URL  # lazy: avoid import cycle

    try:
        resp = requests.post(
            f"{NIM_BASE_URL}/chat/completions",
            json={
                "model": get_companion_model(),
                "messages": [
                    {"role": "system", "content": _EXTRACT_PROMPT},
                    {"role": "user", "content": user_input},
                ],
                "max_tokens": 40,
                "temperature": 0.0,
                "chat_template_kwargs": {"enable_thinking": False},
            },
            timeout=30,
        )
        resp.raise_for_status()
        text = (resp.json()["choices"][0]["message"].get("content") or "").strip()
    except Exception as e:
        print(f"[conversation_memory] extract failed: {e}")
        return None
    if not text or text.rstrip(".!").upper() == "NONE":
        return None
    return text


def _is_duplicate(fact: str) -> bool:
    """True if a near-identical memory already exists (repetition guard)."""
    try:
        res = vdb.query_memories(query_text=fact, n_results=1)
        dists = (res.get("distances") or [[]])[0]
        if dists:
            return (1.0 - dists[0]) >= DEDUP_THRESHOLD
    except Exception as e:
        print(f"[conversation_memory] dedup check failed: {e}")
    return False


def capture(user_input: str) -> None:
    """Distill + store an episodic memory from the patient's message (best-effort)."""
    try:
        fact = _extract_fact(user_input)
        if not fact or _is_duplicate(fact):
            return
        today = datetime.now().date().isoformat()
        writes.record_memory(fact, scope="general", date=today, tags="conversation",
                             actor="patient", source="conversation")
        print(f"[conversation_memory] remembered: {fact}")
    except Exception as e:
        print(f"[conversation_memory] capture failed: {e}")
