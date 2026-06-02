"""
Integration tests for the /events endpoints via fastapi.testclient.TestClient.

The _isolate_state autouse fixture (conftest.py) has already:
  * redirected reminders.EVENTS_FILE / SUBS_FILE to tmp_path,
  * stubbed model warmups, the scheduler, and the LLM,
  * forced ChromaDB onto an in-memory client,
so this exercises the real route handlers against an isolated, ephemeral store.

Using TestClient as a context manager runs FastAPI's startup event — which is
why disabling warmup/scheduler in the fixture matters (otherwise the scheduler
thread would tick forever and warmup would try to load real models).
"""

from fastapi.testclient import TestClient

import main


def _client():
    return TestClient(main.app)


def test_events_round_trip_create_list_delete():
    with _client() as client:
        # Starts empty (isolated tmp store).
        r = client.get("/events")
        assert r.status_code == 200
        assert r.json() == {"events": []}

        # Create.
        payload = {
            "type": "medication",
            "title": "Aspirin",
            "notes": "with breakfast",
            "time": "08:00",
            "date": "",
            "recurrence": "daily",
        }
        r = client.post("/events", json=payload)
        assert r.status_code == 200
        created = r.json()
        assert "id" in created and created["id"]
        assert created["type"] == "medication"
        assert created["title"] == "Aspirin"
        assert created["recurrence"] == "daily"
        event_id = created["id"]

        # GET round-trips the same event.
        r = client.get("/events")
        assert r.status_code == 200
        events = r.json()["events"]
        assert len(events) == 1
        assert events[0]["id"] == event_id
        assert events[0]["title"] == "Aspirin"
        assert events[0]["notes"] == "with breakfast"

        # DELETE removes it.
        r = client.delete(f"/events/{event_id}")
        assert r.status_code == 200
        assert r.json() == {"status": "deleted", "id": event_id}

        # Store is empty again.
        r = client.get("/events")
        assert r.status_code == 200
        assert r.json() == {"events": []}


def test_create_event_requires_mandatory_fields():
    # `type`, `title`, and `time` have no defaults on EventRequest -> 422.
    with _client() as client:
        r = client.post("/events", json={"title": "Lonely"})
        assert r.status_code == 422


def test_delete_unknown_event_is_noop_ok():
    with _client() as client:
        r = client.delete("/events/does-not-exist")
        assert r.status_code == 200
        assert r.json() == {"status": "deleted", "id": "does-not-exist"}
        assert client.get("/events").json() == {"events": []}
