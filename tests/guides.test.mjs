// Guides end to end against a real Postgres through psql: a guide adds themself (Google sign-in), lists Instagram and
// shops, anglers message them in the shared inbox, the public pages and the Trip Planner's context pick them up.
// Usage: PGTEST="-h /path/to/socket -p 54329 -U user -d dbname" node tests/guides.test.mjs
import { spawnSync } from "node:child_process";
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
const psql = (sql) => spawnSync("psql", [...conn, "-qtAc", sql], { encoding: "utf8" }).stdout.trim();

const shops = (await import("../api/shops.js")).default;
const auth = (await import("../api/auth.js")).default;
const page = (await import("../api/page.js")).default;
const { buildContext } = await import("../lib/planner.js");

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
    handler({ method, query, body, headers: { authorization: token ? `Bearer ${token}` : "", "x-forwarded-for": ip, host: "test.example" } }, res);
  });
}
const S = (op, o = {}) => call(shops, { query: { op, ...(o.query || {}) }, token: o.token, ip: o.ip });
const P = (op, body, token, ip) => call(shops, { method: "POST", body: { op, ...body }, token, ip });
const PAGE = (kind, extra = {}) => call(page, { query: { kind, ...extra } });
const google = async (sub, name, email) => {
  const r = await call(auth, { method: "POST", body: { type: "google", credential: G.mint({ sub, email: email || `${sub}@example.com`, name }) } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
};
const guest = async (name, ip) => (await call(auth, { method: "POST", ip, body: { type: "guest", name } })).body;
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };

spawnSync("psql", [...conn, "-q", "-c", "drop schema public cascade; create schema public;"], { encoding: "utf8" });
let r = await S("guides");
assert.equal(r.status, 200); assert.deepEqual(r.body.guides, []); ok("no guides yet; the guides table is created on first use");

const admin = await google("adm", "Edward", "admin@example.com");
const ann = await google("ann", "Ann Rivers");
const bo = await google("bo", "Bo Floater");
const angler = await guest("Riley", "10.1.1.1");
const shopOwner = await google("own", "Sam Owner", "owner@example.com");
r = await P("shop_create", { name: "Cumberland Fly Shop", city: "Bristol", state: "TN", lat: 36.59, lon: -82.19, instagram: "cumberlandfly", rivers: ["south_holston"], owner_email: "owner@example.com" }, admin.token);
assert.equal(r.status, 200, JSON.stringify(r.body)); const shop = r.body.shop;

// ---- adding yourself ----
const form = { name: "Ann Rivers Guide Service", city: "Bristol", state: "tn", website: "https://annrivers.example", instagrams: ["@annrivers", "https://www.instagram.com/annrivers.fly/?hl=en", "ANNRIVERS"],
  about: "Float and wade trips on the South Holston and Watauga. Half and full days, all gear provided.", rivers: ["south_holston", "watauga", "nope"], waters: "Also the Doe River",
  trips: ["float", "wade", "bogus"], years: "12", credentials: "TN licensed guide, insured", shops: [{ slug: shop.slug }, { name: "Valley Fly Outfitters", instagram: "@valleyfly" }, { name: "Hackers <b>Fly</b>" }, {}] };
r = await P("guide_save", form); assert.equal(r.status, 401);
r = await P("guide_save", form, angler.token); assert.equal(r.status, 403); assert.match(r.body.error, /Google/);
r = await S("myguide", { token: ann.token }); assert.equal(r.body.guide, null); assert.equal(r.body.google, true); ok("a guide profile needs a Google sign-in; a new account has none");
for (const [bad, why] of [[{ website: "http://nope" }, "website"], [{ instagrams: ["bad name!"] }, "instagram"], [{ state: "Tennessee" }, "state"], [{ years: "99" }, "years"], [{ years: "2.5" }, "years"], [{ name: "A" }, "name"],
  [{ about: "short" }, "about"], [{ rivers: [], waters: "" }, "where"], [{ shops: [{ name: "X", instagram: "no no" }] }, "shop instagram"]]) {
  r = await P("guide_save", { ...form, ...bad }, ann.token); assert.equal(r.status, 400, why);
}
ok("bad websites, Instagram names, states, years, short descriptions and no waters are refused");
r = await P("guide_save", form, ann.token);
assert.equal(r.status, 200, JSON.stringify(r.body));
const g = r.body.guide;
assert.equal(g.slug, "ann-rivers-guide-service"); assert.equal(g.state, "TN"); assert.deepEqual(g.rivers, ["south_holston", "watauga"]); assert.deepEqual(g.trips, ["float", "wade"]);
assert.deepEqual(g.instagrams, ["annrivers", "annrivers.fly"]); assert.equal(g.years, 12); assert.equal(g.status, "active"); assert.ok(!("user_id" in g) && !("lat" in g));
assert.deepEqual(g.shops.map((s) => [s.name, s.listed, s.slug || null, s.instagram || null]), [["Cumberland Fly Shop", true, "cumberland-fly-shop", "cumberlandfly"], ["Valley Fly Outfitters", false, null, "valleyfly"], ["Hackers <b>Fly</b>", false, null, null]]);
const lat = Number(psql(`select lat from guides where id = '${g.id}'`)), lon = Number(psql(`select lon from guides where id = '${g.id}'`));
assert.ok(lat > 36.3 && lat < 36.6 && lon < -81 && lon > -83, "home point is the midpoint of the rivers"); ok("a guide adds themself: slug, state, rivers and trip types checked, Instagram handles cleaned (links and @ accepted, duplicates dropped), listed shops matched");
r = await P("guide_save", { ...form, about: "Now with kayak shuttles and a longer description of the trips we run.", shops: [], instagrams: [] }, ann.token);
assert.equal(r.status, 200); assert.equal(r.body.guide.id, g.id); assert.equal(r.body.guide.slug, g.slug); assert.deepEqual(r.body.guide.shops, []); assert.deepEqual(r.body.guide.instagrams, []);
assert.equal(psql("select count(*) from guides"), "1"); ok("saving again edits the same profile (one per person) and keeps the address");
r = await P("guide_save", form, ann.token); assert.equal(r.status, 200);
r = await P("guide_save", { ...form, name: "Ann Rivers Guide Service", rivers: ["watauga"], waters: "" }, bo.token);
assert.equal(r.status, 200); assert.match(r.body.guide.slug, /^ann-rivers-guide-service-[0-9a-f]{4}$/); const g2 = r.body.guide; ok("a second guide with the same name gets its own address");

// ---- what the public sees ----
r = await S("guides"); assert.deepEqual(r.body.guides.map((x) => x.slug).sort(), [g.slug, g2.slug].sort());
r = await S("guides", { query: { river: "south_holston" } }); assert.deepEqual(r.body.guides.map((x) => x.slug), [g.slug]);
r = await S("guides", { query: { river: "watauga" } }); assert.equal(r.body.guides.length, 2);
r = await S("guide", { query: { slug: g.slug } }); assert.equal(r.status, 200); assert.equal(r.body.guide.name, "Ann Rivers Guide Service");
r = await S("guide", { query: { slug: "nobody" } }); assert.equal(r.status, 404); ok("the guide list filters by river; one guide by address; nobody is a 404");

// ---- public pages ----
r = await PAGE("guide", { slug: g.slug });
assert.equal(r.status, 200); const html = r.body;
assert.ok(html.includes("<h1>Ann Rivers Guide Service</h1>")); assert.ok(html.includes('href="https://www.instagram.com/annrivers/"') && html.includes('href="https://www.instagram.com/annrivers.fly/"'));
assert.ok(html.includes('<a href="/shops/cumberland-fly-shop">Cumberland Fly Shop</a>') && html.includes("Valley Fly Outfitters") && html.includes("(not on Anglers Club)"));
assert.ok(html.includes("(self-reported)") && html.includes('href="/rivers/south-holston"') && html.includes("Also the Doe River") && html.includes("Float trips"));
assert.ok(html.includes("Hackers &lt;b&gt;Fly&lt;/b&gt;") && !html.includes("Hackers <b>"), "shop names are escaped");
assert.ok(html.includes('<link rel="canonical" href="https://test.example/guides/ann-rivers-guide-service">'));
const jsonld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"][0];
assert.equal(jsonld["@type"], "LocalBusiness"); assert.ok(jsonld.sameAs.includes("https://www.instagram.com/annrivers/") && jsonld.sameAs.includes("https://annrivers.example"));
assert.ok(jsonld.areaServed.some((p) => p.name === "South Holston River")); assert.equal(jsonld.address.addressRegion, "TN");
r = await PAGE("guide", { slug: "nobody" }); assert.equal(r.status, 404);
r = await PAGE("guides"); assert.ok(r.body.includes("Ann Rivers Guide Service") && r.body.includes("@annrivers")); ok("a guide's page shows Instagram, shops (listed ones linked, others marked), self-reported claims, rivers, and LocalBusiness data with sameAs");
r = await PAGE("river", { key: "south-holston" }); assert.ok(r.body.includes("Guides on the South Holston River") && r.body.includes('href="/guides/ann-rivers-guide-service"'));
r = await PAGE("river", { key: "watauga" }); assert.ok(r.body.includes("Guides on the Watauga River") && !r.body.includes("Guides on the South"));
r = await PAGE("shop", { slug: shop.slug }); assert.ok(r.body.includes("Guides who list Cumberland Fly Shop") && r.body.includes('href="/guides/ann-rivers-guide-service"')); ok("river pages list the guides on that river; a shop's page lists guides who name it");
r = await PAGE("sitemap"); assert.ok(r.body.includes("<loc>https://test.example/guides</loc>") && r.body.includes("/guides/ann-rivers-guide-service") && r.body.includes("<loc>https://test.example/grouse</loc>"));
r = await PAGE("llms"); assert.ok(r.body.includes("## Fly fishing guides") && r.body.includes("Ann Rivers Guide Service") && r.body.includes("Instagram @annrivers")); ok("the sitemap and llms.txt carry guides and the grouse report");
await P("guide_save", { ...form, about: "<script>alert(1)</script> Float trips on the Holston every week of the year.", shops: [] }, ann.token);
r = await PAGE("guide", { slug: g.slug }); assert.ok(!r.body.includes("<script>alert(1)") && r.body.includes("&lt;script&gt;alert(1)")); ok("a guide's words are escaped on the page");
await P("guide_save", form, ann.token);

// ---- messages: the guide's inbox is the shared inbox ----
r = await P("thread_start", { guide: g.slug, message: "Do you have a float open Saturday?" }); assert.equal(r.status, 401);
r = await P("thread_start", { guide: g.slug, message: "  " }, angler.token); assert.equal(r.status, 400);
r = await P("thread_start", { guide: g.slug, message: "hi" }, ann.token); assert.equal(r.status, 400); assert.match(r.body.error, /own/);
r = await P("thread_start", { guide: "nobody", message: "hi" }, angler.token); assert.equal(r.status, 404);
r = await P("thread_start", { guide: g.slug, message: "  Do you have a float open Saturday?  " }, angler.token);
assert.equal(r.status, 200, JSON.stringify(r.body)); const tid = r.body.id;
r = await P("thread_start", { guide: g.slug, message: "Two of us, flies provided?" }, angler.token); assert.equal(r.body.id, tid);
assert.equal(psql("select count(*) from shop_threads where guide_id is not null and shop_id is null"), "1"); ok("an angler messages a guide; a second message joins the open conversation");
assert.equal((await S("unread", { token: ann.token })).body.unread, 1); assert.equal((await S("unread", { token: bo.token })).body.unread, 0); assert.equal((await S("unread", { token: angler.token })).body.unread, 0);
r = await S("threads", { token: ann.token });
assert.equal(r.body.threads.length, 1); assert.equal(r.body.threads[0].kind, "guide"); assert.equal(r.body.threads[0].side, "shop"); assert.equal(r.body.threads[0].from, "Riley");
assert.equal(r.body.threads[0].shop.name, "Ann Rivers Guide Service"); assert.equal(r.body.threads[0].shop.slug, g.slug); assert.equal(r.body.threads[0].subject, "Question for Ann Rivers Guide Service");
r = await S("thread", { token: bo.token, query: { id: tid } }); assert.equal(r.status, 404);
r = await S("thread", { token: shopOwner.token, query: { id: tid } }); assert.equal(r.status, 404);
r = await S("thread", { token: admin.token, query: { id: tid } }); assert.equal(r.status, 404); ok("the guide's inbox shows who asked; other guides, shops and even the admin can't read it");
r = await P("thread_read", { id: tid }, ann.token); assert.equal(r.status, 200); assert.equal((await S("unread", { token: ann.token })).body.unread, 0);
r = await P("thread_send", { id: tid, body: "x" }, bo.token); assert.equal(r.status, 404);
r = await P("thread_send", { id: tid, body: "Saturday works. Full day is $... let's talk by message. Flies are on me." }, ann.token); assert.equal(r.status, 200);
r = await S("threads", { token: angler.token }); assert.equal(r.body.threads[0].side, "angler"); assert.equal(r.body.threads[0].unread, true); assert.equal(r.body.threads[0].kind, "guide"); assert.equal(r.body.threads[0].status, "replied");
r = await S("thread", { token: angler.token, query: { id: tid } }); assert.deepEqual(r.body.messages.map((m) => m.fromShop), [false, false, true]);
r = await P("thread_status", { id: tid, status: "closed" }, angler.token); assert.equal(r.status, 403);
r = await P("thread_status", { id: tid, status: "closed" }, ann.token); assert.equal(r.status, 200);
r = await P("thread_send", { id: tid, body: "?" }, angler.token); assert.equal(r.status, 400); ok("the guide replies, the angler sees it unread, only the guide closes the conversation");

// ---- pausing, hiding, deleting ----
r = await P("guide_status", { status: "paused" }, ann.token); assert.equal(r.status, 200);
assert.deepEqual((await S("guides")).body.guides.map((x) => x.slug), [g2.slug]); assert.equal((await S("guide", { query: { slug: g.slug } })).status, 404); assert.equal((await PAGE("guide", { slug: g.slug })).status, 404);
assert.ok(!(await PAGE("sitemap")).body.includes("/guides/ann-rivers-guide-service</loc>"));
r = await P("thread_start", { guide: g.slug, message: "still there?" }, angler.token); assert.equal(r.status, 404);
assert.equal((await S("myguide", { token: ann.token })).body.guide.status, "paused");
r = await P("guide_status", { status: "active" }, ann.token); assert.equal(r.status, 200); ok("a guide can pause their profile: pages, lists and new messages stop; it comes back when they say");
r = await P("guide_status", { status: "hidden" }, ann.token); assert.equal(r.status, 403);
r = await P("guide_status", { guide: g.slug, status: "hidden" }, bo.token); assert.equal(r.status, 403, "only the admin hides");
r = await P("guide_status", { guide: g.slug, status: "paused" }, bo.token); assert.equal(r.status, 200, "without admin rights the guide param is ignored: bo only changes bo");
assert.equal((await S("guide", { query: { slug: g.slug } })).status, 200); assert.equal((await S("myguide", { token: bo.token })).body.guide.status, "paused");
r = await P("guide_status", { guide: g.slug, status: "hidden" }, admin.token); assert.equal(r.status, 200);
assert.equal((await S("guide", { query: { slug: g.slug } })).status, 404);
r = await P("guide_status", { status: "active" }, ann.token); assert.equal(r.status, 403, "only the admin lifts a hide");
r = await S("myguide", { token: admin.token }); assert.equal(r.body.admin, true); assert.ok(r.body.all.some((x) => x.slug === g.slug && x.status === "hidden"));
r = await P("guide_save", { ...form, city: "Johnson City" }, ann.token); assert.equal(r.status, 200); assert.equal(r.body.guide.status, "hidden", "editing doesn't bring a hidden profile back");
r = await P("guide_status", { guide: g.slug, status: "active" }, admin.token); assert.equal(r.status, 200); ok("the admin can hide a profile and only the admin lifts it; other people's profile ids are ignored");
await P("guide_status", { status: "active" }, bo.token);

// ---- the Trip Planner knows them ----
const club = { id: "club-x", name: "Nashville Anglers Club", city: "Nashville", state: "TN", lat: 36.16, lon: -86.78, region: "south", waters: ["Caney Fork"], tz: "America/Chicago" };
let ctx = await buildContext(club, "2026-11-11", { base: "https://test.example" });
assert.ok(ctx.includes("## Guides who list themselves on Anglers Club"));
assert.ok(ctx.includes("Ann Rivers Guide Service") && ctx.includes("Instagram @annrivers") && ctx.includes("https://test.example/guides/ann-rivers-guide-service"));
assert.ok(ctx.includes("works with Cumberland Fly Shop, Valley Fly Outfitters (not on Anglers Club)") && ctx.includes("12 years guiding (self-reported)"));
assert.ok(!ctx.includes("Ignore") && !/user_id/.test(ctx));
await P("guide_status", { guide: g2.slug, status: "hidden" }, admin.token);
await P("guide_status", { status: "paused" }, ann.token);
ctx = await buildContext(club, "2026-11-11", { base: "https://test.example" });
assert.ok(ctx.includes("None near this club yet") && !ctx.includes("Ann Rivers Guide Service")); ok("the Trip Planner's club data lists nearby signed-up guides with Instagram, shops and a link, and says so when there are none");
const { systemPrompt } = await import("../lib/planner.js");
const sp = systemPrompt(club, "2026-11-11");
assert.ok(/who isn't on Anglers Club|aren't on Anglers Club|they aren't on Anglers Club/.test(sp) && /never guess prices/.test(sp)); ok("the planner is told to name signed-up guides first, may search for others, and must label them");
await P("guide_status", { status: "active" }, ann.token);

// ---- limits and deleting ----
const eve = await google("eve", "Eve New");
for (let i = 0; i < 3; i++) { r = await P("guide_save", { ...form, name: "Eve " + i }, eve.token); assert.equal(r.status, 200, "save " + i); }
assert.equal(psql("select count(*) from guides where name like 'Eve %'"), "1"); ok("saving over and over keeps one profile");
r = await P("guide_delete", {}, angler.token); assert.equal(r.status, 404);
r = await P("guide_delete", {}, ann.token); assert.equal(r.status, 200);
assert.equal((await S("myguide", { token: ann.token })).body.guide, null); assert.equal(psql("select count(*) from shop_threads where guide_id is not null"), "0");
assert.equal(psql("select count(*) from shop_messages"), "0"); assert.equal((await S("threads", { token: angler.token })).body.threads.length, 0); ok("deleting a profile removes it and its conversations");

console.log(`\nAll ${n} checks passed.`);
process.exit(0);
