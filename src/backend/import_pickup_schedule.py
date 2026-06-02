#!/usr/bin/env python3
"""
One-time importer: reads pickup-schedule-2026.csv and loads waste_pickup
events into events.json for the configured zone.

Run once from the backend directory:
    python import_pickup_schedule.py

Re-running is safe — it replaces any previously imported waste_pickup events.
"""

import csv
import json
import os
import uuid
from datetime import date

# ── Configuration ────────────────────────────────────────────────────────────
ZONE = "Tuesday1"       # Calendar column value matching this household
REMINDER_TIME = "19:00" # 7 PM evening reminder (24-h)
# ─────────────────────────────────────────────────────────────────────────────

_BASE = os.path.dirname(os.path.abspath(__file__))
_DATA = os.path.join(_BASE, "data")
os.makedirs(_DATA, exist_ok=True)

EVENTS_FILE = os.path.join(_DATA, "events.json")
CSV_FILE    = os.path.join(_BASE, "pickup-schedule-2026.csv")

_BIN_LABELS = {
    "GreenBin":      "Green Bin",
    "Garbage":       "Garbage",
    "Recycling":     "Recycling",
    "YardWaste":     "Yard Waste",
    "ChristmasTree": "Christmas Tree",
}


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


def _parse_date(s):
    """'MM/DD/YY'  →  'YYYY-MM-DD'"""
    m, d, y = s.split("/")
    return f"20{y}-{m}-{d}"


def _active_bins(row):
    """Return ordered list of human-readable bin names that go out this week."""
    return [label for col, label in _BIN_LABELS.items() if row.get(col, "0") not in ("0", "")]


def _title(bins):
    if len(bins) == 1:
        return f"Take out the {bins[0]}"
    if len(bins) == 2:
        return f"Take out the {bins[0]} and {bins[1]}"
    return "Take out the " + ", ".join(bins[:-1]) + f", and {bins[-1]}"


def _notes(bins):
    if not bins:
        return ""
    joined = (
        " and ".join(bins) if len(bins) <= 2
        else ", ".join(bins[:-1]) + f", and {bins[-1]}"
    )
    return f"Reminder: It is {joined} pickup day! Please put the bins at the curb tonight."


def main():
    today = date.today().isoformat()

    # Keep all non-waste events; a re-run cleanly replaces prior imports.
    existing = [e for e in _read(EVENTS_FILE, []) if e.get("type") != "waste_pickup"]

    new_events = []
    with open(CSV_FILE, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row["Calendar"] != ZONE:
                continue

            pickup_date = _parse_date(row["WeekStarting"])
            if pickup_date < today:
                continue  # skip dates already in the past

            bins = _active_bins(row)
            if not bins:
                continue

            new_events.append({
                "id":         str(uuid.uuid4()),
                "type":       "waste_pickup",
                "title":      _title(bins),
                "notes":      _notes(bins),
                "date":       pickup_date,
                "time":       REMINDER_TIME,
                "recurrence": "once",
            })

    _write(EVENTS_FILE, existing + new_events)
    print(f"Done. Imported {len(new_events)} upcoming waste pickup reminders (zone: {ZONE}).")


if __name__ == "__main__":
    main()
