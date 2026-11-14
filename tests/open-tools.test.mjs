// The tools open for anyone: the trip planner with no club (a state stands in for it, limited by a hash of the address,
// never asking for a name), the Club calendar product page, and the product pages that send people to the open tools.
// Usage: PGTEST="-h /path/to/socket -p 54329 -U user -d dbname" node tests/open-tools.test.mjs
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { usePsql } from "./pg-adapter.mjs";

const conn = (process.env.PGTEST || "").split(" ").filter(Boolean);
if (!conn.length) { console.log("Set PGTEST to psql connection flags to run these tests."); process.exit(0); }
usePsql(conn);
process.env.ANTHROPIC_API_KEY = "test-key";
spawnSync("psql", [...conn, "-q", "-c", "drop schema public cascade; create schema public;"], { encoding: "utf8" });

const plan = (await import("../api/plan.js")).default;
const auth = (await import("../api/auth.js")).default;
const page = (await import("../api/page.js")).default;
const { publicPlace, STATES } = await import("../lib/places.js");
const { buildContext, systemPrompt, todayIn } = await import("../lib/planner.js");
await (await import("../lib/db.js")).ensureSchema();
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };

// ---- the place that stands in for a club ----
assert.equal(Object.keys(STATES).length, 51);
assert.equal(publicPlace({ state: "zz" }), null); assert.equal(publicPlace({}), null); assert.equal(publicPlace(null), null);
const nc = publicPlace({ state: "nc", city: "  Asheville <b>NC</b> {x} " });
assert.equal(nc.state, "NC"); assert.equal(nc.region, "south"); assert.equal(nc.id, null); assert.ok(!/[<>{}]/.test(nc.city), nc.city);
ok("a state (and an optional town) becomes a place; unknown states and markup are refused or cleaned");

// ---- what the model is told: no club, no members ----
const t0 = todayIn(nc.tz);
const sp = systemPrompt(nc, t0);
assert.ok(/trip planner on Fly AI/.test(sp) && /North Carolina/.test(sp));
assert.ok(!/private club|members|the club/i.test(sp), "no club wording: " + (sp.match(/.{30}(private club|members|the club).{30}/i) || [])[0]);
assert.ok(/don't present a Tennessee hatch chart as local/.test(sp), "outside Tennessee it says what the data covers");
assert.ok(!/don't present a Tennessee/.test(systemPrompt(publicPlace({ state: "TN" }), t0)));
const ctx = await buildContext(nc, t0, { base: "https://test.example" });
assert.ok(ctx.includes("North Carolina") && ctx.includes("central point") && ctx.includes("## What's eating"));
assert.ok(!ctx.includes("recent trip reports") && !ctx.includes("members have planned"), "no club trips in the open guide");
const tn = await buildContext(publicPlace({ state: "TN", city: "Nashville" }), t0, {});
assert.ok(/## Stocking/.test(tn) && /mi from a central point in Tennessee/.test(tn) && !/mi from the club/.test(tn));
ok("the open guide's prompt and data read for an angler, not a club, and say distances are rough");

// Georgia publishes frequencies, not dates: the planner is told so and given the frequencies, not a schedule.
const ga = await buildContext(publicPlace({ state: "GA", city: "Blue Ridge" }), t0, {});
assert.ok(/## Stocking \(Georgia Wildlife Resources Division 2026 frequency sheet/.test(ga) && /Never give a stocking date for a Georgia water/.test(ga) && /Weekly_Stocking_Report|Weekly%20Stocking%20Report/.test(ga));
assert.ok(/- Boggs Creek \(Lumpkin County, about \d+ mi from a central point in Georgia\): Weekly from April through July 31/.test(ga), "a Georgia water reads with its frequency and a rough distance");
assert.ok(/Delayed Harvest streams are stocked from November 1/.test(ga), "the planner knows the sheet leaves out Delayed Harvest");
assert.ok(/- Etowah River .*Weekly until July 4, then twice a month\./.test(ga), "a footnote variation reads as its sentence");
const gaStock = ga.slice(ga.indexOf("## Stocking"), ga.indexOf("\n## ", ga.indexOf("## Stocking") + 3) < 0 ? undefined : ga.indexOf("\n## ", ga.indexOf("## Stocking") + 3));
assert.ok(gaStock.includes("Boggs Creek") && !/week of|Week of|TWRA|\d{4}-\d{2}-\d{2}/.test(gaStock), "no dates in Georgia's stocking section");
const gsp = systemPrompt(publicPlace({ state: "GA" }), t0);
assert.ok(/Georgia publishes no dates/.test(gsp) && /don't present a Tennessee hatch chart as local/.test(gsp));
assert.ok(!/## Stocking/.test(await buildContext(publicPlace({ state: "NC", city: "Asheville" }), t0, {})), "no stocking section outside Tennessee and Georgia");
ok("Georgia's trip planner context lists frequencies, says there are no dates, and links the weekly report");

// ---- the endpoint ----
function call({ body, token, ip = "10.0.0.1" }) {
  return new Promise((resolve) => {
    let out = "";
    const res = { statusCode: 200, headersSent: false, setHeader() {}, write(s) { this.headersSent = true; out += s; return true; }, end(s) { if (s) out += s; resolve({ status: this.statusCode, text: out }); } };
    plan({ method: "POST", body, headers: { authorization: token ? `Bearer ${token}` : "", "x-forwarded-for": ip, host: "test.example" } }, res);
  });
}
const events = (r) => r.text.trim().split("\n").map((l) => JSON.parse(l));
const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
let sent = [];
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(init.body));
  const evs = [
    { type: "message_start", message: { id: "m", type: "message", role: "assistant", content: [] } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Fish the Davidson." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];
  return new Response(evs.map(sse).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
};

let r = await call({ body: { question: "Where should I fish Saturday?" } });
assert.equal(r.status, 400); assert.match(JSON.parse(r.text).error, /Pick the state/);
r = await call({ body: { place: { state: "NC" }, question: "x" } });
assert.equal(r.status, 400);
r = await call({ body: { place: { state: "NC", city: "Asheville" }, question: "Where should I fish Saturday?" } });
assert.equal(r.status, 200, r.text);
let ev = events(r);
assert.ok(ev.some((e) => e.t === "text" && /Davidson/.test(e.v)) && ev.at(-1).t === "done");
assert.equal(sent.length, 1); assert.ok(/near Asheville/.test(sent[0].system));
assert.deepEqual(sent[0].tools[0].user_location, { type: "approximate", city: "Asheville", country: "US", timezone: "America/New_York" });
ok("with no club and no name, a state and a question get a streamed answer, located on the town they gave");

// ---- limits: 8 a day per address without a name; a name raises it; the open guide has its own ceiling ----
for (let i = 1; i < 8; i++) { r = await call({ body: { place: { state: "NC" }, question: "Again " + i }, ip: "10.0.0.1" }); assert.equal(r.status, 200, "ask " + i); }
r = await call({ body: { place: { state: "NC" }, question: "One more" }, ip: "10.0.0.1" });
assert.equal(r.status, 429); assert.match(JSON.parse(r.text).error, /this device/);
r = await call({ body: { place: { state: "NC" }, question: "Different address" }, ip: "10.0.0.2" });
assert.equal(r.status, 200);
const g = await new Promise((resolve) => { const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { resolve(o); } }; auth({ method: "POST", body: { type: "guest", name: "Riley" }, headers: { "x-forwarded-for": "10.0.0.1", host: "t" } }, res); });
assert.ok(g.token, JSON.stringify(g));
r = await call({ body: { place: { state: "NC" }, question: "With a name" }, token: g.token, ip: "10.0.0.1" });
assert.equal(r.status, 200, "a named angler isn't held to the anonymous cap: " + r.text);
ok("an address gets 8 questions a day without a name; another address and a named angler are not held to it");

// ---- the club version still needs a name and a club ----
r = await call({ body: { club: "no-such-club", question: "Where?" } });
assert.equal(r.status, 401);
r = await call({ body: { club: "no-such-club", question: "Where?" }, token: g.token });
assert.equal(r.status, 404);
ok("inside a club the guide still needs a saved name and a real club");

// ---- the pages ----
const PAGE = (kind, extra = {}) => new Promise((resolve) => { const headers = {}; const res = { statusCode: 200, setHeader(k, v) { headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { resolve({ status: this.statusCode, body: o }); }, end(b) { resolve({ status: this.statusCode, body: b, headers }); } }; page({ method: "GET", query: { kind, ...extra }, headers: { host: "test.example" } }, res); });
r = await PAGE("clubs");
assert.equal(r.status, 200); const h = String(r.body);
assert.ok(h.includes("<h1>Club calendar</h1>") && h.includes('rel="canonical" href="https://test.example/clubs"') && h.includes("SoftwareApplication") && h.includes("FAQPage"));
assert.ok(h.includes('href="/picker"') && h.includes('href="/plan"') && h.includes('href="/stocking"') && h.includes('href="/trout"'), "it says the tools are open and links them");
assert.ok(h.includes('href="/#start"'));
const fp = String((await PAGE("flypicker")).body), ag = String((await PAGE("tripplanner")).body);
assert.ok(fp.includes('class="cta" href="/picker"') && /no club, no sign-in/i.test(fp));
assert.ok(ag.includes('class="cta" href="/plan"') && /no club, no sign-in/i.test(ag) && !/trip planner tab of a club/.test(ag));
ok("the Club calendar page exists, and the Fly Picker and trip planner pages open the tools for anyone");
const sm = String((await PAGE("sitemap")).body), ll = String((await PAGE("llms")).body);
assert.ok(sm.includes("<loc>https://test.example/clubs</loc>") && ll.includes("[Club calendar](https://test.example/clubs)"));
ok("the sitemap and llms.txt list the Club calendar");

console.log(`\nAll ${n} checks passed.`);
