// Public dove field pages: a map of every TWRA public dove field we have (Regions 1 to 4, all of Tennessee) and a page per field with
// its GPS point, directions, crops, permit and hunt days. The list and every fact are plain HTML so they can be read and
// cited without the map; the map (Leaflet over OpenStreetMap) is a layer on top. Data: data/dove-fields.json.
import { DOVE, doveRegion, nearby } from "./dovedata.js";
import { esc, layout, ld, trim, dateLong } from "./pages.js";

const TYPE = { wma: "TWRA wildlife area", leased: "Leased public field" };
const acres = (f) => (f.acres ? `${f.acres} acres` : "");
const fmtMi = (m) => (m < 10 ? m.toFixed(1) : Math.round(m)) + " miles";
const placeLine = (f) => [TYPE[f.type], f.county ? f.county + " County" : ""].filter(Boolean).join(" · ");
const gmaps = (f) => `https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}`;
const amaps = (f) => `https://maps.apple.com/?daddr=${f.lat},${f.lon}`;
const osm = (f) => `https://www.openstreetmap.org/?mlat=${f.lat}&mlon=${f.lon}#map=14/${f.lat}/${f.lon}`;
const regionsText = () => DOVE.regions.map((r) => `${r.name} (${r.area})`).join(", ");
const inRegion = (id) => DOVE.fields.filter((f) => f.region === id);
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
.chips+.chips{margin-top:0}
.chip-label{font:500 .68rem/1 "Cinzel",serif;letter-spacing:.14em;text-transform:uppercase;color:var(--muted,#6b6b5f);margin:10px 0 0}
.note{border-left:3px solid #9C7A3C;padding:2px 0 2px 12px;margin:10px 0}
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
    var m = L.circleMarker([f.lat, f.lon], { radius: big ? 10 : 6, color: "#fff", weight: 2, fillColor: f.type === "wma" ? "#1F4D3A" : "#9C7A3C", fillOpacity: big ? 0.95 : 0.7, dashArray: f.approx ? "3 3" : null });
    var box = document.createElement("div");
    var b = document.createElement("strong"); b.textContent = f.name; box.appendChild(b);
    var p = document.createElement("div"); p.textContent = f.days; p.style.cssText = "margin:4px 0;max-width:240px"; box.appendChild(p);
    if (f.approx) { var q = document.createElement("div"); q.textContent = "TWRA's coordinates for this field need checking. See the field page."; q.style.cssText = "margin:4px 0;max-width:240px;font-style:italic"; box.appendChild(q); }
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
  var want = { region: "all", type: "all" };
  var chips = document.querySelectorAll("[data-filter]");
  function apply() {
    D.fields.forEach(function (f) {
      var on = (want.region === "all" || f.region === want.region) && (want.type === "all" || f.type === want.type);
      shown[f.slug] = on;
      if (on) markers[f.slug].addTo(map); else map.removeLayer(markers[f.slug]);
      var card = document.getElementById("f-" + f.slug); if (card) card.hidden = !on;
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-region-section]"), function (sec) {
      sec.hidden = !sec.querySelector("article:not([hidden])");
    });
    map.closePopup(); fit();
  }
  Array.prototype.forEach.call(chips, function (chip) {
    chip.addEventListener("click", function () {
      var group = chip.getAttribute("data-group");
      want[group] = chip.getAttribute("data-filter");
      Array.prototype.forEach.call(chips, function (c) { if (c.getAttribute("data-group") === group) c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
      apply();
    });
  });
})();
</script>`;

const dataTag = (focus) => `<script type="application/json" id="dove-data">${ld({ focus: focus || "", fields: DOVE.fields.map((f) => ({ slug: f.slug, name: f.name, type: f.type, lat: f.lat, lon: f.lon, days: f.days, region: f.region, approx: !!f.coordNote })) })}</script>`;

const sourceList = (regions) => `<ul class="plain">${regions.map((r) => `<li><a href="${esc(r.source)}" rel="noopener">TWRA ${esc(r.name)} dove fields</a> (${esc(r.area)}): page updated ${esc(dateLong(r.pageUpdated))}; crop status as of ${esc(dateLong(r.cropsAsOf))}</li>`).join("")}</ul>`;
const staleNote = (regions) => `<p class="muted">Hunt days are the ${SEASON} dates TWRA published. Checked against TWRA on ${esc(dateLong(DOVE.checked))}. Seasons, permits and field rules change, so confirm with TWRA before you go, at ${regions.length > 1 ? "the pages below" : "the page below"} or at (615) 781-6500.</p>${sourceList(regions)}`;

function card(f) {
  return `<article class="rep" id="f-${esc(f.slug)}" data-type="${esc(f.type)}">
<h3><span class="dot ${esc(f.type)}"></span><a href="/dove-fields/${esc(f.slug)}">${esc(f.name)}</a></h3>
<p class="meta">${esc(placeLine(f))}${f.acres ? " · " + esc(acres(f)) : ""}${f.coordNote ? " · map point needs checking" : ""}</p>
<p><strong>${SEASON} hunt days:</strong> ${esc(f.days)}</p>
<p class="muted"><strong>Permit:</strong> ${esc(f.permit)}${f.crops && f.crops.length ? " · <strong>Crops:</strong> " + esc(f.crops.join("; ")) : ""}</p>
<div class="acts"><button type="button" class="pill" data-show="${esc(f.slug)}">Show on map</button> <a class="pill" href="/dove-fields/${esc(f.slug)}">Directions and details</a> <a class="pill" href="${esc(gmaps(f))}" rel="noopener">Open in Google Maps</a></div>
</article>`;
}

export function doveIndex({ base }) {
  const n = DOVE.fields.length, wma = DOVE.fields.filter((f) => f.type === "wma").length, leased = n - wma;
  const title = `Public dove fields in Tennessee: ${n}-field TWRA map, ${SEASON} season | Anglers Club`;
  const description = trim(`Map of all ${n} TWRA public dove fields in Tennessee, in West Tennessee, Middle Tennessee, the Cumberland Plateau and East Tennessee, with GPS points, directions, crops, permits and ${SEASON} hunt days.`, 158);
  const body = `<h1>Public dove fields in Tennessee</h1>
<p class="muted">Every public dove field TWRA lists across its four regions (${esc(regionsText())}): ${wma} wildlife areas and ${leased} leased fields, with GPS points, directions, crops, permits and ${SEASON} hunt days.</p>
<div id="dmap" class="dmap" role="region" aria-label="Map of public dove fields"></div>
<noscript><p class="muted">The map needs JavaScript. The full list below has every field's directions and GPS coordinates.</p></noscript>
<p class="chip-label">Region</p>
<div class="chips" role="group" aria-label="Filter by region">
<button type="button" data-group="region" data-filter="all" aria-pressed="true">All ${n}</button>
${DOVE.regions.map((r) => `<button type="button" data-group="region" data-filter="${esc(r.id)}" aria-pressed="false">${esc(r.area)} ${inRegion(r.id).length}</button>`).join("\n")}
</div>
<p class="chip-label">Kind of field</p>
<div class="chips" role="group" aria-label="Filter by kind of field">
<button type="button" data-group="type" data-filter="all" aria-pressed="true">Both</button>
<button type="button" data-group="type" data-filter="wma" aria-pressed="false"><span class="dot wma"></span>TWRA wildlife areas ${wma}</button>
<button type="button" data-group="type" data-filter="leased" aria-pressed="false"><span class="dot leased"></span>Leased fields ${leased}</button>
</div>
<p class="muted">A dashed outline on the map means TWRA's coordinates for that field look duplicated or garbled, so check the directions before you drive.</p>
${DOVE.regions.map((r) => `<section data-region-section="${esc(r.id)}" id="${esc(r.slug || "region-" + r.id)}">
<h2>${esc(r.area)}: TWRA ${esc(r.name)} (${inRegion(r.id).length} fields)</h2>
${inRegion(r.id).map(card).join("\n")}
</section>`).join("\n")}
<h2>Before you go</h2>
<ul class="plain">${DOVE.general.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
${staleNote(DOVE.regions)}
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
  const description = trim(`${f.name}${f.acres ? ", a " + f.acres + "-acre" : ", a"} TWRA public dove field${f.county ? " in " + f.county + " County" : ""} in TWRA ${region.name} (${region.area}). ${SEASON} hunt days: ${f.days}`, 158);
  const rows = [
    [`${SEASON} hunt days`, f.days], ["Permit", f.permit], ["Size", acres(f)],
    ["Crops", f.crops && f.crops.length ? f.crops.join("; ") + ` (as of ${dateLong(region.cropsAsOf)})` : ""],
    ["Location", [f.address, `${f.lat}, ${f.lon}`].filter(Boolean).join(" · ")],
  ].filter(([, v]) => v);
  const body = `<h1>${esc(f.name)}</h1>
<p class="meta">TWRA ${esc(region.name)} · ${esc(region.area)} · ${esc(placeLine(f))}</p>
<p>${esc(f.name)} is a public dove field${f.county ? " in " + esc(f.county) + " County" : ""} that TWRA lists for ${esc(region.name)}, ${esc(region.area)}.</p>
${f.coordNote ? `<p class="note"><strong>Check the map point.</strong> ${esc(f.coordNote)}</p>` : ""}
${f.note ? `<p class="note"><strong>About TWRA's listing.</strong> ${esc(f.note)}</p>` : ""}
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
${f.directions ? `<h2>Directions</h2><p>${esc(f.directions)}</p>` : ""}
<p><a class="pill" href="${esc(gmaps(f))}" rel="noopener">Open in Google Maps</a> <a class="pill" href="${esc(amaps(f))}" rel="noopener">Apple Maps</a> <a class="pill" href="${esc(osm(f))}" rel="noopener">OpenStreetMap</a></p>
<div id="dmap" class="dmap small" role="region" aria-label="Map of ${esc(f.name)}"></div>
${f.rules && f.rules.length ? `<h2>Field rules</h2><ul class="plain">${f.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
<h2>For every field</h2>
<ul class="plain">${DOVE.general.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
${staleNote([region])}
<h2>Nearby dove fields</h2>
<ul class="plain">${near.map((n) => `<li><a href="/dove-fields/${esc(n.field.slug)}">${esc(n.field.name)}</a> <span class="muted">· ${esc(fmtMi(n.mi))} away in a straight line</span></li>`).join("")}</ul>
<p><a href="/dove-fields">All ${DOVE.fields.length} Tennessee dove fields on one map</a></p>
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
