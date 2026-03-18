"""
One-time data pipeline: reads raw CSV, filters Berlin bike accidents,
outputs three JSON files for the web app.
"""

import csv
import json
import os
import re
import sys
import time
from collections import Counter

import numpy as np
from sklearn.cluster import DBSCAN
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CSV_PATH = os.path.join(BASE_DIR, "accident context", "Unfallorte2024_LinRef.csv")
DATA_DIR = os.path.join(BASE_DIR, "data")

# Berlin coordinate bounds for validation
LAT_MIN, LAT_MAX = 52.33, 52.68
LON_MIN, LON_MAX = 13.08, 13.76

# Severity mapping: UKATEGORIE 1=fatal, 2=serious, 3=light
SEVERITY_MAP = {"1": "fatal", "2": "serious", "3": "light"}

# Weekday mapping (German stats: 1=Sunday, 2=Monday, ..., 7=Saturday)
WEEKDAY_MAP = {
    "1": "So", "2": "Mo", "3": "Di", "4": "Mi",
    "5": "Do", "6": "Fr", "7": "Sa",
}

# Light conditions: 0=daylight, 1=twilight, 2=darkness
LIGHT_MAP = {"0": "Tageslicht", "1": "Daemmerung", "2": "Dunkelheit"}

# Road condition: 0=dry, 1=wet/damp, 2=slippery (winter)
ROAD_MAP = {"0": "trocken", "1": "nass/feucht", "2": "winterglatt"}


def parse_german_float(s):
    """Convert German decimal format (comma) to float."""
    return float(s.replace(",", "."))


def read_and_filter():
    """Read CSV and return filtered Berlin bike accident records."""
    records = []
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            if row["ULAND"] != "11" or row["IstRad"] != "1":
                continue

            lat = parse_german_float(row["YGCSWGS84"])
            lon = parse_german_float(row["XGCSWGS84"])

            # Validate coordinates
            if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
                print(f"WARNING: out-of-bounds coord: {lat}, {lon}")
                continue

            severity = SEVERITY_MAP.get(row["UKATEGORIE"], "light")

            records.append({
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "severity": severity,
                "month": int(row["UMONAT"]),
                "hour": int(row["USTUNDE"]),
                "weekday": WEEKDAY_MAP.get(row["UWOCHENTAG"], "?"),
                "light": LIGHT_MAP.get(row["ULICHTVERH"], "unbekannt"),
                "road": ROAD_MAP.get(row["IstStrassenzustand"], "unbekannt"),
                "car": int(row["IstPKW"]),
                "pedestrian": int(row["IstFuss"]),
                "motorcycle": int(row["IstKrad"]),
                "truck": int(row["IstGkfz"]),
                "other": int(row["IstSonstige"]),
            })

    print(f"Filtered {len(records)} Berlin bike accidents")
    return records


def compute_stats(records):
    """Pre-compute aggregate statistics."""
    total = len(records)
    severity_counts = Counter(r["severity"] for r in records)
    car_involved = sum(1 for r in records if r["car"] == 1)

    monthly = Counter(r["month"] for r in records)
    hourly = Counter(r["hour"] for r in records)
    weekday_order = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    weekday_counts = Counter(r["weekday"] for r in records)

    return {
        "total": total,
        "fatal": severity_counts.get("fatal", 0),
        "serious": severity_counts.get("serious", 0),
        "light": severity_counts.get("light", 0),
        "car_involved": car_involved,
        "car_percent": round(100 * car_involved / total, 1),
        "monthly": {m: monthly.get(m, 0) for m in range(1, 13)},
        "hourly": {h: hourly.get(h, 0) for h in range(24)},
        "weekday": {d: weekday_counts.get(d, 0) for d in weekday_order},
    }


def find_top_crossings(records, n=10):
    """Use DBSCAN to cluster accidents, score and rank top N crossings."""
    coords = np.array([[r["lat"], r["lon"]] for r in records])

    # DBSCAN with haversine metric, eps in radians (~50m)
    eps_rad = 50 / 6371000  # 50 meters in radians
    db = DBSCAN(eps=eps_rad, min_samples=3, metric="haversine", algorithm="ball_tree")
    labels = db.fit_predict(np.radians(coords))

    # Group records by cluster
    clusters = {}
    for i, label in enumerate(labels):
        if label == -1:
            continue
        clusters.setdefault(label, []).append(records[i])

    # Score each cluster
    scored = []
    for label, cluster_records in clusters.items():
        sev = Counter(r["severity"] for r in cluster_records)
        score = 10 * sev.get("fatal", 0) + 4 * sev.get("serious", 0) + sev.get("light", 0)
        center_lat = np.mean([r["lat"] for r in cluster_records])
        center_lon = np.mean([r["lon"] for r in cluster_records])
        scored.append({
            "center": [round(center_lat, 6), round(center_lon, 6)],
            "count": len(cluster_records),
            "fatal": sev.get("fatal", 0),
            "serious": sev.get("serious", 0),
            "light": sev.get("light", 0),
            "score": score,
            "accidents": cluster_records,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[:n]

    # Reverse geocode to get street names
    print("Reverse geocoding top 10 crossings...")
    geolocator = Nominatim(user_agent="bikemaps_v2_preprocess")
    geocode = RateLimiter(geolocator.reverse, min_delay_seconds=1.1)

    for i, crossing in enumerate(top):
        lat, lon = crossing["center"]
        try:
            location = geocode(f"{lat}, {lon}", language="de", zoom=18)
            if location:
                addr = location.raw.get("address", {})
                road = addr.get("road", addr.get("pedestrian", addr.get("cycleway", "")))
                # Try to get a cross-street from the display name
                display = location.raw.get("display_name", "")
                crossing["name"] = road if road else display.split(",")[0]
                crossing["address"] = display
            else:
                crossing["name"] = f"Kreuzung #{i+1}"
                crossing["address"] = ""
        except Exception as e:
            print(f"  Geocoding failed for cluster {i}: {e}")
            crossing["name"] = f"Kreuzung #{i+1}"
            crossing["address"] = ""

        # Create slug from name
        slug = crossing["name"].lower()
        slug = re.sub(r"[^a-z0-9äöüß]+", "-", slug)
        slug = slug.strip("-")
        # Ensure uniqueness
        crossing["slug"] = f"{i+1}-{slug}"
        crossing["rank"] = i + 1

        print(f"  #{i+1}: {crossing['name']} (score={crossing['score']}, n={crossing['count']})")

    return top


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    # Step 1: Read and filter
    records = read_and_filter()

    # Validation
    assert len(records) > 4000, f"Expected ~4452, got {len(records)}"
    sev_counts = Counter(r["severity"] for r in records)
    print(f"  Fatal: {sev_counts['fatal']}, Serious: {sev_counts['serious']}, Light: {sev_counts['light']}")

    # Step 2: Save accidents JSON
    accidents_path = os.path.join(DATA_DIR, "berlin_bike_accidents.json")
    with open(accidents_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {accidents_path} ({os.path.getsize(accidents_path) / 1024:.0f} KB)")

    # Step 3: Compute and save stats
    stats = compute_stats(records)
    stats_path = os.path.join(DATA_DIR, "stats.json")
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print(f"Wrote {stats_path}")
    print(f"  Stats: {stats['total']} total, {stats['fatal']} fatal, "
          f"{stats['serious']} serious, {stats['car_percent']}% car")

    # Step 4: Find and save top 10 crossings
    crossings = find_top_crossings(records)
    crossings_path = os.path.join(DATA_DIR, "top10_crossings.json")
    with open(crossings_path, "w", encoding="utf-8") as f:
        json.dump(crossings, f, ensure_ascii=False, indent=2)
    print(f"Wrote {crossings_path}")


if __name__ == "__main__":
    main()
