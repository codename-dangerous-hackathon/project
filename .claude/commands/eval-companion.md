---
description: Run an anti-hallucination / grounding eval against the live companion (/ask) and report a scorecard
argument-hint: "[extra prompt or focus, e.g. 'french' or 'emergency contact']"
allowed-tools: Bash, Read, Write, Edit
---

Evaluate the Belong companion's **grounding and anti-hallucination** behavior end-to-end. The companion must answer ONLY from stored facts and must never invent a name, relationship, or appointment.

Focus this run on: $ARGUMENTS

Steps:
1. Confirm the backend is up: `curl -s -m5 -o /dev/null -w "backend %{http_code}\n" http://127.0.0.1:8001/` and the LLM: `curl -s -m5 http://localhost:8000/v1/models`. If either is down, tell me how to start them (`make start`; vLLM is separate) and stop.
2. Read `src/backend/agents/companion.py` for the current system prompt + grounding context, and check what facts are actually seeded (`GET /journal`, `GET /events`, `GET /profile`) so expectations match real data.
3. If `scripts/eval_companion.py` exists, run it. Otherwise create it: a small harness that POSTs a battery of cases to `/ask` and scores each. Cases must cover:
   - **Grounded recall** — a stored family member / med / appointment / the patient's own name → expect the correct stored fact.
   - **Hallucination traps** — ask about a person/appointment that was NEVER stored → the reply must gently admit uncertainty and must NOT produce a fabricated name. Flag any invented proper noun.
   - **Brevity** — replies stay ~1–3 sentences (TTS-friendly).
   - **Language match** — a French and a Spanish prompt → reply in the same language.
   - **Errorless tone** — never "do you remember?", never tells the user they're wrong.
4. Print a scorecard: per-case PASS/FAIL with the actual reply, plus totals. Save raw results to `test-results/eval-companion-<n>.json` (no timestamp call available — use a run index).
5. Summarize the weakest area and propose the single highest-value prompt/grounding fix. Do not change production code unless I ask — this is measurement.
