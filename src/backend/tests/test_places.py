"""
Unit tests for services.places._haversine and normalize_category.

No network: _haversine is pure math, and normalize_category is pure string
matching against the real CATEGORY_ALIASES table (services/places.py:44-55).
"""

import pytest

import services.places as places


# --- _haversine ---

def test_haversine_known_distance_cn_tower_to_city_hall():
    # CN Tower (43.6426, -79.3871) -> Toronto City Hall (43.6534, -79.3841).
    # Great-circle distance is ~1.22 km. _haversine returns metres.
    d = places._haversine(43.6426, -79.3871, 43.6534, -79.3841)
    assert d == pytest.approx(1225.0, abs=15.0)


def test_haversine_zero_for_same_point():
    assert places._haversine(43.6426, -79.3871, 43.6426, -79.3871) == pytest.approx(0.0, abs=1e-6)


# --- normalize_category: real aliases -> category keys ---

def test_normalize_category_washroom_aliases():
    for text in ("where is the nearest washroom", "I need a toilet", "find a bathroom", "restroom please"):
        assert places.normalize_category(text) == "washroom"


def test_normalize_category_carehome_aliases():
    for text in ("a nursing home", "long-term care", "the LTC", "any retirement home nearby"):
        assert places.normalize_category(text) == "carehome"


def test_normalize_category_community_aliases():
    for text in ("the rec centre", "a community center", "recreation centre", "activity centre"):
        assert places.normalize_category(text) == "community"


def test_normalize_category_unknown_returns_none():
    assert places.normalize_category("where is the nearest pizza place") is None


def test_normalize_category_empty_and_none_return_none():
    assert places.normalize_category("") is None
    assert places.normalize_category(None) is None
