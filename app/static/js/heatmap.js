// bikemaps Berlin — Heatmap with client-side filtering

const SEVERITY_WEIGHT = { fatal: 1.0, serious: 0.7, light: 0.3 };

let allData = [];
let heatLayer = null;

// Init map
const map = L.map("map").setView([52.52, 13.405], 12);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

// Load data
fetch("/heatmap/data")
  .then((r) => r.json())
  .then((data) => {
    allData = data;
    applyFilters();
  });

// Filter logic
function getFilterState() {
  return {
    severity: {
      fatal: document.getElementById("sev-fatal").checked,
      serious: document.getElementById("sev-serious").checked,
      light: document.getElementById("sev-light").checked,
    },
    vehicles: {
      car: document.getElementById("veh-car").checked,
      truck: document.getElementById("veh-truck").checked,
      motorcycle: document.getElementById("veh-motorcycle").checked,
      pedestrian: document.getElementById("veh-pedestrian").checked,
      other: document.getElementById("veh-other").checked,
    },
    hourMin: parseInt(document.getElementById("hour-min").value),
    hourMax: parseInt(document.getElementById("hour-max").value),
    month: document.getElementById("filter-month").value,
    weekday: document.getElementById("filter-weekday").value,
    light: document.getElementById("filter-light").value,
    road: document.getElementById("filter-road").value,
  };
}

function matchesVehicle(record, vehicles) {
  // If all checked, pass everything
  if (vehicles.car && vehicles.truck && vehicles.motorcycle && vehicles.pedestrian && vehicles.other) {
    return true;
  }
  // Otherwise, at least one checked vehicle type must be present in the record
  if (vehicles.car && record.car) return true;
  if (vehicles.truck && record.truck) return true;
  if (vehicles.motorcycle && record.motorcycle) return true;
  if (vehicles.pedestrian && record.pedestrian) return true;
  // "other" = no specific vehicle type flagged, or IstSonstige=1
  if (vehicles.other) {
    const hasSpecific = record.car || record.truck || record.motorcycle || record.pedestrian;
    if (!hasSpecific || record.other) return true;
  }
  return false;
}

function applyFilters() {
  const f = getFilterState();

  const filtered = allData.filter((d) => {
    if (!f.severity[d.severity]) return false;
    if (!matchesVehicle(d, f.vehicles)) return false;
    if (d.hour < f.hourMin || d.hour > f.hourMax) return false;
    if (f.month !== "all" && d.month !== parseInt(f.month)) return false;
    if (f.weekday !== "all" && d.weekday !== f.weekday) return false;
    if (f.light !== "all" && d.light !== f.light) return false;
    if (f.road !== "all" && d.road !== f.road) return false;
    return true;
  });

  // Update counter
  document.getElementById("count").textContent = filtered.length.toLocaleString("de-DE");

  // Build heat data: [lat, lon, intensity]
  const heatData = filtered.map((d) => [
    d.lat,
    d.lon,
    SEVERITY_WEIGHT[d.severity] || 0.3,
  ]);

  // Update heat layer
  if (heatLayer) {
    map.removeLayer(heatLayer);
  }
  heatLayer = L.heatLayer(heatData, {
    radius: 18,
    blur: 20,
    maxZoom: 15,
    gradient: {
      0.15: "#fef9ef",
      0.3: "#fdd49e",
      0.5: "#fdbb84",
      0.65: "#e76f51",
      0.8: "#d90429",
      1.0: "#a4031f",
    },
  }).addTo(map);
}

// Bind filter controls
document.querySelectorAll(".filter-sidebar input, .filter-sidebar select").forEach((el) => {
  el.addEventListener("change", applyFilters);
  el.addEventListener("input", applyFilters);
});
