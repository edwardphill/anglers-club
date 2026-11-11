// The public dove field pages: data sanity, then the pages fetched over HTTP from the dev server (which applies
// vercel.json's rewrites). No database needed: these pages come from data/dove-fields.json.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const data = JSON.parse(readFileSync(new URL("../data/dove-fields.json", import.meta.url), "utf8"));
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };

// ---- the data ----
const F = data.fields;
const wmaN = F.filter((f) => f.type === "wma").length, leasedN = F.filter((f) => f.type === "leased").length;
assert.equal(F.length, 82); assert.equal(wmaN + leasedN, 82);
assert.deepEqual(Object.keys(data.regions), ["1", "2", "3", "4"]);
assert.deepEqual([1, 2, 3, 4].map((r) => F.filter((f) => f.region === String(r)).length), [26, 17, 19, 20]);
assert.equal(new Set(F.map((f) => f.slug)).size, 82);
// A rough box for each region, so a flipped sign or a dropped digit can't slip in.
const BOX = { 1: [34.98, 36.68, -90.32, -87.9], 2: [35.0, 36.5, -88.0, -85.5], 3: [35.0, 36.6, -86.0, -84.0], 4: [35.5, 36.7, -84.6, -81.65] };
for (const f of F) {
  assert.match(f.slug, /^[a-z0-9-]+$/, f.slug);
  assert.ok(f.name && f.days && f.permit && data.regions[f.region], f.slug);
  assert.ok(f.lat > 34.98 && f.lat < 36.68 && f.lon > -90.31 && f.lon < -81.65, `${f.slug} is outside Tennessee`);
  const [la0, la1, lo0, lo1] = BOX[f.region];
  assert.ok(f.lat > la0 && f.lat < la1 && f.lon > lo0 && f.lon < lo1, `${f.slug} is outside Region ${f.region}'s box`);
  assert.ok(f.type === "wma" || f.county, `${f.slug}: a leased field names its county`);
  assert.ok(f.directions || f.address, `${f.slug} needs directions or an address`);
  assert.ok(Array.isArray(f.crops) && Array.isArray(f.rules));
}
for (const [id, r] of Object.entries(data.regions)) assert.ok(r.name && r.area && r.slug && /^https:\/\/www\.tn\.gov\/.+region-\d-dove-fields\.html$/.test(r.source) && r.pageUpdated && r.cropsAsOf, "region " + id);
// Two fields at one point is a TWRA data slip; each must say so instead of hiding it.
const byPoint = {};
for (const f of F) (byPoint[f.lat + "," + f.lon] ||= []).push(f);
for (const grp of Object.values(byPoint)) if (grp.length > 1) for (const f of grp) assert.ok(f.coordNote, `${f.slug} shares its point and needs a coordNote`);
ok("82 fields in four regions (26 / 17 / 19 / 20), unique slugs, every point inside its region, directions or address on every field, shared points are flagged");

// ---- the pages ----
const port = 4900 + Math.floor(Math.random() * 90);
const srv = spawn("node", ["tests/dev-server.mjs"], { env: { ...process.env, PORT: String(port), PGTEST: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => { srv.stdout.on("data", (d) => String(d).includes("ready") && res()); srv.on("exit", () => rej(new Error("dev server exited"))); });
const base = `http://localhost:${port}`;
const get = async (p) => { const x = await fetch(base + p, { redirect: "manual" }); return { status: x.status, type: x.headers.get("content-type") || "", cache: x.headers.get("cache-control") || "", text: await x.text() }; };
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const embedded = (html) => JSON.parse(html.match(/<script type="application\/json" id="dove-data">([\s\S]*?)<\/script>/)[1]);

try {
  let g = await get("/dove-fields");
  assert.equal(g.status, 200); assert.match(g.type, /text\/html/); assert.match(g.cache, /s-maxage=300/);
  const h = g.text;
  assert.match(h, /<title>Public dove fields in Tennessee: 82-field TWRA map, 2026 season \| Fly AI<\/title>/);
  assert.ok(h.includes(`<link rel="canonical" href="${base}/dove-fields">`));
  for (const f of F) assert.ok(h.includes(f.name.replace("&", "&amp;")) && h.includes(`href="/dove-fields/${f.slug}"`), f.slug);
  assert.ok(h.includes('id="dmap"') && h.includes("data-filter=\"wma\"") && h.includes("data-filter=\"leased\""));
  assert.ok(h.includes("leaflet@1.9.4/dist/leaflet.js") && h.includes('integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="') && h.includes('integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="'));
  assert.ok(h.includes("Checked against TWRA on November 11, 2026") && h.includes("page updated October 6, 2026") && h.includes("crop status as of August 31, 2026"));
  assert.ok(h.includes("page updated August 27, 2026"), "Region 4's older page date is shown");
  for (const r of Object.values(data.regions)) assert.ok(h.includes(`href="${r.source}"`), "source link for " + r.name);
  assert.ok(h.includes("<strong>2026 hunt days:</strong> Closed September 1."), "Haley Jaqueth's days are on the card");
  assert.ok(h.includes('data-group="region" data-filter="4"') && h.includes('data-region-section="3"') && h.includes("West Tennessee: TWRA Region 1 (26 fields)"));
  ok("the map page lists all 82 fields by region with their 2026 hunt days, a map, region and kind filters, TWRA's dates and pinned Leaflet files");

  const emb = embedded(h);
  assert.equal(emb.fields.length, 82); assert.equal(emb.focus, ""); assert.equal(emb.fields.filter((f) => f.approx).length, F.filter((f) => f.coordNote).length); assert.ok(emb.fields.every((f) => f.region));
  assert.ok(!/<\/script/i.test(h.match(/id="dove-data">([\s\S]*?)<\/script>/)[1]) && !h.match(/id="dove-data">([\s\S]*?)<\/script>/)[1].includes("<"));
  const idx = ldOf(h)[0]["@graph"];
  assert.equal(idx.find((x) => x["@type"] === "ItemList").itemListElement.length, 82); ok("the map's data and the JSON-LD list carry all 82 and hold no raw <");

  for (const f of F) {
    const r = await get("/dove-fields/" + f.slug);
    assert.equal(r.status, 200, f.slug);
    const t = r.text;
    assert.ok(t.includes(`<h1>${f.name.replace("&", "&amp;")}</h1>`));
    assert.ok(t.includes(`${f.lat}, ${f.lon}`), `${f.slug} shows its coordinates`);
    assert.ok(t.includes(`https://www.google.com/maps/dir/?api=1&amp;destination=${f.lat},${f.lon}`));
    assert.ok(t.includes(`<link rel="canonical" href="${base}/dove-fields/${f.slug}">`));
    assert.ok(t.includes(f.permit.replace("&", "&amp;").replace(/'/g, "&#39;")) && t.includes("2026 hunt days"));
    if (f.coordNote) assert.ok(t.includes("Check the map point.") && t.includes(esc(f.coordNote)), f.slug + " shows its coordinate note");
    if (f.note) assert.ok(t.includes("About TWRA's listing.") && t.includes(esc(f.note)), f.slug + " shows its listing note");
    assert.ok(t.includes(`href="${data.regions[f.region].source}"`), f.slug + " links its region's TWRA page");
    const place = ldOf(t)[0]["@graph"].find((x) => x["@type"] === "Place");
    assert.equal(place.geo.latitude, f.lat); assert.equal(place.geo.longitude, f.lon); assert.equal(place.address.addressRegion, "TN");
    assert.equal(embedded(t).focus, f.slug);
    assert.equal((t.match(/<li><a href="\/dove-fields\//g) || []).length, 4, "four nearby fields");
  }
  ok("every field page has its coordinates, its notes about TWRA's listing, a Google Maps link, permit, hunt days, Place JSON-LD with the same point, and four nearby fields");

  g = await get("/dove-fields/cheatham-wma");
  assert.ok(/Nearby dove fields[\s\S]*?<a href="\/dove-fields\/cheatham-lake-wma">Cheatham Lake WMA<\/a>/.test(g.text), "Cheatham Lake is the nearest to Cheatham");
  assert.ok(g.text.includes("Open only for the first dove segment")); ok("the nearest-fields list makes sense (Cheatham and Cheatham Lake are neighbors) and field rules show");

  for (const p of ["/dove-fields/nope", "/dove-fields/constructor", "/dove-fields/__proto__"]) { g = await get(p); assert.equal(g.status, 404, p); assert.match(g.text, /noindex/); }
  g = await get("/dove-fields/"); assert.equal(g.status, 200); ok("unknown fields are 404 with noindex; a trailing slash works");

  assert.ok(h.includes('<nav><a href="/fly-picker">Fly Picker</a> <a href="/ai-fly-guide">AI fly guide</a> <a href="/river-report-tool">River report tool</a> <a href="/rivers">Rivers</a> <a href="/shops">Shops</a> <a href="/guides">Guides</a> <a href="/forum">Forum</a></nav>') && h.includes('<a href="/dove-fields">Public Tennessee dove fields</a>') && h.includes('<a href="/grouse">Tennessee grouse map</a>')); ok("the site header leads with the products and the footer links the dove fields and the grouse map");
} finally {
  srv.kill();
}
console.log(`dove: ${n} groups ok`);
process.exit(0);
