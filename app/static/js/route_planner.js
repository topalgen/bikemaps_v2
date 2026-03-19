// bikemaps Berlin — Route Planner

const OSRM_URL = "https://router.project-osrm.org/route/v1/cycling";
const FILTER_RADIUS_M = 100;
const DANGER_MAX = 30; // normalisation cap for score display

const SEV_COLOR = {
  fatal:   getComputedStyle(document.documentElement).getPropertyValue("--severity-fatal").trim()   || "#d90429",
  serious: getComputedStyle(document.documentElement).getPropertyValue("--severity-serious").trim() || "#e76f51",
  light:   getComputedStyle(document.documentElement).getPropertyValue("--severity-light").trim()   || "#2a9d8f",
};
const SEV_RADIUS = { fatal: 9, serious: 7, light: 5 };
const SEV_LABEL  = { fatal: "Getötet", serious: "Schwerverletzt", light: "Leichtverletzt" };

const MONTH_NAMES = ["","Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const LIGHT_MAP   = { Tageslicht: "Tageslicht", Daemmerung: "Dämmerung", Dunkelheit: "Dunkelheit" };

// ── Map init ──────────────────────────────────────────────────────────────────
const map = L.map("map").setView([52.52, 13.405], 12);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

// ── State ─────────────────────────────────────────────────────────────────────
let allAccidents = [];
let accidentLayer = null;
let routeLayer    = null;
let startMarker   = null;
let endMarker     = null;

// ── Load accidents once ───────────────────────────────────────────────────────
fetch("/heatmap/data")
  .then(r => r.json())
  .then(data => { allAccidents = data; });

// ── Pin factory ───────────────────────────────────────────────────────────────
function makePinIcon(letter, color) {
  return L.divIcon({
    className: "",
    html: `<div class="route-pin" style="background:${color}"><span>${letter}</span></div>`,
    iconSize:   [28, 36],
    iconAnchor: [14, 36],
    popupAnchor:[0, -36],
  });
}

// ── Geometry helpers ──────────────────────────────────────────────────────────
function toRad(d) { return d * Math.PI / 180; }

// Equirectangular (flat-Earth) distance in metres — good enough within Berlin
function distMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dlat = toRad(lat2 - lat1);
  const dlon = toRad(lon2 - lon1) * Math.cos(toRad((lat1 + lat2) / 2));
  return R * Math.sqrt(dlat * dlat + dlon * dlon);
}

// Minimum distance from point P to segment AB (all in lat/lon)
function pointToSegmentDistance(plat, plon, alat, alon, blat, blon) {
  const R = 6371000;
  const clat = (alat + blat) / 2;
  // Project to local metres
  const cosLat = Math.cos(toRad(clat));
  const px = toRad(plon - alon) * cosLat * R, py = toRad(plat - alat) * R;
  const bx = toRad(blon - alon) * cosLat * R, by = toRad(blat - alat) * R;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.sqrt(px * px + py * py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const dx = px - t * bx, dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

function isNearRoute(lat, lon, coords) {
  for (let i = 0; i < coords.length - 1; i++) {
    if (pointToSegmentDistance(lat, lon, coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]) <= FILTER_RADIUS_M) {
      return true;
    }
  }
  return false;
}

// ── Popup builder ─────────────────────────────────────────────────────────────
function buildPopup(d) {
  const color = SEV_COLOR[d.severity];
  const light = LIGHT_MAP[d.light] || d.light || "—";
  return `<div class="clean-popup">
    <div class="popup-stripe" style="background:${color}"></div>
    <div class="popup-body">
      <strong style="color:${color}">${SEV_LABEL[d.severity] || d.severity}</strong>
      <div class="popup-detail">${MONTH_NAMES[d.month] || "—"} · ${d.weekday || "—"} · ${d.hour != null ? d.hour + " Uhr" : "—"}</div>
      <div class="popup-detail">${light}</div>
    </div>
  </div>`;
}

// ── Geocode helper ────────────────────────────────────────────────────────────
async function geocode(q) {
  if (!q.trim()) throw new Error("Bitte eine Adresse eingeben.");
  // Bias to Berlin if not mentioned
  const query = /berlin/i.test(q) ? q : q + ", Berlin";
  const resp = await fetch(`/route/geocode?q=${encodeURIComponent(query)}`);
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || "Geocoding fehlgeschlagen.");
  return json; // { lat, lon, display_name }
}

// ── Reverse geocode (for locate button) ──────────────────────────────────────
async function reverseGeocode(lat, lon) {
  const resp = await fetch(`/route/geocode?q=${encodeURIComponent(lat + "," + lon)}`);
  const json = await resp.json();
  if (!resp.ok) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return json.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// ── OSRM routing ──────────────────────────────────────────────────────────────
async function fetchRoute(startLat, startLon, endLat, endLon) {
  const url = `${OSRM_URL}/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("OSRM-Anfrage fehlgeschlagen.");
  const json = await resp.json();
  if (json.code !== "Ok") throw new Error("Route konnte nicht berechnet werden: " + (json.message || json.code));
  return json.routes[0];
}

// ── Main: calculate route ─────────────────────────────────────────────────────
async function calculateRoute() {
  const startVal = document.getElementById("route-start").value.trim();
  const endVal   = document.getElementById("route-end").value.trim();
  const errorEl  = document.getElementById("route-error");
  const statsEl  = document.getElementById("route-stats");
  const btn      = document.getElementById("route-go");

  errorEl.hidden = true;
  statsEl.hidden = true;

  if (!startVal || !endVal) {
    showError("Bitte Start- und Zieladresse eingeben.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Lade …";

  try {
    // 1. Geocode
    const [start, end] = await Promise.all([geocode(startVal), geocode(endVal)]);

    // 2. Routing
    const route = await fetchRoute(start.lat, start.lon, end.lat, end.lon);

    // 3. Draw route
    clearRoute();
    const coords = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    routeLayer = L.polyline(coords, { color: "#118ab2", weight: 5, opacity: 0.85 }).addTo(map);

    // 4. Pins
    startMarker = L.marker([start.lat, start.lon], { icon: makePinIcon("A", "#118ab2") }).addTo(map);
    endMarker   = L.marker([end.lat,   end.lon],   { icon: makePinIcon("B", "#d90429") }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

    // 5. Filter accidents
    const nearby = allAccidents.filter(d => isNearRoute(d.lat, d.lon, coords));

    // 6. Draw accident markers
    if (accidentLayer) { map.removeLayer(accidentLayer); accidentLayer = null; }
    accidentLayer = L.layerGroup();
    nearby.forEach(d => {
      L.circleMarker([d.lat, d.lon], {
        radius:      SEV_RADIUS[d.severity] || 5,
        color:       SEV_COLOR[d.severity],
        fillColor:   SEV_COLOR[d.severity],
        fillOpacity: 0.75,
        weight:      1.5,
      })
        .bindPopup(buildPopup(d), { className: "clean-popup", maxWidth: 220 })
        .addTo(accidentLayer);
    });
    accidentLayer.addTo(map);

    // 7. Stats
    renderStats(nearby, route);

  } catch (err) {
    showError(err.message || "Unbekannter Fehler.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Route berechnen";
  }
}

function clearRoute() {
  if (routeLayer)    { map.removeLayer(routeLayer);    routeLayer    = null; }
  if (startMarker)   { map.removeLayer(startMarker);   startMarker   = null; }
  if (endMarker)     { map.removeLayer(endMarker);     endMarker     = null; }
  if (accidentLayer) { map.removeLayer(accidentLayer); accidentLayer = null; }
}

function showError(msg) {
  const el = document.getElementById("route-error");
  el.textContent = msg;
  el.hidden = false;
}

function renderStats(nearby, route) {
  const counts = { fatal: 0, serious: 0, light: 0 };
  nearby.forEach(d => { if (counts[d.severity] != null) counts[d.severity]++; });

  document.getElementById("route-accident-count").textContent =
    nearby.length.toLocaleString("de-DE");

  // Distance + duration
  const distKm = (route.distance / 1000).toFixed(1);
  const mins   = Math.round(route.duration / 60);
  document.getElementById("route-meta").innerHTML =
    `<div class="route-sev-row" style="justify-content:center;gap:1rem;margin-bottom:0.5rem;">
       <span>🚴 ${distKm} km</span>
       <span>⏱ ${mins} min</span>
     </div>`;

  // Severity breakdown
  const sevHtml = ["fatal","serious","light"].map(s =>
    `<div class="route-sev-row">
       <span class="cb-swatch cb-swatch--${s}"></span>
       <span>${SEV_LABEL[s]}</span>
       <span style="margin-left:auto;font-weight:600">${counts[s]}</span>
     </div>`
  ).join("");
  document.getElementById("route-sev-breakdown").innerHTML = sevHtml;

  // Danger score
  const raw   = counts.fatal * 10 + counts.serious * 3 + counts.light;
  const pct   = Math.min(100, Math.round(raw / DANGER_MAX * 100));
  document.getElementById("route-danger-fill").style.width = pct + "%";

  document.getElementById("route-stats").hidden = false;
}

// ── Locate buttons ────────────────────────────────────────────────────────────
function setupLocate(btnId, inputId) {
  document.getElementById(btnId).addEventListener("click", () => {
    if (!navigator.geolocation) {
      showError("Geolocation wird von diesem Browser nicht unterstützt.");
      return;
    }
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      try {
        const name = await reverseGeocode(lat, lon);
        document.getElementById(inputId).value = name;
      } catch {
        document.getElementById(inputId).value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      }
    }, () => {
      showError("Standort konnte nicht ermittelt werden.");
    });
  });
}

setupLocate("locate-start", "route-start");
setupLocate("locate-end",   "route-end");

// ── Button + Enter key ────────────────────────────────────────────────────────
document.getElementById("route-go").addEventListener("click", calculateRoute);
[document.getElementById("route-start"), document.getElementById("route-end")].forEach(el => {
  el.addEventListener("keydown", e => { if (e.key === "Enter") calculateRoute(); });
});
