"""
Hybrid memory retrieval (Phase 2 Step 5).

Replaces the companion's naive 2-nearest-neighbour Chroma lookup with:
  vector candidates -> join SQLite rows -> filter (superseded / wrong person)
  -> rerank by (similarity + keyword overlap + temporal decay-by-kind + use
  frequency) -> top-k -> bump usage (feedback for future ranks).

The scoring is a pure function (`_score`) so it is unit-testable without Chroma
or the LLM. `retrieve` degrades gracefully — any failure returns [] so the
companion still has the structured roster/schedule.
"""
import math
import re
from datetime import datetime

from database import store
from database.chroma_manager import vdb

OVERFETCH = 20                 # vector candidates pulled before reranking
HALF_LIFE_SEMANTIC = 3650.0    # days — durable facts barely decay (~10y)
HALF_LIFE_EPISODIC = 30.0      # days — dated events fade fast
USE_COUNT_CAP = 20.0
WEIGHTS = {"sim": 1.0, "keyword": 0.5, "recency": 0.3, "frequency": 0.2}

_STOP = {"the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "my", "your",
         "you", "me", "to", "of", "in", "on", "at", "and", "or", "for", "what", "who",
         "when", "where", "it", "this", "that", "with", "about", "tell", "whats", "how"}


def _tokens(text: str) -> set:
    return {t for t in re.split(r"[^a-z0-9]+", (text or "").lower()) if len(t) > 2 and t not in _STOP}


def _keyword_overlap(query: str, text: str, tags: str = "") -> float:
    q = _tokens(query)
    if not q:
        return 0.0
    return len(q & _tokens(f"{text} {tags}")) / len(q)


def _days_since(iso: str | None, now: datetime):
    if not iso:
        return None
    try:
        return max(0.0, (now - datetime.fromisoformat(iso)).total_seconds() / 86400.0)
    except (ValueError, TypeError):
        return None


def _recency_decay(kind: str, created_at: str | None, event_time: str | None, now: datetime) -> float:
    if kind == "episodic":
        days, hl = _days_since(event_time or created_at, now), HALF_LIFE_EPISODIC
    else:
        days, hl = _days_since(created_at, now), HALF_LIFE_SEMANTIC
    if days is None:
        return 0.5  # neutral when undated — don't reward or punish
    return math.exp(-days / hl)


def _frequency(use_count) -> float:
    return min(1.0, math.log1p(max(0, use_count or 0)) / math.log1p(USE_COUNT_CAP))


def _score(cand: dict, query: str, now: datetime, weights: dict = WEIGHTS) -> float:
    """Pure rerank score for a candidate {sim, text, tags, kind, created_at, event_time, use_count}."""
    sim = cand.get("sim", 0.0)
    kw = _keyword_overlap(query, cand.get("text", ""), cand.get("tags", "") or "")
    rec = _recency_decay(cand.get("kind", "semantic"), cand.get("created_at"), cand.get("event_time"), now)
    freq = _frequency(cand.get("use_count", 0))
    return (weights["sim"] * sim + weights["keyword"] * kw
            + weights["recency"] * rec + weights["frequency"] * freq)


def _vector_candidates(query: str) -> list[dict]:
    res = vdb.query_memories(query_text=query, n_results=OVERFETCH)
    ids = (res.get("ids") or [[]])[0]
    docs = (res.get("documents") or [[]])[0]
    dists = (res.get("distances") or [[]])[0]
    out = []
    for i, mid in enumerate(ids):
        dist = dists[i] if i < len(dists) else 1.0
        out.append({"id": mid, "text": docs[i] if i < len(docs) else "", "sim": max(0.0, 1.0 - dist)})
    return out


def retrieve(query: str, k: int = 3, person_id: str | None = None, now: datetime | None = None) -> list[dict]:
    """Top-k reranked memories for `query`, each {id, text, score}. Returns []
    on any failure (graceful degradation)."""
    now = now or datetime.now()
    try:
        cands = _vector_candidates(query)
        if not cands:
            return []
        rows = store.get_memories_by_ids([c["id"] for c in cands])
        merged = []
        for c in cands:
            row = rows.get(c["id"])
            if not row or row.get("superseded_by"):
                continue  # drop ghosts (not in SQLite) and consolidated-away rows
            if person_id and row.get("person_id") != person_id:
                continue
            merged.append({**row, "sim": c["sim"], "text": row.get("text") or c["text"]})
        if not merged:
            return []
        ranked = sorted(((_score(m, query, now), m) for m in merged), key=lambda x: x[0], reverse=True)
        top = ranked[:k]
        store.bump_memory_usage([m["id"] for _, m in top], now.isoformat())
        return [{"id": m["id"], "text": m["text"], "score": round(s, 4)} for s, m in top]
    except Exception as e:
        print(f"[retrieval] retrieve failed (returning none): {e}")
        return []
