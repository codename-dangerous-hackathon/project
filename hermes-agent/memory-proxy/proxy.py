"""
Hermes memory-injecting proxy (web-app channel only).

Sits in front of the Hermes OpenAI-compatible API. On /v1/chat/completions it
reads the dementia patient's memories + family roster READ-ONLY from the app's
ChromaDB sqlite file and injects them (with grounding rules) into the system
message, then forwards to Hermes and streams the reply back.

It NEVER writes to Chroma and never opens a chromadb client (which could lock /
corrupt the app's store). It opens chroma.sqlite3 in read-only immutable mode
only. The app (companion.py) stays the sole writer; nothing about it changes.
"""
import os, json, sqlite3
from datetime import datetime
from aiohttp import web, ClientSession, ClientTimeout

UPSTREAM    = os.getenv("HERMES_UPSTREAM", "http://127.0.0.1:8642")
CHROMA_DB   = os.getenv("CHROMA_SQLITE", "/chroma/chroma.sqlite3")
EVENTS_FILE = os.getenv("EVENTS_JSON", "/appdata/events.json")
PORT        = int(os.getenv("PORT", "8643"))
MAX_MEMS    = int(os.getenv("MAX_MEMORIES", "60"))

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age":       "600",
}

GROUNDING = (
    "You are a warm, reassuring companion for someone experiencing memory loss. "
    "Speak gently and simply. Ground every statement about people, names, "
    "relationships, places, jobs, events, medications, reminders, and "
    "appointments ONLY in the FACTS and SCHEDULE listed below. When asked what "
    "they need to do, or about their day, medications, or appointments, use the "
    "DAILY REMINDERS and APPOINTMENTS exactly as given (state the times "
    "naturally, e.g. \"at 5 o'clock\"). If something a person asks about is not "
    "in this information, do not guess or invent a name, time, or detail — "
    "gently say you're not certain while staying warm (e.g. \"I'm not quite sure "
    "about that, but I'm right here with you\"). NEVER relabel or reinterpret an "
    "entry as something it is not: if asked about a specific appointment, "
    "medication, person, or place that is not listed by that exact "
    "name/description, say you don't see it on their schedule rather than "
    "assuming an existing entry is the one they mean. Only an appointment "
    "literally titled \"dentist\" counts as a dentist appointment, and so on."
)

# ---- read-only memory reader (validated against Chroma 1.5.9) ----
def _read_collection(cur, name):
    seg = cur.execute(
        "SELECT s.id FROM segments s JOIN collections col ON col.id=s.collection "
        "WHERE col.name=? AND s.scope='METADATA'", (name,)).fetchone()
    if not seg:
        return []
    rows = cur.execute(
        "SELECT e.embedding_id,m.key,m.string_value,m.int_value,m.float_value,m.bool_value "
        "FROM embeddings e JOIN embedding_metadata m ON m.id=e.id "
        "WHERE e.segment_id=?", (seg[0],)).fetchall()
    items = {}
    for eid, k, sv, iv, fv, bv in rows:
        d = items.setdefault(eid, {})
        d[k] = sv if sv is not None else (fv if fv is not None else iv)
    out = []
    for eid, d in items.items():
        out.append({
            "id": eid,
            "text": d.get("chroma:document", "") or "",
            "person_id": d.get("person_id", "") or "",
            "name": d.get("name", "") or "",
            "relationship": d.get("relationship", "") or "",
        })
    return out

_cache = {"mtime": -1, "ctx": ""}

def build_memory_context():
    """Return the memory/grounding block, cached until chroma.sqlite3 changes."""
    try:
        mt = os.path.getmtime(CHROMA_DB)
    except OSError:
        return ""
    if mt == _cache["mtime"]:
        return _cache["ctx"]
    ctx = ""
    try:
        con = sqlite3.connect(f"file:{CHROMA_DB}?mode=ro", uri=True)
        cur = con.cursor()
        mems = _read_collection(cur, "life_story_memories")
        ppl  = _read_collection(cur, "people")
        con.close()
        by_id = {p["id"]: p for p in ppl}
        lines = []
        roster = "; ".join(f"{p['name']} ({p['relationship']})".strip()
                           for p in ppl if p["name"])
        if roster:
            lines.append("PEOPLE THE PATIENT KNOWS: " + roster)
        general = [m for m in mems if not m["person_id"] and m["text"]]
        if general:
            lines.append("\nFACTS ABOUT THE PATIENT:")
            lines += [f"- {m['text']}" for m in general[:MAX_MEMS]]
        personal = [m for m in mems if m["person_id"] and m["text"]]
        if personal:
            lines.append("\nFACTS ABOUT SPECIFIC PEOPLE:")
            for m in personal[:MAX_MEMS]:
                nm = by_id.get(m["person_id"], {}).get("name", "")
                lines.append(f"- ({nm}) {m['text']}" if nm else f"- {m['text']}")
        ctx = "\n".join(lines).strip()
    except Exception as e:
        print("[memory-proxy] read error:", e, flush=True)
        ctx = ""
    _cache["mtime"] = mt
    _cache["ctx"] = ctx
    print(f"[memory-proxy] context refreshed: {len(ctx)} chars", flush=True)
    return ctx

def build_schedule_context():
    """Today's reminders + appointments from the app's events.json (read-only)."""
    try:
        with open(EVENTS_FILE) as f:
            events = json.load(f)
    except Exception:
        return ""
    if not isinstance(events, list) or not events:
        return ""
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")

    def fmt(e):
        parts = [str(e.get("time", "")).strip(), "—", str(e.get("title", "")).strip()]
        line = " ".join(p for p in parts if p and p != "—") if not e.get("time") \
               else f"{e.get('time')} — {e.get('title','').strip()}"
        typ = str(e.get("type", "")).strip()
        notes = str(e.get("notes", "")).strip()
        if typ:
            line += f" ({typ})"
        if notes:
            line += f": {notes}"
        return line

    daily    = [e for e in events if e.get("recurrence") == "daily"]
    todays   = [e for e in events if e.get("recurrence") != "daily" and e.get("date") == today]
    upcoming = [e for e in events if e.get("recurrence") != "daily" and e.get("date", "") > today]

    lines = [f"TODAY IS {now.strftime('%A, %B %-d, %Y')}."]
    if daily:
        lines.append("DAILY REMINDERS (every day):")
        lines += [f"- {fmt(e)}" for e in sorted(daily, key=lambda e: e.get("time", ""))]
    if todays:
        lines.append("TODAY'S APPOINTMENTS:")
        lines += [f"- {fmt(e)}" for e in sorted(todays, key=lambda e: e.get("time", ""))]
    if upcoming:
        lines.append("UPCOMING APPOINTMENTS:")
        lines += [f"- {e.get('date')} at {fmt(e)}"
                  for e in sorted(upcoming, key=lambda e: (e.get("date", ""), e.get("time", "")))]
    return "\n".join(lines)

def inject(body):
    blocks = [b for b in (build_memory_context(), build_schedule_context()) if b]
    if not blocks:
        return body            # nothing stored yet -> forward unchanged
    block = GROUNDING + "\n\n" + "\n\n".join(blocks)
    msgs = body.get("messages") or []
    if msgs and msgs[0].get("role") == "system":
        msgs[0]["content"] = f"{msgs[0]['content']}\n\n{block}"
    else:
        msgs.insert(0, {"role": "system", "content": block})
    body["messages"] = msgs
    return body

# ---- proxy ----
async def handle(request):
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS)

    path = request.rel_url.path
    raw = await request.read()

    # strip hop-by-hop + Origin (Hermes 403s unknown Origins; we own CORS here)
    skip = {"host", "origin", "content-length", "connection", "accept-encoding"}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in skip}

    if request.method == "POST" and path.endswith("/chat/completions") and raw:
        try:
            raw = json.dumps(inject(json.loads(raw))).encode()
        except Exception as e:
            print("[memory-proxy] inject skipped:", e, flush=True)

    timeout = ClientTimeout(total=None, sock_read=3600, sock_connect=15)
    async with ClientSession(timeout=timeout) as sess:
        async with sess.request(request.method, UPSTREAM + path,
                                params=request.rel_url.query, data=raw,
                                headers=headers) as up:
            resp = web.StreamResponse(status=up.status, headers=dict(CORS))
            ct = up.headers.get("Content-Type")
            if ct:
                resp.headers["Content-Type"] = ct
            await resp.prepare(request)
            async for chunk in up.content.iter_any():
                await resp.write(chunk)
            await resp.write_eof()
            return resp

def main():
    app = web.Application(client_max_size=64 * 1024 * 1024)
    app.router.add_route("*", "/{tail:.*}", handle)
    print(f"[memory-proxy] :{PORT} -> {UPSTREAM}  (chroma={CHROMA_DB}, ro)", flush=True)
    web.run_app(app, host="0.0.0.0", port=PORT, access_log=None)

if __name__ == "__main__":
    main()
