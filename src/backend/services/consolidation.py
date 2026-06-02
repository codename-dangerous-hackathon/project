"""
Memory consolidation (Phase 2 Step 7).

Once a day, find near-duplicate SEMANTIC memories (high cosine similarity within
the same person scope), keep the best one, and soft-delete the rest via the
`superseded_by` column — which retrieval and the SQLite readers already filter
out, so duplicates silently vanish from /journal, /memories, and the companion's
retrieval. Episodic memories are never merged (distinct events). Non-destructive
and reversible: provenance and the Chroma vectors are preserved. Runs on the
existing 20s reminder scheduler thread (see services/reminders._run).
"""
from datetime import datetime

import numpy as np

from database import store
from database.chroma_manager import vdb

DUP_THRESHOLD = 0.95  # identical text ~1.0, distinct facts ~0.2 — see eval

_last_run_date = None


def _cosine(a, b) -> float:
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def consolidate(threshold: float = DUP_THRESHOLD) -> dict:
    """Supersede near-duplicate semantic memories. Returns {clusters, superseded}."""
    rows = store.list_active_semantic()
    if len(rows) < 2:
        return {"clusters": 0, "superseded": 0}
    by_id = {r["id"]: r for r in rows}

    got = vdb.memory_collection.get(ids=list(by_id), include=["embeddings"])
    raw = got.get("embeddings")
    emb = {}
    if raw is not None:
        for i, mid in enumerate(got.get("ids", [])):
            if i < len(raw):
                emb[mid] = raw[i]

    # Group by person scope (None = general) — never merge across people.
    groups: dict = {}
    for r in rows:
        if r["id"] in emb:
            groups.setdefault(r["person_id"], []).append(r["id"])

    clusters = superseded = 0
    for ids in groups.values():
        remaining = list(ids)
        while remaining:
            seed = remaining.pop(0)
            cluster, rest = [seed], []
            for other in remaining:
                (cluster if _cosine(emb[seed], emb[other]) >= threshold else rest).append(other)
            remaining = rest
            if len(cluster) < 2:
                continue
            clusters += 1
            survivor = max(cluster, key=lambda m: (by_id[m]["use_count"], by_id[m]["created_at"] or ""))
            for mid in cluster:
                if mid != survivor:
                    store.mark_superseded(mid, survivor)
                    superseded += 1
    return {"clusters": clusters, "superseded": superseded}


def maybe_run(now: datetime | None = None) -> dict | None:
    """Run consolidate at most once per calendar day (called from the scheduler)."""
    global _last_run_date
    now = now or datetime.now()
    today = now.date().isoformat()
    if _last_run_date == today:
        return None
    _last_run_date = today
    return consolidate()
