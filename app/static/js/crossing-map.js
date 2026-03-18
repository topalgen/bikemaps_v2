// bikemaps Berlin — Mini-map for crossing detail page

const SEVERITY_COLORS = {
  fatal: "#e63946",
  serious: "#f4a261",
  light: "#a8dadc",
};

const map = L.map("crossing-map").setView(CENTER, 17);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

ACCIDENTS.forEach((a) => {
  L.circleMarker([a.lat, a.lon], {
    radius: a.severity === "fatal" ? 10 : a.severity === "serious" ? 7 : 5,
    fillColor: SEVERITY_COLORS[a.severity],
    color: "#333",
    weight: 1,
    fillOpacity: 0.85,
  })
    .bindPopup(
      `<strong>${a.severity === "fatal" ? "Getoetet" : a.severity === "serious" ? "Schwerverletzt" : "Leichtverletzt"}</strong><br>` +
      `Monat: ${a.month} | ${a.hour}:00 Uhr<br>` +
      `${a.weekday} | ${a.light}`
    )
    .addTo(map);
});
