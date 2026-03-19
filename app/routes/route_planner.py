from flask import Blueprint, render_template, request, jsonify

try:
    from geopy.geocoders import Nominatim
    from geopy.exc import GeocoderTimedOut, GeocoderServiceError
    _geopy_available = True
except ImportError:
    _geopy_available = False

bp = Blueprint("route_planner", __name__, url_prefix="/route")

_geolocator = Nominatim(user_agent="bikemaps-berlin/1.0") if _geopy_available else None

# Berlin bounding box for viewbox bias
_BERLIN_VIEWBOX = ((13.088, 52.338), (13.761, 52.675))  # (SW, NE) as (lon, lat)


@bp.route("/")
def index():
    return render_template("route_planner.html")


@bp.route("/geocode")
def geocode():
    if not _geopy_available or _geolocator is None:
        return jsonify({"error": "Geocoding nicht verfügbar (geopy fehlt)"}), 502

    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "Kein Suchbegriff angegeben"}), 400

    try:
        location = _geolocator.geocode(
            q,
            viewbox=_BERLIN_VIEWBOX,
            bounded=False,
            timeout=5,
        )
    except (GeocoderTimedOut, GeocoderServiceError, Exception):
        return jsonify({"error": "Geocoding-Dienst nicht erreichbar"}), 502

    if location is None:
        return jsonify({"error": f"Adresse nicht gefunden: {q}"}), 404

    return jsonify({
        "lat": location.latitude,
        "lon": location.longitude,
        "display_name": location.address,
    })
