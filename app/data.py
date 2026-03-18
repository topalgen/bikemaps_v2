import json
import os
from app.config import DATA_DIR

_cache = {}


def _load(filename):
    if filename not in _cache:
        path = os.path.join(DATA_DIR, filename)
        with open(path, "r", encoding="utf-8") as f:
            _cache[filename] = json.load(f)
    return _cache[filename]


def get_accidents():
    return _load("berlin_bike_accidents.json")


def get_stats():
    return _load("stats.json")


def get_crossings():
    return _load("top10_crossings.json")
