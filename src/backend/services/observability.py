"""
On-device observability for the companion (Phase 5).

Per-turn traces (what was retrieved, latency, tokens, fallback) go to an
in-memory ring buffer + a local JSONL on the box. The FULL detail (including the
user's words and the reply) stays only in the gitignored data/traces.jsonl — it
never leaves the device. The HTTP view (`recent_metrics`) strips conversation
text, because the backend is reachable via the public funnel.
"""
import json
import os
from collections import deque

_BASE = os.path.dirname(os.path.dirname(__file__))  # src/backend
_DATA = os.path.join(_BASE, "data")
TRACE_FILE = os.path.join(_DATA, "traces.jsonl")

_RING = deque(maxlen=200)

# Fields safe to expose over the (effectively public) API — no conversation text.
_METRIC_FIELDS = ("ts", "latency_ms", "model", "fallback", "context", "tokens")


def record(trace: dict) -> None:
    """Append a turn trace to the ring + local JSONL. Never raises."""
    try:
        _RING.append(trace)
        os.makedirs(_DATA, exist_ok=True)
        with open(TRACE_FILE, "a") as f:
            f.write(json.dumps(trace, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[observability] record failed (ignored): {e}")


def recent_metrics(n: int = 20) -> list[dict]:
    """Last n traces (newest first), conversation text stripped — safe for HTTP."""
    out = []
    for t in list(_RING)[-n:][::-1]:
        row = {k: t.get(k) for k in _METRIC_FIELDS}
        row["retrieved"] = [{"id": h.get("id"), "score": h.get("score")}
                            for h in (t.get("retrieved") or [])]
        out.append(row)
    return out


def summary() -> dict:
    items = list(_RING)
    n = len(items)
    if not n:
        return {"turns": 0, "fallback_rate": 0.0, "avg_latency_ms": 0, "p95_latency_ms": 0}
    lat = sorted(t.get("latency_ms", 0) for t in items)
    fb = sum(1 for t in items if t.get("fallback"))
    return {
        "turns": n,
        "fallback_rate": round(fb / n, 3),
        "avg_latency_ms": round(sum(lat) / n),
        "p95_latency_ms": lat[min(n - 1, int(0.95 * n))],
    }


def reset() -> None:
    """Clear the in-memory ring (used by tests)."""
    _RING.clear()
