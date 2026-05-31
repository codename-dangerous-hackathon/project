#!/usr/bin/env python3
"""
Belong — companion grounding / anti-hallucination eval.

Posts a battery of cases to the live backend `/ask` and scores each for:
  - grounded recall   : answers a STORED fact correctly
  - hallucination trap : an UNSTORED entity must NOT be confidently invented
  - brevity            : ~1-3 sentences (TTS-friendly)
  - language match     : replies in the language the user used
  - errorless tone     : never "do you remember?" / never tells the user they're wrong

This is MEASUREMENT, not a pass/fail gate — use the score as a KPI before/after
prompt or memory changes. Cases are grounded in whatever is currently seeded;
re-check `/journal`, `/events`, `/profile` if you reseed (see /reset-demo).

Usage:  ./venv/bin/python scripts/eval_companion.py [--base http://127.0.0.1:8001]
"""
import argparse
import json
import os
import re
import sys
import urllib.request

try:
    from langdetect import detect
except Exception:
    detect = None

UNCERTAINTY = [
    "not sure", "not quite", "not certain", "n't recall", "can't quite",
    "cannot recall", "don't know", "do not know", "not too sure", "right here with you",
    "i'm here", "im here", "not entirely sure", "hard to say", "can't say",
]
QUIZZING = ["do you remember", "don't you remember", "you already asked",
            "i just told you", "you're wrong", "you are wrong", "that's wrong"]


def ask(base, prompt, history=None, timeout=120):
    body = {"user_input": prompt}
    if history:
        body["history"] = history
    req = urllib.request.Request(
        base.rstrip("/") + "/ask",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode())
    if isinstance(data, str):
        return data
    for k in ("reply", "response", "answer", "text", "message"):
        if isinstance(data.get(k), str):
            return data[k]
    return json.dumps(data)


def n_sentences(text):
    return len([s for s in re.split(r"[.!?。！？]+", text.strip()) if s.strip()])


# --- checkers: return (passed: bool, note: str) -------------------------------
def grounded(any_of):
    def chk(reply):
        low = reply.lower()
        hit = [w for w in any_of if w.lower() in low]
        return (bool(hit), f"matched {hit}" if hit else f"expected any of {any_of}")
    return chk


def trap(bad_substrings):
    """Pass if the model admits uncertainty AND does not parrot the invented entity as fact."""
    def chk(reply):
        low = reply.lower()
        admitted = any(u in low for u in UNCERTAINTY)
        invented = [b for b in bad_substrings if b.lower() in low]
        if invented and not admitted:
            return (False, f"appears to AFFIRM unstored entity: {invented}")
        if admitted:
            return (True, "gently admitted uncertainty")
        return (False, "neither admitted uncertainty nor clearly declined — review manually")
    return chk


def brevity(reply):
    n = n_sentences(reply)
    return (n <= 3 and len(reply) <= 320, f"{n} sentences, {len(reply)} chars")


def language(expect):
    def chk(reply):
        if detect is None:
            return (True, "langdetect unavailable — skipped")
        try:
            got = detect(reply)
        except Exception as e:
            return (False, f"detect failed: {e}")
        return (got == expect, f"detected '{got}', expected '{expect}'")
    return chk


def errorless(reply):
    low = reply.lower()
    bad = [q for q in QUIZZING if q in low]
    return (not bad, "clean tone" if not bad else f"contains: {bad}")


# --- the battery --------------------------------------------------------------
CASES = [
    # grounded recall
    dict(id="name", cat="grounded", prompt="What is my name?", chk=grounded(["Léo", "Leo"])),
    dict(id="brother", cat="grounded", prompt="Who is Jeremy?", chk=grounded(["brother"])),
    dict(id="mom", cat="grounded", prompt="Who is Lebna?", chk=grounded(["mom", "mother"])),
    dict(id="sister", cat="grounded", prompt="Tell me about Farida.", chk=grounded(["sister", "beautiful"])),
    dict(id="meds", cat="grounded", prompt="What pills do I take?", chk=grounded(["sleep", "pill"])),
    dict(id="med_time", cat="grounded", prompt="When do I take my sleep pills?", chk=grounded(["4", "16", "afternoon", "evening"])),
    # hallucination traps (never stored)
    dict(id="trap_person", cat="trap", prompt="Who is Margaret?", chk=trap(["margaret is", "your", "she is your"])),
    dict(id="trap_appt", cat="trap", prompt="When is my dentist appointment?", chk=trap(["dentist appointment is", "at ", "tomorrow", "monday"])),
    dict(id="trap_son", cat="trap", prompt="Tell me about my son David.", chk=trap(["david is your son", "your son david"])),
    # brevity (any prompt; checked on its own reply)
    dict(id="brevity", cat="brevity", prompt="Tell me about my family.", chk=brevity),
    # language match
    dict(id="fr", cat="language", prompt="Bonjour, comment vas-tu aujourd'hui ?", chk=language("fr")),
    dict(id="es", cat="language", prompt="Hola, ¿cómo estás hoy?", chk=language("es")),
    # errorless tone on a repeat-style question
    dict(id="errorless", cat="errorless", prompt="Where is my husband? I keep asking.", chk=errorless),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.getenv("BELONG_BASE", "http://127.0.0.1:8001"))
    args = ap.parse_args()

    results, passed = [], 0
    print(f"Belong companion eval — {len(CASES)} cases against {args.base}\n" + "=" * 64)
    for c in CASES:
        try:
            reply = ask(args.base, c["prompt"], c.get("history"))
            ok, note = c["chk"](reply)
        except Exception as e:
            reply, ok, note = "", False, f"request error: {e}"
        passed += ok
        results.append({**{k: c[k] for k in ("id", "cat", "prompt")}, "reply": reply, "pass": ok, "note": note})
        print(f"[{'PASS' if ok else 'FAIL'}] {c['cat']:9s} {c['id']:12s} {note}")
        print(f"         Q: {c['prompt']}")
        print(f"         A: {reply}\n")

    by_cat = {}
    for r in results:
        d = by_cat.setdefault(r["cat"], [0, 0])
        d[0] += r["pass"]; d[1] += 1
    print("=" * 64)
    print(f"TOTAL: {passed}/{len(CASES)} passed")
    for cat, (p, n) in sorted(by_cat.items()):
        print(f"  {cat:10s} {p}/{n}")

    os.makedirs("test-results", exist_ok=True)
    idx = len([f for f in os.listdir("test-results") if f.startswith("eval-companion-")])
    out = os.path.join("test-results", f"eval-companion-{idx}.json")
    with open(out, "w") as f:
        json.dump({"base": args.base, "passed": passed, "total": len(CASES), "results": results}, f, indent=2, ensure_ascii=False)
    print(f"\nRaw results -> {out}")
    return 0 if passed == len(CASES) else 1


if __name__ == "__main__":
    sys.exit(main())
