"""
Unit tests for services.reminders._occurs_on — the recurrence calendar logic.

Semantics confirmed by reading the source (services/reminders._occurs_on):
  * "daily" with no start date -> always True (back-compat).
  * "daily" with a start date  -> True once started, False before the start date.
  * no/blank date (non-daily)  -> False.
  * unparseable date           -> False.
  * start date > today         -> False (recurrence hasn't begun) — applies to daily too.
  * "once"    -> ed == today.
  * "weekly"  -> ed.weekday() == today.weekday()  (and started).
  * "monthly" -> ed.day == today.day              (and started).

All datetimes are fixed for determinism (no datetime.now()).
"""

from datetime import datetime

import services.reminders as reminders


# --- once ---

def test_once_occurs_on_exact_date():
    ev = {"recurrence": "once", "date": "2026-06-20", "time": "09:00"}
    assert reminders._occurs_on(ev, datetime(2026, 6, 20, 9, 0)) is True


def test_once_does_not_occur_on_other_date():
    ev = {"recurrence": "once", "date": "2026-06-20", "time": "09:00"}
    assert reminders._occurs_on(ev, datetime(2026, 6, 21, 9, 0)) is False


# --- daily ---

def test_daily_no_start_date_occurs_any_day():
    # Back-compat: a daily event with no start date fires every day.
    ev = {"recurrence": "daily", "time": "08:00"}
    assert reminders._occurs_on(ev, datetime(2026, 6, 20, 8, 0)) is True


def test_daily_with_started_date_occurs():
    # daily with a start date in the past -> fires.
    ev = {"recurrence": "daily", "date": "2026-06-01", "time": "08:00"}
    assert reminders._occurs_on(ev, datetime(2026, 6, 20, 8, 0)) is True


def test_daily_does_not_occur_before_start_date():
    # Regression: a daily event whose start date is in the future must NOT fire
    # yet (previously it returned True, firing reminders before the med started).
    ev = {"recurrence": "daily", "date": "2099-01-01", "time": "08:00"}
    assert reminders._occurs_on(ev, datetime(2026, 6, 20, 8, 0)) is False


# --- weekly ---

def test_weekly_occurs_on_same_weekday():
    # 2026-06-01 and 2026-06-08 are both Mondays; start has begun (<= now).
    ev = {"recurrence": "weekly", "date": "2026-06-01", "time": "10:00"}
    assert reminders._occurs_on(ev, datetime(2026, 6, 8, 10, 0)) is True


def test_weekly_does_not_occur_on_different_weekday():
    # 2026-06-02 is a Tuesday; start 2026-06-01 is a Monday.
    ev = {"recurrence": "weekly", "date": "2026-06-01", "time": "10:00"}
    assert reminders._occurs_on(ev, datetime(2026, 6, 2, 10, 0)) is False


# --- monthly ---

def test_monthly_occurs_on_same_day_of_month():
    ev = {"recurrence": "monthly", "date": "2026-06-15", "time": "12:00"}
    assert reminders._occurs_on(ev, datetime(2026, 7, 15, 12, 0)) is True


def test_monthly_does_not_occur_on_different_day_of_month():
    ev = {"recurrence": "monthly", "date": "2026-06-15", "time": "12:00"}
    assert reminders._occurs_on(ev, datetime(2026, 7, 16, 12, 0)) is False


# --- edge: recurrence not yet started ---

def test_recurrence_before_start_date_does_not_occur():
    # weekly that matches the weekday but whose start date is in the future.
    ev = {"recurrence": "weekly", "date": "2026-06-08", "time": "10:00"}
    assert reminders._occurs_on(ev, datetime(2026, 6, 1, 10, 0)) is False
