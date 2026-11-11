// The public pages for search engines and AI answers: river and shop pages, directories, sitemap, robots.txt, llms.txt and
// photos, fetched over HTTP from the dev server (which applies vercel.json's rewrites), against a real Postgres through psql.
// Usage: PGTEST="-h /path/to/socket -p 54329 -U user -d dbname" node tests/pages.test.mjs
import { spawnSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { usePsql } from "./pg-adapter.mjs";
import { fakeGoogle } from "./google-test.mjs";

const conn = (process.env.PGTEST || "").split(" ").filter(Boolean);
if (!conn.length) { console.log("Set PGTEST to psql connection flags to run these tests."); process.exit(0); }
usePsql(conn);
const G = fakeGoogle();
process.env.GOOGLE_CLIENT_ID = G.clientId;
globalThis.__nacJwks = G.jwks;
process.env.ADMIN_EMAILS = "admin@example.com";
delete process.env.ANTHROPIC_API_KEY;   // no drafting here: the shop fills the form in by hand
delete process.env.SITE_URL; delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

const shops = (await import("../api/shops.js")).default;
const auth = (await import("../api/auth.js")).default;
const page = (await import("../api/page.js")).default;

function call(handler, { method = "GET", query = {}, body, token, ip = "10.0.0.1" } = {}) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); },
      end(buf) { resolve({ status: this.statusCode, body: buf, headers }); },
    };
    handler({ method, query, body, headers: { authorization: token ? `Bearer ${token}` : "", "x-forwarded-for": ip } }, res);
  });
}
const P = (op, body, token) => call(shops, { method: "POST", body: { op, ...body }, token });
const google = async (sub, name, email) => {
  const r = await call(auth, { method: "POST", body: { type: "google", credential: G.mint({ sub, email: email || `${sub}@example.com`, name }) } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
};
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };

const seg = (m, d) => Buffer.concat([Buffer.from([0xff, m, (d.length + 2) >> 8, (d.length + 2) & 255]), d]);
const image = Buffer.concat([
  Buffer.from([0xff, 0xd8]), seg(0xdb, Buffer.alloc(65)), seg(0xc0, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
  seg(0xc4, Buffer.alloc(17)), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x12, 0x34, 0x56]), Buffer.from([0xff, 0xd9]),
]).toString("base64");

spawnSync("psql", [...conn, "-q", "-c", "drop schema public cascade; create schema public;"], { encoding: "utf8" });

// ---- data: one active shop with a live report and an old one, and a hidden shop with a live report ----
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const admin = await google("adm", "Edward", "admin@example.com");
const owner = await google("own", "Sam Owner", "owner@example.com");
const owner2 = await google("own2", "Hidden Owner", "hidden@example.com");
const mk = async (b) => { const r = await P("shop_create", b, admin.token); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.shop; };
const shop = await mk({ name: "Cumberland Fly Shop", city: "Bristol", state: "TN", lat: 36.59, lon: -82.19, website: "https://example.com", instagram: "cumberlandfly", about: "Tailwater guides & gear.", rivers: ["south_holston", "watauga"], owner_email: "owner@example.com" });
const ghost = await mk({ name: "Ghost Fly Shop", city: "Nowhere", state: "TN", rivers: ["south_holston"], owner_email: "hidden@example.com" });
await call(shops, { query: { op: "mine" }, token: owner.token });
await call(shops, { query: { op: "mine" }, token: owner2.token });
const publish = async (token, shopId, fields) => {
  let r = await P("report_photo", { shop: shopId, image }, token); assert.equal(r.status, 200, JSON.stringify(r.body));
  const photoId = r.body.photoId;
  r = await P("report_save", { shop: shopId, photo_id: photoId, river: "south_holston", reported_on: today, flow: "350 cfs", clarity: "clear", temp_f: 52, hatches: ["Sulphur"], flies: [{ name: "Parachute Adams", size: "#16", note: "evening" }], tactics: "Fish the slow water below the weir at dusk.", transcript: "SOUTH HOLSTON REPORT 350 cfs", ...fields }, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id: r.body.id, photoId };
};
const evil = `Sulphurs <script>alert(1)</script> "up" & rising. Fish rose from about six below the dam in slow water.`;
const live = await publish(owner.token, shop.id, { title: "Sulphurs <b>starting</b>", summary: evil });
await publish(owner.token, shop.id, { title: "Old report: low and clear", reported_on: daysAgo(15), summary: "Low clear water and midges in the morning; nothing rising before ten." });
const ghostRep = await publish(owner2.token, ghost.id, { title: "Ghost report", summary: "This shop will be hidden, so none of this may show anywhere public." });
let r = await P("shop_status", { shop: ghost.id, status: "hidden" }, admin.token); assert.equal(r.status, 200);

// ---- HTTP through the dev server, so vercel.json's rewrites are the ones under test ----
const port = 4100 + Math.floor(Math.random() * 800);
const srv = spawn("node", ["tests/dev-server.mjs"], { env: { ...process.env, PORT: String(port), PGTEST: conn.join(" ") }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => { srv.stdout.on("data", (d) => String(d).includes("ready") && res()); srv.on("exit", () => rej(new Error("dev server exited"))); });
const base = `http://localhost:${port}`;
const get = async (path, init) => { const x = await fetch(base + path, { redirect: "manual", ...init }); return { status: x.status, type: x.headers.get("content-type") || "", cache: x.headers.get("cache-control") || "", text: await x.text(), res: x }; };
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][new Date().getUTCMonth()];

try {
  // river page with a live report
  let g = await get("/rivers/south-holston");
  assert.equal(g.status, 200); assert.match(g.type, /text\/html/); assert.match(g.cache, /s-maxage=300/);
  const h = g.text;
  assert.match(h, /<title>South Holston River fishing report and what to fish, \w+ \d{4} \| Anglers Club<\/title>/);
  assert.ok(h.includes(`<link rel="canonical" href="${base}/rivers/south-holston">`));
  assert.ok(h.includes("<h1>South Holston River fishing report</h1>"));
  assert.ok(h.includes("Cumberland Fly Shop") && h.includes("350 cfs") && h.includes("Parachute Adams") && h.includes("#16"));
  assert.ok(h.includes(`datetime="${today}"`) && h.includes("(today)"));
  assert.ok(h.includes(`What to fish on the South Holston River in ${monthName}`), "the Fly Picker's month plan is on the page");
  assert.ok(h.includes("does not use the shop reports"));
  ok("a river page carries the live shop report in plain HTML, with its date, flies, and this month's Fly Picker plan");

  // escaping: a shop's words are text, never markup
  assert.ok(!h.includes("<script>alert(1)"), "script in a summary must not be markup");
  assert.ok(!h.includes("<b>starting</b>"));
  assert.ok(h.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "the summary shows as text");
  assert.ok(h.includes("Sulphurs &lt;b&gt;starting&lt;/b&gt;"), "the headline shows as text");
  const rawLd = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(rawLd.length, 1); assert.ok(!rawLd[0].includes("<") && rawLd[0].includes("\\u003cscript\\u003ealert(1)"), "JSON-LD never holds a literal <");
  const blocks = ldOf(h);
  assert.equal(blocks.length, 1); ok("a shop's text is escaped in the page and in the JSON-LD");

  // structured data
  const graph = blocks[0]["@graph"];
  const riverNode = graph.find((x) => x["@type"] === "RiverBodyOfWater");
  assert.equal(riverNode.name, "South Holston River"); assert.equal(riverNode.geo["@type"], "GeoCoordinates"); assert.ok(typeof riverNode.geo.latitude === "number");
  const arts = graph.filter((x) => x["@type"] === "Article");
  assert.equal(arts.length, 2); // the live one and the archived one
  const a = arts.find((x) => x.datePublished === today);
  assert.equal(a.author.name, "Cumberland Fly Shop"); assert.equal(a.about["@id"], riverNode["@id"]); assert.equal(a.image, `${base}/photos/${live.photoId}.jpg`);
  assert.ok(arts.some((x) => x.datePublished === daysAgo(15)));
  ok("JSON-LD names the river with its coordinates and each report as an article by the shop, with its photo");

  // photo: crawlable, described, and the share image
  assert.ok(h.includes(`<img src="/photos/${live.photoId}.jpg" alt="Cumberland Fly Shop fishing report for the South Holston River, `));
  assert.ok(h.includes(`<meta property="og:image" content="${base}/photos/${live.photoId}.jpg">`));
  g = await get(`/photos/${live.photoId}.jpg`);
  assert.equal(g.status, 200); assert.equal(g.type, "image/jpeg"); assert.match(g.cache, /immutable/);
  assert.equal((await get(`/photos/${ghostRep.photoId}.jpg`)).status, 404);
  assert.equal((await get(`/photos/nope.jpg`)).status, 404); ok("photos are served from /photos/<id>.jpg and only while a published report of an active shop uses them");

  // the archive
  assert.ok(h.includes("Earlier reports") && h.includes("Old report: low and clear") && h.includes("(15 days ago)") && h.includes(`class="tag">Archived`));
  assert.ok(h.indexOf("Sulphurs") < h.indexOf("Earlier reports")); ok("older reports sit under 'Earlier reports', dated and marked archived");

  // hidden shop never shows
  for (const p of ["/rivers/south-holston", "/shops", "/sitemap.xml", "/llms.txt", "/rivers"]) {
    const x = await get(p); assert.ok(!x.text.includes("Ghost"), p + " leaks a hidden shop");
  }
  assert.equal((await get("/shops/ghost-fly-shop")).status, 404); ok("a hidden shop is on no page, no sitemap and no llms.txt");

  // a river with no report
  g = await get("/rivers/elk");
  assert.equal(g.status, 200); assert.ok(g.text.includes("No shop has posted a report for the Elk River in the last 10 days")); assert.ok(!g.text.includes("Earlier reports"));
  assert.ok(g.text.includes(`What to fish on the Elk River in ${monthName}`));
  g = await get("/rivers/watauga");
  assert.ok(g.text.includes('<a href="/shops/cumberland-fly-shop">Cumberland Fly Shop</a>'), "a shop that covers the river is linked when it has no report"); ok("a river with no live report says so and lists the shops that cover it");

  // unknown things
  for (const p of ["/rivers/atlantis", "/rivers/constructor", "/rivers/__proto__", "/shops/nope"]) {
    g = await get(p); assert.equal(g.status, 404, p); assert.match(g.text, /noindex/);
  }
  assert.equal((await get("/rivers/south_holston")).status, 200);
  g = await call(page, { method: "POST", query: { kind: "rivers" } }); assert.equal(g.status, 405); ok("unknown rivers and shops are 404 with noindex; prototype names are not rivers");

  // shop page
  g = await get("/shops/cumberland-fly-shop");
  assert.equal(g.status, 200);
  const sh = g.text;
  assert.ok(sh.includes("<h1>Cumberland Fly Shop</h1>") && sh.includes("Bristol, TN") && sh.includes("Tailwater guides &amp; gear."));
  assert.ok(sh.includes('href="https://example.com" rel="nofollow noopener"') && sh.includes('https://www.instagram.com/cumberlandfly/'));
  assert.ok(sh.includes('<a href="/rivers/south-holston">South Holston River</a>') && sh.includes('<a href="/rivers/watauga">Watauga River</a>'));
  const sg = ldOf(sh)[0]["@graph"], biz = sg.find((x) => x["@type"] === "LocalBusiness");
  assert.equal(biz.name, "Cumberland Fly Shop"); assert.equal(biz.address.addressLocality, "Bristol"); assert.equal(biz.geo.latitude, 36.59);
  assert.ok(biz.sameAs.includes("https://example.com")); assert.equal(sg.filter((x) => x["@type"] === "Article").length, 2);
  assert.ok(sh.includes("Old report: low and clear") && sh.includes("Latest reports")); ok("a shop page has its details, the rivers it covers, its reports, and LocalBusiness data");

  // directories
  g = await get("/rivers");
  assert.ok(g.text.includes('<a href="/rivers/south-holston">South Holston River</a>') && g.text.includes("Cumberland Fly Shop"));
  assert.equal(ldOf(g.text)[0].mainEntity.itemListElement.length, 8);
  g = await get("/shops");
  assert.ok(g.text.includes("Cumberland Fly Shop") && g.text.includes(`last report`)); ok("the river and shop directories list what's there");

  // sitemap, robots, llms.txt
  g = await get("/sitemap.xml");
  assert.equal(g.status, 200); assert.match(g.type, /application\/xml/);
  const locs = [...g.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const p of ["/", "/rivers", "/shops", "/rivers/south-holston", "/rivers/elk", "/shops/cumberland-fly-shop"]) assert.ok(locs.includes(base + p), p);
  assert.equal(locs.length, 5 + 8 + 1 + 1 + 82); assert.ok(locs.includes(base + "/guides") && locs.includes(base + "/grouse")); assert.ok(locs.includes(base + "/dove-fields") && locs.includes(base + "/dove-fields/bark-camp-barrens-wma"));
  assert.ok(g.text.includes(`<loc>${base}/rivers/south-holston</loc><lastmod>${today}</lastmod>`));
  assert.ok(g.text.includes(`<loc>${base}/shops/cumberland-fly-shop</loc><lastmod>${today}</lastmod>`));
  assert.ok(!locs.some((l) => l.includes("_")));
  g = await get("/robots.txt");
  assert.match(g.type, /text\/plain/); assert.ok(g.text.includes(`Sitemap: ${base}/sitemap.xml`) && g.text.includes("Disallow: /api/") && g.text.includes("Allow: /"));
  g = await get("/llms.txt");
  assert.match(g.type, /text\/plain/); assert.ok(g.text.startsWith("# Anglers Club"));
  assert.ok(g.text.includes(`[South Holston River](${base}/rivers/south-holston): latest shop report ${today} from Cumberland Fly Shop`));
  assert.ok(g.text.includes(`[Elk River](${base}/rivers/elk): no shop report in the last 10 days`) && g.text.includes(`[Cumberland Fly Shop](${base}/shops/cumberland-fly-shop): Bristol, TN`)); ok("sitemap.xml, robots.txt and llms.txt list the real pages and nothing hidden");

  // SITE_URL decides the canonical host
  process.env.SITE_URL = "https://angler-club.example/";
  g = await call(page, { query: { kind: "shop", slug: "cumberland-fly-shop" } });
  assert.ok(g.body.includes('<link rel="canonical" href="https://angler-club.example/shops/cumberland-fly-shop">'));
  g = await call(page, { query: { kind: "sitemap" } }); assert.ok(g.body.includes("<loc>https://angler-club.example/</loc>"));
  delete process.env.SITE_URL; ok("SITE_URL sets the canonical host in pages and the sitemap");

  // removing the report takes it off the page and its photo off the web
  r = await P("report_remove", { id: live.id }, owner.token); assert.equal(r.status, 200);
  g = await get("/rivers/south-holston");
  assert.ok(!g.text.includes("Sulphurs") && !g.text.includes(live.photoId) && g.text.includes("Earlier reports") && g.text.includes("No shop has posted a report for the South Holston River in the last 10 days"));
  assert.equal((await get(`/photos/${live.photoId}.jpg`)).status, 404); ok("a removed report leaves the page and its photo stops being served");
} finally {
  srv.kill();
}
console.log(`pages: ${n} groups ok`);
process.exit(0);
