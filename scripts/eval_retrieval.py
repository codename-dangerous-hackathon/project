#!/usr/bin/env python3
"""
Belong — hybrid retrieval recall benchmark (Phase 2 Step 6).

SYNTHETIC benchmark. It seeds an isolated in-memory store with a structured fact
set + labeled query->relevant mappings, then measures recall@1/@3 + MRR for the
hybrid reranker vs a vector-only baseline. It demonstrates the reranker's
*mechanism* advantage (keyword / recency / frequency tie-breaking) — NOT
real-user recall (that would need logged queries).

Hermetic: builds its own EphemeralClient Chroma + a temp SQLite DB; never touches
real patient data. Run from the repo root:

    ./venv/bin/python scripts/eval_retrieval.py
"""
import os
import sys
import json
import tempfile
from datetime import datetime, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src", "backend")))

# --- isolation: MUST run before chroma_manager builds the vdb singleton -------
import chromadb  # noqa: E402

chromadb.PersistentClient = lambda *a, **k: chromadb.EphemeralClient()
import database.sqlite_manager as sqlite_manager  # noqa: E402

sqlite_manager.DB_PATH = os.path.join(tempfile.mkdtemp(prefix="belong-bench-"), "bench.db")

from database import store, retrieval  # noqa: E402
from database.chroma_manager import vdb  # noqa: E402

NOW = datetime(2026, 6, 1, 12, 0, 0)


def _iso(days_ago):
    return (NOW - timedelta(days=days_ago)).isoformat()


def _date(days_ago):
    return (NOW - timedelta(days=days_ago)).date().isoformat()


def seed(mid, text, kind="semantic", person_id=None, tags="",
         event_time=None, created_days_ago=200, use_count=0):
    created = _iso(created_days_ago)
    prov = store.add_provenance("caregiver", "manual_entry", created)
    scope = "person" if person_id else "general"
    store.upsert_memory(mid, text, kind, person_id, scope, tags, event_time, created, prov)
    meta = ({"person_id": person_id, "scope": "person", "tags": tags} if person_id
            else {"date": event_time or "", "tags": tags})
    vdb.add_memory(mid, text, meta)
    if use_count:
        c = sqlite_manager.get_connection()
        c.execute("UPDATE memories SET use_count = ? WHERE id = ?", (use_count, mid))
        c.commit()
        c.close()


# --- the synthetic memory set -------------------------------------------------
# Controlled pairs isolate one signal each; fillers make the candidate pool real.
def build_store():
    # RECENCY: same topic, the recent dated event is the relevant one.
    seed("rec_new", "celebrated a birthday with the family", kind="episodic",
         event_time=_date(6), created_days_ago=6)
    seed("rec_old", "celebrated a birthday party", kind="episodic",
         event_time=_date(700), created_days_ago=700)
    # FREQUENCY: near-identical facts, the often-referenced one is relevant.
    seed("freq_hot", "enjoys long walks by the river", use_count=12, created_days_ago=120)
    seed("freq_cold", "enjoys long strolls near the river", use_count=0, created_days_ago=120)
    # KEYWORD: an exact term the caregiver would query by.
    seed("kw_pen", "is allergic to penicillin", tags="medical", created_days_ago=90)
    seed("kw_cat", "is a little afraid of cats", tags="medical", created_days_ago=90)
    # SEMANTIC durable facts (should stay retrievable regardless of age).
    seed("sem_navy", "served in the navy as a young man", created_days_ago=900)
    seed("sem_teacher", "worked as a primary school teacher for 30 years", created_days_ago=850)
    # Fillers — unrelated life-story facts.
    for i, t in enumerate([
        "loves listening to jazz records",
        "grows tomatoes and basil in the garden",
        "bakes sourdough bread on weekends",
        "used to play the trumpet in a band",
        "prefers tea over coffee in the morning",
        "enjoys doing the crossword puzzle",
        "has a sweet tooth for lemon cake",
        "likes watching old western films",
        "collected stamps as a hobby",
        "goes to the seaside every summer",
    ]):
        seed(f"fill_{i}", t, created_days_ago=300 + i * 10)


QUERIES = [
    {"q": "what birthday did we celebrate recently", "rel": ["rec_new"], "signal": "recency"},
    {"q": "tell me about the river walks", "rel": ["freq_hot"], "signal": "frequency"},
    {"q": "any medication allergies", "rel": ["kw_pen"], "signal": "keyword"},
    {"q": "is there a fear of animals", "rel": ["kw_cat"], "signal": "semantic"},
    {"q": "military service history", "rel": ["sem_navy"], "signal": "semantic"},
    {"q": "what job did they have", "rel": ["sem_teacher"], "signal": "semantic"},
    {"q": "what music do they like", "rel": ["fill_0", "fill_3"], "signal": "semantic"},
    {"q": "what do they grow in the garden", "rel": ["fill_1"], "signal": "keyword"},
    {"q": "favorite hot drink", "rel": ["fill_4"], "signal": "semantic"},
    {"q": "weekend baking", "rel": ["fill_2"], "signal": "keyword"},
]

SIM_ONLY = {"sim": 1.0, "keyword": 0.0, "recency": 0.0, "frequency": 0.0}

# Candidate weight vectors to sweep. The default keyword=0.5 adds spurious boosts
# on queries whose true answer shares no keywords, so we probe lower-keyword mixes.
SWEEP = {
    "default(.5/.3/.2)": {"sim": 1.0, "keyword": 0.5, "recency": 0.3, "frequency": 0.2},
    "tiebreak(.12/.10/.06)": {"sim": 1.0, "keyword": 0.12, "recency": 0.10, "frequency": 0.06},
    "tiny(.1/.06/.04)": {"sim": 1.0, "keyword": 0.10, "recency": 0.06, "frequency": 0.04},
    "mid(.2/.15/.1)": {"sim": 1.0, "keyword": 0.2, "recency": 0.15, "frequency": 0.1},
}


def evaluate(label, weights):
    r1 = r3 = mrr = 0.0
    per = []
    for item in QUERIES:
        hits = retrieval.retrieve(item["q"], k=3, now=NOW, weights=weights, bump=False)
        ids = [h["id"] for h in hits]
        rel = set(item["rel"])
        hit1 = 1.0 if ids[:1] and ids[0] in rel else 0.0
        hit3 = len(rel & set(ids[:3])) / len(rel)
        rr = next((1.0 / (i + 1) for i, m in enumerate(ids) if m in rel), 0.0)
        r1 += hit1
        r3 += hit3
        mrr += rr
        per.append({"q": item["q"], "signal": item["signal"], "expected": list(rel),
                    "got": ids, "r@1": hit1, "rr": round(rr, 3)})
    n = len(QUERIES)
    return {"label": label, "recall@1": round(r1 / n, 3), "recall@3": round(r3 / n, 3),
            "mrr": round(mrr / n, 3), "per": per}


def main():
    build_store()
    baseline = evaluate("vector-only (baseline)", SIM_ONLY)
    hybrid = evaluate("hybrid reranker", retrieval.WEIGHTS)

    print(f"Belong retrieval benchmark — {len(QUERIES)} labeled queries over a synthetic seed\n" + "=" * 70)
    print(f"{'metric':10s} {'baseline':>12s} {'hybrid':>12s} {'delta':>10s}")
    for m in ("recall@1", "recall@3", "mrr"):
        d = hybrid[m] - baseline[m]
        print(f"{m:10s} {baseline[m]:>12.3f} {hybrid[m]:>12.3f} {d:>+10.3f}")
    print("=" * 70)
    print("Per-query (signal · expected · baseline-r@1 → hybrid-r@1):")
    bmap = {p["q"]: p for p in baseline["per"]}
    for hp in hybrid["per"]:
        bp = bmap[hp["q"]]
        flag = " <= WIN" if hp["r@1"] > bp["r@1"] else (" <= regress" if hp["r@1"] < bp["r@1"] else "")
        print(f"  [{hp['signal']:9s}] {hp['q'][:42]:42s}  {bp['r@1']:.0f} -> {hp['r@1']:.0f}{flag}")

    # Weight sweep — find the mix that keeps the mechanism wins without keyword noise.
    print("=" * 70)
    print("Weight sweep (recall@1 / recall@3 / mrr):")
    sweep = {name: evaluate(name, w) for name, w in SWEEP.items()}
    best = max(sweep.values(), key=lambda r: (r["recall@1"], r["mrr"]))
    for name, r in sweep.items():
        star = "  *BEST" if r["label"] == best["label"] else ""
        print(f"  {name:22s} {r['recall@1']:.3f} / {r['recall@3']:.3f} / {r['mrr']:.3f}{star}")
    print(f"\nBaseline recall@1 {baseline['recall@1']:.3f} → best sweep {best['recall@1']:.3f} "
          f"({best['label']}), delta {best['recall@1'] - baseline['recall@1']:+.3f}")

    os.makedirs("test-results", exist_ok=True)
    idx = len([f for f in os.listdir("test-results") if f.startswith("eval-retrieval-")])
    out = os.path.join("test-results", f"eval-retrieval-{idx}.json")
    with open(out, "w") as f:
        json.dump({"baseline": baseline, "hybrid": hybrid, "sweep": sweep}, f, indent=2, ensure_ascii=False)
    print(f"\nRaw results -> {out}")


if __name__ == "__main__":
    main()
