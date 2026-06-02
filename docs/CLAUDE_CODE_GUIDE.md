# Driving Claude Code at its peak — on the Belong project

A practical guide to the Claude Code features that matter most for *this* repo, and the custom tooling now wired into it. Read it once, keep it as a cheat-sheet.

---

## 1. The mental model

Claude Code is an **agent** with tools (read/edit files, run bash, search, spawn sub-agents). You steer it three ways:
1. **Context** — what it knows: `CLAUDE.md` files (loaded every session), your memory, the files it reads.
2. **Modes** — how it behaves: normal vs **plan mode** (designs before touching code), permission mode.
3. **Tools you give it** — sub-agents, slash commands, hooks, MCP servers.

The single biggest lever for quality: **give it the right context and let it plan before it codes.** Most "the AI did the wrong thing" moments are missing-context or skipped-planning moments.

---

## 2. What's already set up in this repo

| File | What it does |
|---|---|
| `CLAUDE.md` (root) | Architecture + the non-obvious gotchas (ports, model-id 404, `enable_thinking`, SW caching, VAPID). Loaded automatically every session. |
| `src/frontend/CLAUDE.md` → `AGENTS.md` | "Next.js 16 ≠ your training data — read `node_modules/next/dist/docs/` first." Loaded when working in the frontend. |
| `.claude/agents/privacy-auditor.md` | Sub-agent that audits changes for anything leaving the box. |
| `.claude/agents/test-author.md` | Sub-agent that writes/runs pytest + Playwright tests. |
| `.claude/commands/eval-companion.md` | `/eval-companion` — scored anti-hallucination eval against `/ask`. |
| `.claude/commands/reset-demo.md` | `/reset-demo` — back up + reset local data to a clean demo seed. |
| `.claude/hooks/guard-no-secrets.sh` + `.claude/settings.json` | Blocks Claude from `git add`/`commit`-ing the VAPID key, `chroma.sqlite3`, or `data/`. |

Memory (persists across sessions, in `~/.claude/.../memory/`): deploy topology, AI pipeline, repo-exposure. These load automatically — that's why a fresh session already "knows" your box.

---

## 3. Plan mode — use it for every non-trivial change

Press **Shift+Tab** to cycle into **plan mode** (or just say "plan this first, don't write code yet"). Claude researches and proposes a plan; nothing is edited until you approve. Use it for all of Phase 2/3 work — anything where the design matters more than the typing.

There's also a **`Plan` sub-agent** (a software architect) you can invoke explicitly: *"Use the Plan agent to design the tool-calling companion refactor."*

---

## 4. Sub-agents — parallel, specialized, context-isolated

A sub-agent runs in its own context window and returns just a conclusion — great for (a) big fan-out searches and (b) specialized review. Invoke by name:

- *"Use the **privacy-auditor** to review my diff."* — run before every commit that touches network/AI/data.
- *"Use **test-author** to add pytest coverage for `reminders._occurs_on`."*
- *"Use **Explore** to find everywhere the companion's system prompt is assembled."* — built-in, read-only, fast.
- *"Spin up the **Plan** agent to design X."* — built-in architect.
- General research → the built-in `general-purpose` agent.

**Parallelism is the superpower.** Independent work runs concurrently: *"In parallel, have one agent audit the backend for dead code and another map the frontend's data-fetching."* You used this already — the repo audit that fed the roadmap was one `Explore` agent running while I checked your toolchain.

---

## 5. Slash commands & the built-in skills you have

Project commands (this repo): `/eval-companion`, `/reset-demo`.

Built-in skills already available to you — these are high-value and underused:
- **`/code-review`** — reviews your current diff for bugs + cleanups at an effort level (`low`→`ultra`). Run before every commit. `ultra` does a deep multi-agent cloud review.
- **`/security-review`** — security pass on the branch. Given your privacy thesis, run this on anything touching auth, data, or network.
- **`/verify`** — actually runs the app and observes behavior to confirm a change works (not just tests pass).
- **`/run`** — launches the app to see a change live / screenshot it.
- **`/simplify`** — applies reuse/simplification cleanups to changed code (quality, not bug-hunting).
- **`/loop`** — run a prompt/command on a recurring interval (e.g. poll a long build).
- **`/schedule`** — schedule a recurring remote agent (cron).
- **`deep-research`** — multi-source, fact-checked research report (e.g. "best on-device reranker models 2026").

Write your own command anytime: drop a markdown file in `.claude/commands/<name>.md` (frontmatter `description` + `allowed-tools`, body is the prompt; `$ARGUMENTS` injects args). Build one whenever you type the same multi-step request twice.

---

## 6. Hooks — make the harness enforce your rules

Hooks are shell commands the harness runs automatically on events (before/after a tool, on stop, etc.) — Claude can't skip them. Yours blocks committing secrets. Natural next hooks for this repo:
- **Format on save**: a `PostToolUse` hook on Edit/Write that runs `ruff format` (Python) / `eslint --fix` (frontend). *Needs `ruff` installed — `./venv/bin/pip install ruff` — it isn't yet.*
- **Auto-rebuild reminder**: a Stop hook reminding you that prod has no hot-reload (`make build` after frontend changes).

Configure hooks via the **`/config`** command or the `update-config` skill (it knows the current schema) rather than hand-editing — safer.

---

## 7. The dev loop for this stack

```
edit code
 └─ frontend change?  → make build   (prod bundle; no hot reload)
 └─ make start                       (backend :8001 + frontend :3000; depends on `stop`)
 └─ /verify  or  npx playwright test -g "<title>"   (app must be running)
 └─ /code-review high     → fix findings
 └─ "use privacy-auditor" → confirm nothing leaks
 └─ commit (the secrets hook has your back)
```
Remember: the LLM (vLLM Nemotron on `:8000`) is a **separate** service `make` doesn't start — bring it up yourself.

---

## 8. Multi-agent workflows (opt-in, for big sweeps)

For large, structured jobs — "audit every endpoint," "migrate all data access to the new memory layer," "review the whole branch from 5 angles" — Claude can run a **workflow**: many agents fanned out deterministically with verification. It's token-heavy, so it's **opt-in**: just include the word *"workflow"* (or say "fan out agents"). Good fits here: Phase 2 migration sweeps, an exhaustive privacy audit, a multi-angle review before a demo.

---

## 9. Everyday levers

- **Thinking budget**: say *"think"* / *"think hard"* / *"ultrathink"* for harder reasoning on a tough design call.
- **`@path/to/file`** to pin a file into context; **`!command`** to run a shell command yourself and feed its output in (great for interactive logins like `gcloud auth`).
- **Paste an image** (a screenshot of a broken UI) — Claude reads it.
- **`/clear`** between unrelated tasks (fresh context); **`/compact`** to summarize and keep going on the same task.
- **`/fast`** toggles faster Opus output (same model, snappier) for tight iteration.
- **Memory**: tell me "remember that …" for durable cross-session facts; corrections stick.
- **Be specific about done-ness**: "write the test AND run it AND show me it's green" beats "add a test."

---

## 10. Recommended next moves

1. `/code-review high` then knock out the Phase 0 deletions (dead modules, duplicate route, scaffold SVGs).
2. *"Use test-author to stand up `src/backend/tests/` with the first three tests."*
3. `/eval-companion` to get a baseline grounding score before you touch the memory system.
4. Plan-mode the Phase 2 memory redesign before writing any of it.
