"""
Calendar events + Web Push reminders (medication / appointments / family).

- Events are stored as JSON (small, structured — no need for the vector DB).
- Push subscriptions (one per patient browser) are stored as JSON.
- A background scheduler ticks every ~20s and sends a Web Push when an event is
  due (daily medications at their time, or one-off events on their date+time).
"""

import json
import os
import threading
import time
import uuid
from datetime import datetime, timedelta

_BASE = os.path.dirname(os.path.dirname(__file__))  # src/backend
_DATA = os.path.join(_BASE, "data")
os.makedirs(_DATA, exist_ok=True)

EVENTS_FILE = os.path.join(_DATA, "events.json")
SUBS_FILE = os.path.join(_DATA, "subscriptions.json")
VAPID_PRIVATE = os.path.join(_BASE, "keys", "vapid_private.pem")
with open(os.path.join(_BASE, "keys", "vapid_public.txt")) as _f:
    VAPID_PUBLIC = _f.read().strip()
# VAPID "sub" must be a real-looking mailto/https the push service could use to
# contact the sender. Some services (Apple) reject placeholder/.local domains.
VAPID_CLAIMS_SUB = os.getenv("VAPID_SUB", "mailto:jeremyk@xanu.com")

_lock = threading.Lock()
_fired = set()  # keys of (event_id:date:time) already pushed, avoids duplicates


def _read(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def _write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


# ---- Events ----

def list_events():
    return _read(EVENTS_FILE, [])


def add_event(ev: dict):
    with _lock:
        events = _read(EVENTS_FILE, [])
        ev = {**ev, "id": str(uuid.uuid4())}
        events.append(ev)
        _write(EVENTS_FILE, events)
    return ev


def delete_event(event_id: str):
    with _lock:
        events = [e for e in _read(EVENTS_FILE, []) if e.get("id") != event_id]
        _write(EVENTS_FILE, events)


# ---- Push subscriptions ----

def list_subscriptions():
    return _read(SUBS_FILE, [])


def add_subscription(sub: dict):
    with _lock:
        subs = _read(SUBS_FILE, [])
        subs = [s for s in subs if s.get("endpoint") != sub.get("endpoint")]
        subs.append(sub)
        _write(SUBS_FILE, subs)


def _remove_subscription(endpoint: str):
    with _lock:
        subs = [s for s in _read(SUBS_FILE, []) if s.get("endpoint") != endpoint]
        _write(SUBS_FILE, subs)


def send_push(payload: dict) -> int:
    """Send a payload to every subscribed patient browser. Returns count sent."""
    from pywebpush import webpush, WebPushException

    # Guard: if the key file is missing, pywebpush would treat the path string
    # as the key and fail with a confusing "Could not deserialize" error.
    if not os.path.isfile(VAPID_PRIVATE):
        print(f"VAPID private key missing at {VAPID_PRIVATE} — cannot send push.")
        return 0

    sent = 0
    for sub in list_subscriptions():
        try:
            webpush(
                subscription_info=sub,
                data=json.dumps(payload),
                vapid_private_key=VAPID_PRIVATE,
                vapid_claims={"sub": VAPID_CLAIMS_SUB},
            )
            sent += 1
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):  # expired/unsubscribed
                _remove_subscription(sub.get("endpoint"))
            else:
                print("WebPush error:", e)
        except Exception as e:
            print("push error:", e)
    return sent


# ---- Scheduling ----

def _payload_for(e: dict) -> dict:
    t = e.get("type")
    title = e.get("title", "")
    if t == "medication":
        heading = f"💊 Time for your {title}"
    elif t == "appointment":
        heading = f"📅 {title}"
    elif t == "activity":
        heading = f"🎟️ {title}"
    elif t == "waste_pickup":
        heading = f"♻️ {title}"
    else:
        heading = f"👪 {title}"
    return {
        "title": heading,
        "body": e.get("notes") or "",
        "type": t,
        "event_id": e.get("id"),
        "event_title": title,
    }


def _occurs_on(e: dict, now: datetime) -> bool:
    """Whether event `e` should fire on the calendar day of `now`."""
    rec = e.get("recurrence") or "once"
    if rec == "daily":
        return True
    d = e.get("date") or ""
    if not d:
        return False
    try:
        ed = datetime.strptime(d, "%Y-%m-%d").date()
    except ValueError:
        return False
    today = now.date()
    if ed > today:  # recurrence hasn't started yet
        return False
    if rec == "once":
        return ed == today
    if rec == "weekly":
        return ed.weekday() == today.weekday()
    if rec == "monthly":
        return ed.day == today.day
    return ed == today


def due_events(now: datetime = None):
    now = now or datetime.now()
    hhmm = now.strftime("%H:%M")
    return [e for e in list_events() if e.get("time") == hhmm and _occurs_on(e, now)]


def _sched_phrase(e: dict) -> str:
    r = e.get("recurrence") or "once"
    t = e.get("time", "")
    d = e.get("date") or ""
    if r == "daily":
        return f"every day at {t}"
    if d:
        try:
            dt = datetime.strptime(d, "%Y-%m-%d")
            if r == "weekly":
                return f"every {dt.strftime('%A')} at {t}"
            if r == "monthly":
                return f"on day {dt.day} of each month at {t}"
        except ValueError:
            pass
    if r in ("weekly", "monthly"):
        return f"{r} at {t}"
    return f"on {d} at {t}"


def calendar_summary(now: datetime = None) -> str:
    """A readable summary of the patient's schedule, for the Companion's context."""
    now = now or datetime.now()
    events = list_events()
    if not events:
        return ""
    lines = []
    meds = [e for e in events if e.get("type") == "medication"]
    if meds:
        lines.append("Medications to take:")
        for m in meds:
            note = f" — {m['notes']}" if m.get("notes") else ""
            lines.append(f"  - {m.get('title', '')} {_sched_phrase(m)}{note}")
    todays = [e for e in events if e.get("type") != "medication" and _occurs_on(e, now)]
    if todays:
        lines.append("Today:")
        for e in todays:
            note = f" — {e['notes']}" if e.get("notes") else ""
            lines.append(f"  - {e.get('title', '')} at {e.get('time', '')}{note}")
    upcoming = []
    for e in events:
        if e.get("type") == "medication":
            continue
        for delta in range(1, 8):
            day = now + timedelta(days=delta)
            if _occurs_on(e, day):
                upcoming.append((day, e))
                break
    upcoming.sort(key=lambda x: x[0])
    if upcoming:
        lines.append("Coming up this week:")
        for day, e in upcoming[:5]:
            lines.append(f"  - {e.get('title', '')} on {day.strftime('%A %B %d')} at {e.get('time', '')}")
    return "\n".join(lines)


def tick(now: datetime = None):
    now = now or datetime.now()
    today = now.strftime("%Y-%m-%d")
    for e in due_events(now):
        key = f"{e.get('id')}:{today}:{e.get('time')}"
        if key in _fired:
            continue
        _fired.add(key)
        send_push(_payload_for(e))


def _run():
    while True:
        try:
            tick()
        except Exception as ex:
            print("scheduler error:", ex)
        time.sleep(20)


def start_scheduler():
    threading.Thread(target=_run, daemon=True).start()
    print("Reminder scheduler started.")
