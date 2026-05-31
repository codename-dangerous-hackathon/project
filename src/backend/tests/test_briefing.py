"""
Daily Briefing endpoint: a warm on-device morning briefing composed from the
patient profile + today's schedule. Hermetic (conftest isolation; no models).
"""
from fastapi.testclient import TestClient

import main


def _client():
    return TestClient(main.app)


def test_briefing_greets_by_name_and_lists_todays_meds():
    with _client() as c:
        c.post("/profile", json={"name": "Léo Baleras"})
        c.post("/events", json={"type": "medication", "title": "Sleep pills",
                                "notes": "take one", "time": "16:00", "date": "",
                                "recurrence": "daily"})
        text = c.get("/briefing").json()["briefing"]
        assert text.startswith("Good morning, Léo.")  # first name only
        assert "Today is" in text
        assert "Sleep pills" in text  # today's medication surfaces


def test_briefing_handles_empty_state():
    with _client() as c:
        text = c.get("/briefing").json()["briefing"]
        assert text.startswith("Good morning")
        assert "calm, open day" in text  # no schedule -> gentle fallback
