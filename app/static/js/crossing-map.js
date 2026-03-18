// bikemaps Berlin — Mini-map for crossing detail page

const SEVERITY_COLORS = {
  fatal: "#d90429",
  serious: "#e76f51",
  light: "#2a9d8f",
};

const SEVERITY_LABELS = {
  fatal: "Getoetet",
  serious: "Schwerverletzt",
  light: "Leichtverletzt",
};

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

const map = L.map("crossing-map").setView(CENTER, 17);

// CartoDB Voyager — better building/street detail at high zoom
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20,
}).addTo(map);

// Add markers and collect bounds
const bounds = L.latLngBounds();

ACCIDENTS.forEach((a) => {
  const latlng = [a.lat, a.lon];
  bounds.extend(latlng);

  L.circleMarker(latlng, {
    radius: a.severity === "fatal" ? 10 : a.severity === "serious" ? 7 : 5,
    fillColor: SEVERITY_COLORS[a.severity],
    color: "#fff",
    weight: 2,
    fillOpacity: 0.9,
  })
    .bindPopup(
      `<div class="popup-stripe" style="background:${SEVERITY_COLORS[a.severity]}"></div>` +
      `<div class="popup-body">` +
      `<strong>${SEVERITY_LABELS[a.severity]}</strong>` +
      `<span class="popup-detail">${MONTH_NAMES[a.month]} | ${a.weekday} | ${a.hour}:00 Uhr</span>` +
      `<span class="popup-detail">${a.light}</span>` +
      `</div>`,
      { className: "clean-popup", minWidth: 140, maxWidth: 220 }
    )
    .addTo(map);
});

// Auto-fit to marker bounds with padding
map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });

// Legend
const legend = L.control({ position: "bottomright" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "map-legend");
  div.innerHTML =
    '<div class="legend-item"><span class="legend-dot" style="background:#d90429;width:12px;height:12px"></span> Getoetet</div>' +
    '<div class="legend-item"><span class="legend-dot" style="background:#e76f51;width:10px;height:10px"></span> Schwerverletzt</div>' +
    '<div class="legend-item"><span class="legend-dot" style="background:#2a9d8f;width:8px;height:8px"></span> Leichtverletzt</div>';
  return div;
};
legend.addTo(map);
