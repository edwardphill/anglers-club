// Public dove field pages: a map of every TWRA public dove field we have (Region 2 so far) and a page per field with
// its GPS point, directions, crops, permit and hunt days. The list and every fact are plain HTML so they can be read and
// cited without the map; the map (Leaflet over OpenStreetMap) is a layer on top. Data: data/dove-fields.json.
import { DOVE, doveRegion, nearby } from "./dovedata.js";
import { esc, layout, ld, trim, dateLong } from "./pages.js";

const TYPE = { wma: "State wildlife management area", leased: "Leased public field" };
const acres = (f) => (f.acres ? `${f.acres} acres` : "");
const fmtMi = (m) => (m < 10 ? m.toFixed(1) : Math.round(m)) + " miles";
const placeLine = (f) => [TYPE[f.type], f.county ? f.county + " County" : ""].filter(Boolean).join(" · ");
const gmaps = (f) => `https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}`;
const amaps = (f) => `https://maps.apple.com/?daddr=${f.lat},${f.lon}`;
const osm = (f) => `https://www.openstreetmap.org/?mlat=${f.lat}&mlon=${f.lon}#map=14/${f.lat}/${f.lon}`;
const regionsText = () => DOVE.regions.map((r) => `${r.name} (${r.area})`).join(", ");
const SEASON = DOVE.season;
const NOTE = "Field information comes from the Tennessee Wildlife Resources Agency. Anglers Club isn't affiliated with TWRA; confirm dates, permits and rules with TWRA before you hunt.";

const HEAD = `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<style>
.dmap{height:440px;border:1px solid var(--hair);margin:14px 0;background:#e8e4d8}
.dmap.small{height:320px}
@media (max-width:600px){.dmap{height:340px}}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.chips button,.pill{font:500 .72rem/1 "Cinzel",serif;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--ink);background:none;color:var(--ink);padding:9px 12px;cursor:pointer;text-decoration:none;display:inline-block}
.chips button[aria-pressed="true"]{background:var(--green);border-color:var(--green);color:#fff}
.dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;margin-right:.35em;border:1px solid #fff;box-shadow:0 0 0 1px var(--hair)}
.dot.wma{background:#1F4D3A}.dot.leased{background:#9C7A3C}
.rep .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.leaflet-container{font-family:inherit}
</style>`;

const mapScript = () => `<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
(function () {
  var node = document.getElementById("dove-data"), el = document.getElementById("dmap");
  if (!node || !el || !window.L) return;
  var D = JSON.parse(node.textContent), focus = D.focus || "";
  var map = L.map(el, { scrollWheelZoom: false });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  var markers = {}, shown = {};
  var smooth = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  D.fields.forEach(function (f) {
    var big = !focus || f.slug === focus;
    var m = L.circleMarker([f.lat, f.lon], { radius: big ? 10 : 6, color: "#fff", weight: 2, fillColor: f.type === "wma" ? "#1F4D3A" : "#9C7A3C", fillOpacity: big ? 0.95 : 0.7 });
    var box = document.createElement("div");
    var b = document.createElement("strong"); b.textContent = f.name; box.appendChild(b);
    var p = document.createElement("div"); p.textContent = f.days; p.style.cssText = "margin:4px 0;max-width:240px"; box.appendChild(p);
    if (f.slug !== focus) { var a = document.createElement("a"); a.href = "/dove-fields/" + f.slug; a.textContent = "Directions and details"; box.appendChild(a); }
    m.bindPopup(box); m.bindTooltip(f.name);
    markers[f.slug] = m; shown[f.slug] = true; m.addTo(map);
  });
  function fit() {
    var pts = D.fields.filter(function (f) { return shown[f.slug]; }).map(function (f) { return [f.lat, f.lon]; });
    if (focus && markers[focus]) { map.setView(markers[focus].getLatLng(), 11); return; }
    if (pts.length === 1) map.setView(pts[0], 11); else if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
  }
  fit();
  if (focus && markers[focus]) markers[focus].openPopup();
  Array.prototype.forEach.call(document.querySelectorAll("[data-show]"), function (btn) {
    btn.addEventListener("click", function () {
      var m = markers[btn.getAttribute("data-show")]; if (!m) return;
      el.scrollIntoView({ behavior: smooth, block: "center" });
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 11)); m.openPopup();
    });
  });
  var chips = document.querySelectorAll("[data-filter]");
  Array.prototype.forEach.call(chips, function (chip) {
    chip.addEventListener("click", function () {
      var want = chip.getAttribute("data-filter");
      Array.prototype.forEach.call(chips, function (c) { c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
      D.fields.forEach(function (f) {
        var on = want === "all" || f.type === want;
        shown[f.slug] = on;
        if (on) markers[f.slug].addTo(map); else map.removeLayer(markers[f.slug]);
        var card = document.getElementById("f-" + f.slug); if (card) card.hidden = !on;
      });
      map.closePopup(); fit();
    });
  });
})();
</script>`;

const dataTag = (focus) => `<script type="application/json" id="dove-data">${ld({ focus: focus || "", fields: DOVE.fields.map((f) => ({ slug: f.slug, name: f.name, type: f.type, lat: f.lat, lon: f.lon, days: f.days })) })}</script>`;

const sourceNote = () => DOVE.regions.map((r) => `<a href="${esc(r.source)}" rel="noopener">TWRA ${esc(r.name)} dove fields</a> (page updated ${esc(dateLong(r.pageUpdated))}; crop status as of ${esc(dateLong(r.cropsAsOf))})`).join(", ");
const staleNote = () => `<p class="muted">Hunt days are the ${SEASON} dates TWRA published. Checked against TWRA on ${esc(dateLong(DOVE.checked))}. Seasons, permits and field rules change, so confirm with TWRA before you go: ${sourceNote()}, or TWRA at (615) 781-6500.</p>`;

function card(f) {
  return `<article class="rep" id="f-${esc(f.slug)}" data-type="${esc(f.type)}">
<h3><span class="dot ${esc(f.type)}"></span><a href="/dove-fields/${esc(f.slug)}">${esc(f.name)}</a></h3>
<p class="meta">${esc(placeLine(f))}${f.acres ? " · " + esc(acres(f)) : ""}</p>
<p><strong>${SEASON} hunt days:</strong> ${esc(f.days)}</p>
<p class="muted"><strong>Permit:</strong> ${esc(f.permit)}${f.crops && f.crops.length ? " · <strong>Crops:</strong> " + esc(f.crops.join("; ")) : ""}</p>
<div class="acts"><button type="button" class="pill" data-show="${esc(f.slug)}">Show on map</button> <a class="pill" href="/dove-fields/${esc(f.slug)}">Directions and details</a> <a class="pill" href="${esc(gmaps(f))}" rel="noopener">Open in Google Maps</a></div>
</article>`;
}

export function doveIndex({ base }) {
  const n = DOVE.fields.length, wma = DOVE.fields.filter((f) => f.type === "wma").length, leased = n - wma;
  const title = `Public dove fields in Middle Tennessee: ${n}-field TWRA map, ${SEASON} season | Anglers Club`;
  const description = trim(`Map of all ${n} TWRA Region 2 public dove fields (${wma} wildlife management areas and ${leased} leased fields) in Middle Tennessee, with GPS points, directions, crops, permits and ${SEASON} hunt days.`, 158);
  const body = `<h1>Public dove fields in Middle Tennessee</h1>
<p class="muted">Every public dove field TWRA lists for ${esc(regionsText())}: ${wma} wildlife management areas and ${leased} leased fields, with GPS points, directions, crops, permits and ${SEASON} hunt days.</p>
<div id="dmap" class="dmap" role="region" aria-label="Map of public dove fields"></div>
<noscript><p class="muted">The map needs JavaScript. The full list below has every field's directions and GPS coordinates.</p></noscript>
<div class="chips" role="group" aria-label="Show on the map">
<button type="button" data-filter="all" aria-pressed="true">All ${n}</button>
<button type="button" data-filter="wma" aria-pressed="false"><span class="dot wma"></span>WMAs ${wma}</button>
<button type="button" data-filter="leased" aria-pressed="false"><span class="dot leased"></span>Leased fields ${leased}</button>
</div>
${staleNote()}
<h2>All ${n} fields</h2>
${DOVE.fields.map(card).join("\n")}
<h2>Before you go</h2>
<ul class="plain">${DOVE.general.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
<p class="muted">Map data &copy; OpenStreetMap contributors. Field information from TWRA.</p>`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": base + "/dove-fields", url: base + "/dove-fields", name: title, description, inLanguage: "en-US", dateModified: DOVE.checked,
        about: { "@type": "Thing", name: "Public dove hunting fields in Tennessee" } },
      { "@type": "ItemList", itemListElement: DOVE.fields.map((f, i) => ({ "@type": "ListItem", position: i + 1, url: `${base}/dove-fields/${f.slug}`, name: f.name })) },
    ],
  };
  return layout({ base, path: "/dove-fields", title, description, ld: data, body, head: HEAD, foot: dataTag("") + mapScript(), note: NOTE });
}

export function doveFieldPage({ base, field: f }) {
  const region = doveRegion(f.region), path = "/dove-fields/" + f.slug;
  const near = nearby(f, 4);
  const title = `${f.name} dove field: hunt days, directions and permits (${SEASON}) | Anglers Club`;
  const description = trim(`${f.name}${f.acres ? ", a " + f.acres + "-acre" : ", a"} TWRA public dove field${f.county ? " in " + f.county + " County" : ""} in ${region.area}. ${SEASON} hunt days: ${f.days}`, 158);
  const rows = [
    [`${SEASON} hunt days`, f.days], ["Permit", f.permit], ["Size", acres(f)],
    ["Crops", f.crops && f.crops.length ? f.crops.join("; ") + ` (as of ${dateLong(region.cropsAsOf)})` : ""],
    ["Location", [f.address, `${f.lat}, ${f.lon}`].filter(Boolean).join(" · ")],
  ].filter(([, v]) => v);
  const body = `<h1>${esc(f.name)}</h1>
<p class="meta">TWRA ${esc(region.name)} · ${esc(region.area)} · ${esc(placeLine(f))}</p>
<p>${esc(f.name)} is a public dove field${f.county ? " in " + esc(f.county) + " County" : ""} that TWRA lists for ${esc(region.area)}.</p>
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
${f.directions ? `<h2>Directions</h2><p>${esc(f.directions)}</p>` : ""}
<p><a class="pill" href="${esc(gmaps(f))}" rel="noopener">Open in Google Maps</a> <a class="pill" href="${esc(amaps(f))}" rel="noopener">Apple Maps</a> <a class="pill" href="${esc(osm(f))}" rel="noopener">OpenStreetMap</a></p>
<div id="dmap" class="dmap small" role="region" aria-label="Map of ${esc(f.name)}"></div>
${f.rules && f.rules.length ? `<h2>Field rules</h2><ul class="plain">${f.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
<h2>For every field</h2>
<ul class="plain">${DOVE.general.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
${staleNote()}
<h2>Nearby dove fields</h2>
<ul class="plain">${near.map((n) => `<li><a href="/dove-fields/${esc(n.field.slug)}">${esc(n.field.name)}</a> <span class="muted">· ${esc(fmtMi(n.mi))} away in a straight line</span></li>`).join("")}</ul>
<p><a href="/dove-fields">All ${DOVE.fields.length} dove fields on one map</a></p>
<p class="muted">Map data &copy; OpenStreetMap contributors. Field information from TWRA.</p>`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Place", "@id": base + path + "#field", name: f.name, url: base + path, description,
        geo: { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lon },
        address: { "@type": "PostalAddress", ...(f.address ? { streetAddress: f.address } : {}), ...(f.county ? { addressLocality: f.county + " County" } : {}), addressRegion: "TN", addressCountry: "US" },
        publicAccess: true, hasMap: gmaps(f), containedInPlace: { "@type": "State", name: "Tennessee" },
        additionalProperty: [
          { "@type": "PropertyValue", name: `${SEASON} dove hunt days`, value: f.days },
          { "@type": "PropertyValue", name: "Permit", value: f.permit },
          ...(f.acres ? [{ "@type": "PropertyValue", name: "Acres", value: f.acres }] : []),
          ...(f.crops && f.crops.length ? [{ "@type": "PropertyValue", name: "Crops", value: f.crops.join("; ") }] : []),
        ] },
      { "@type": "WebPage", "@id": base + path, url: base + path, name: title, description, inLanguage: "en-US", dateModified: DOVE.checked, about: { "@id": base + path + "#field" },
        isPartOf: { "@type": "CollectionPage", "@id": base + "/dove-fields" } },
    ],
  };
  return layout({ base, path, title, description, ld: data, body, head: HEAD, foot: dataTag(f.slug) + mapScript(), note: NOTE });
}
