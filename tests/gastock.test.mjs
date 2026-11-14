// Georgia's weekly stocking report: reading it (the transcription's checks, name-and-county matching to the frequency
// sheet), saving it, the endpoint, and who may trigger a read. The sample rows are real lines from the state's reports,
// typos included. Usage: PGTEST="-h /path/to/socket -p 54329 -U user -d dbname" node tests/gastock.test.mjs
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { usePsql } from "./pg-adapter.mjs";

const conn = (process.env.PGTEST || "").split(" ").filter(Boolean);
if (!conn.length) { console.log("Set PGTEST to psql connection flags to run these tests."); process.exit(0); }
usePsql(conn);
spawnSync("psql", [...conn, "-q", "-c", "drop schema public cascade; create schema public;"], { encoding: "utf8" });
const D = JSON.parse(readFileSync(new URL("../data/stocking-ga.json", import.meta.url), "utf8"));
const { parseReport, matchWater, norm, isDH, isoDate, refresh, readEvents, PROMPT } = await import("../lib/gastock.js");
const stocking = (await import("../api/stocking.js")).default;
const { q, ensureSchema } = await import("../lib/db.js");
await ensureSchema();
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };
const name = (i) => (i == null ? null : D.waters[i].name + " (" + D.waters[i].county + ")");

// ---- dates ----
assert.equal(isoDate("5/12/2026"), "2026-05-12"); assert.equal(isoDate("11/2/2026"), "2026-11-02");
assert.equal(isoDate("2/30/2026"), ""); assert.equal(isoDate("13/1/2026"), ""); assert.equal(isoDate("May 12"), "");
ok("dates are read as printed and a date that isn't one is refused");

// ---- the week the report names ----
const MAY = `Weekly Trout Stocking Report: 5/11/2026 - 5/15/2026
DATE COUNTY WATERBODY
5/11/2026 Forsyth/Gwinnett Lanier Tailwater
5/12/2026 Fannin Blueridge TW 
5/12/2026 Floyd Johns Creek 
5/12/2026 Murray Holly Creek
5/12/2026 Rabun Moccasin Creek
5/12/2026 Union Cooper Creek
5/12/2026 Walker West Armuchee
5/12/2026 White Chattahoochee River (WMA)
5/15/2026 Rabun West Fork Chattooga River
5/15/2026 White Chattahoochee River
5/15/2026 White Chattahoochee River 
5/15/2026 White Spoilcane Creek`;
const may = parseReport(MAY, "2026-05-20");
assert.equal(may.from, "2026-05-11"); assert.equal(may.to, "2026-05-15");
assert.equal(may.rows.length, 11, "the repeated Chattahoochee row is one stocking");
assert.deepEqual(may.rows[0], { day: "2026-05-11", county: "Forsyth/Gwinnett", water: "Lanier Tailwater" });
assert.equal(may.skipped.length, 0);
const NOV = `WEEK|10/27/2026|11/2/2026
| DATE | COUNTY | WATERBODY |
| --- | --- | --- |
| 10/27/2026 | Rabun | Lake Burton |
| 11/2/2026 | Dawson | Amicalola Creek (DH)  |
| 11/2/2026 | Fannin | Toccoa River (DH) |
| 11/2/2026 | Fulton/Cobb | Morgan Falls TW (DH)  |
| 11/2/2026 | White  | Smith Creek (DH)  |`;
const nov = parseReport(NOV, "2026-11-14");
assert.equal(nov.from, "2026-10-27"); assert.equal(nov.rows.length, 5); assert.equal(nov.rows[3].county, "Fulton/Cobb"); assert.equal(nov.rows[4].county, "White");
assert.equal(nov.rows[1].water, "Amicalola Creek (DH)");
ok("both layouts the report comes in (lines, or a table) read into the same rows, with names exactly as printed");

// A date outside the week is set aside, never fixed; so is a title whose range can't be a week (a real report printed "8/16/1932 - 8/18/2023").
const bad = parseReport(`WEEK|11/3/2026|11/9/2026\n11/3/2026|Rabun|Lake Burton\n11/16/2026|Rabun|Moccasin Creek\n11/4/1932|Rabun|Sarah's Creek\n11/5/2026|Rabun1|Tiger Creek\n11/6/2026|Rabun|X`, "2026-11-14");
assert.deepEqual(bad.rows.map((r) => r.water), ["Lake Burton"]);
assert.deepEqual(bad.skipped.map((s) => s.why), ["outside the week", "outside the week", "county", "water"]);
const typo = parseReport(`Weekly Trout Stocking Report: 8/16/1932 - 8/18/2023\n8/16/1932 Rabun Moccasin Creek\n8/16/1932 Rabun Sarah's Creek`, "2026-11-14");
assert.equal(typo.rows.length, 0); assert.equal(typo.from, ""); assert.equal(typo.skipped.length, 2, "a title that can't be a week isn't trusted, and the 1932 rows are set aside");
assert.equal(parseReport("no table here", "2026-11-14").rows.length, 0);
ok("rows outside the report's week, with a bad county or name, or under a title that can't be a week are set aside and counted, never repaired");

// ---- matching to the frequency sheet: name and county have to agree ----
const m = (c, w) => name(matchWater(c, w));
assert.equal(m("Forsyth/Gwinnett", "Lanier Tailwater"), "Lanier Tailwaters (Forsyth, Gwinnett)");
assert.equal(m("Fannin", "Blueridge TW"), "Blue Ridge Tailwaters (Fannin)");
assert.equal(m("Hart", "Hartwell TW"), "Hartwell Tailwaters (Hart)");
assert.equal(m("Walker", "West Armuchee"), "West Armuchee Creek (Walker)");
assert.equal(m("White", "Chattahoochee River (WMA)"), "Chattahoochee River (White)");
assert.equal(m("Union", "W.F. Wolf Creek"), "West Fork Wolf Creek (Union)");
assert.equal(m("Union", "Wolf Creek"), "Wolf Creek (Union)");
assert.equal(m("Stephens", "Middle Broad River"), "Middle Fork Broad R. (Stephens)");
assert.equal(m("Rabun", "West Fork Chattooga River"), "West Fork Chattooga (Rabun)");
assert.equal(m("Murray", "Mill Creek - 1"), "Mill Creek (Murray)");
assert.equal(m("Chattooga", "East Fork Little River -2"), "East Fork Little River (Chattooga)");
assert.equal(m("Gilmer", "Cartercay River"), "Cartecay River (Gilmer)");
assert.equal(m("Gilmer", "Coosawatee River"), "Coosawattee River (Gilmer)");
assert.equal(m("Rabun", "Black Rock Lake"), "Blackrock Lake (Rabun)");
assert.equal(m("Dawson", "Amicalola Creek (DH)"), "Amicalola Creek (Dawson)");
// the same name in two counties goes by the county
assert.equal(m("Habersham", "Panther Creek (H)"), "Panther Creek (Habersham)"); assert.equal(m("Stephens", "Panther Creek (S)"), "Panther Creek (Stephens)");
assert.equal(m("Rabun", "Tallulah River (R)"), "Tallulah River (Rabun)"); assert.equal(m("Towns", "Tallulah River (T)"), "Tallulah River (Towns)");
assert.equal(m("Union", "Brasstown Creek (U)"), "Brasstown Creek (Union)"); assert.equal(m("Towns", "Brasstown Creek"), "Brasstown Creek (Towns)");
// ...and what isn't on the sheet, or doesn't agree, is not guessed at
assert.equal(m("Fulton/Cobb", "Morgan Falls TW (DH)"), null, "a water the sheet doesn't have");
assert.equal(m("Fannin", "Rock Creek (F)"), null, "Rock Creek is not Rock Creek Lake"); assert.equal(m("Fannin", "Rock Creek Lake"), "Rock Creek Lake (Fannin)");
assert.equal(m("Union", "Toccoa River (U)"), null, "the sheet's Toccoa River is in Fannin");
assert.equal(m("Walker", "Little Chickamauga Creek"), null, "on an older sheet, not this one");
assert.equal(m("Lumkin", "Frogtown Creek"), null, "a misspelled county in the report doesn't match");
assert.equal(m("Paulding", "Pumpkinvine Creek"), null, "an older name is not assumed to be Little Pumpkinvine Creek");
assert.equal(m("White", "Toccoa River"), null);
assert.ok(isDH("Smith Creek (DH)") && isDH("Amicalola Creek (DH)") && !isDH("Smith Creek") && !isDH("Dahlonega Creek"));
assert.equal(norm("Mt. Hope Creek"), norm("Mt Hope Creek"));
// every row of the real reports above lands on the sheet or is left alone, and none lands on two
for (const r of [...may.rows, ...nov.rows]) { const i = matchWater(r.county, r.water); assert.ok(i === null || D.waters[i]); }
assert.equal(may.rows.filter((r) => matchWater(r.county, r.water) == null).length, 0, "every row of that May week is a sheet water");
assert.deepEqual(nov.rows.map((r) => matchWater(r.county, r.water) != null), [true, true, true, false, true]);
ok("a reported water matches the sheet only when its name and county agree; aliases are only the ones both lists prove, and the rest stay as printed");

// ---- saving ----
process.env.ANTHROPIC_API_KEY = "test-key";
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(400, 32)]);
let calls = [], reply = NOV, pdfStatus = 200, modelStatus = 200;
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).includes("georgiawildlife.com")) return pdfStatus === 200 ? new Response(PDF) : new Response("no", { status: pdfStatus });
  if (String(url).includes("/v1/messages")) return modelStatus === 200 ? new Response(JSON.stringify({ content: [{ type: "text", text: reply }] }), { headers: { "content-type": "application/json" } }) : new Response("{}", { status: modelStatus });
  throw new Error("unexpected fetch " + url);
};
const T0 = Date.UTC(2026, 10, 14, 12);
let r = await refresh({ now: T0, today: "2026-11-14" });
assert.deepEqual([r.ok, r.rows, r.skipped, r.week], [true, 5, 0, "2026-10-27 to 2026-11-02"]);
const call = calls.find((c) => c.url.includes("/v1/messages")), body = JSON.parse(call.init.body);
assert.equal(call.init.headers["x-api-key"], "test-key");
assert.equal(body.messages[0].content[0].type, "document"); assert.equal(body.messages[0].content[0].source.media_type, "application/pdf");
assert.equal(Buffer.from(body.messages[0].content[0].source.data, "base64").toString().slice(0, 5), "%PDF-");
assert.equal(body.messages[0].content[1].text, PROMPT); assert.ok(/Do not correct/.test(PROMPT));
let ev = await readEvents();
assert.equal(ev.events.length, 5); assert.deepEqual(ev.events[0], { day: "2026-11-02", county: "Dawson", water: "Amicalola Creek (DH)", w: D.waters.findIndex((w) => w.name === "Amicalola Creek"), dh: true });
assert.equal(ev.events.find((e) => e.county === "Fulton/Cobb").w, null);
assert.equal(ev.events.at(-1).day, "2026-10-27");
assert.equal(ev.run.ok, true); assert.equal(ev.run.week, "2026-10-27 to 2026-11-02");
ok("a read saves each stocking as printed, with its sheet match and Delayed Harvest flag, and sends the PDF with the exact instructions");

calls = [];
r = await refresh({ now: T0 + 3600e3, today: "2026-11-14" });
assert.equal(r.skipped, "checked recently"); assert.equal(calls.length, 0, "no fetch and no model call inside three hours");
// a later week adds to what is saved; reading the same report again changes nothing
reply = MAY.replace(/^Weekly Trout Stocking Report: (\S+) - (\S+)$/m, "WEEK|$1|$2").split("\n").map((l) => l.replace(/^(\d+\/\d+\/\d{4}) (\S+) (.+?)\s*$/, "$1|$2|$3")).join("\n");
r = await refresh({ now: T0 + 4 * 3600e3, today: "2026-11-14" });
assert.deepEqual([r.ok, r.rows, r.week], [true, 11, "2026-05-11 to 2026-05-15"]);
ev = await readEvents(); assert.equal(ev.events.length, 16); assert.equal(ev.events[0].day, "2026-11-02"); assert.equal(ev.events.at(-1).day, "2026-05-11");
r = await refresh({ now: T0 + 8 * 3600e3, today: "2026-11-14" }); ev = await readEvents(); assert.equal(ev.events.length, 16, "the same report read twice is the same stockings");
ok("each week adds to the history, and a report read twice doesn't count twice");

// when something goes wrong nothing saved is lost, and the reason is recorded
const failed = async (t, why) => { const x = await refresh({ now: T0 + t * 3600e3, force: true, today: "2026-11-14" }); assert.equal(x.ok, false, why); assert.equal((await readEvents()).events.length, 16, why + ": saved stockings stay"); return x; };
pdfStatus = 404; assert.equal((await failed(20, "report missing")).error, "fetch 404"); pdfStatus = 200;
modelStatus = 500; assert.equal((await failed(21, "model down")).error, "model 500"); modelStatus = 200;
reply = "I could not read the PDF."; assert.equal((await failed(22, "nothing readable")).error, "no rows read");
reply = "WEEK|11/3/2026|11/9/2026\n12/25/2026|Rabun|Lake Burton"; const every = await failed(23, "every row out of range"); assert.equal(every.error, "every row was set aside"); assert.equal(every.skipped, 1);
delete process.env.ANTHROPIC_API_KEY; assert.equal((await failed(24, "no key")).error, "no model key"); process.env.ANTHROPIC_API_KEY = "test-key";
ev = await readEvents(); assert.equal(ev.run.ok, false); assert.ok(ev.run.okAt, "the last good read is kept");
ok("a missing report, a model error, an unreadable or out-of-range transcription each leave the saved stockings alone and say why");

// two reads at once make one call
calls = []; reply = NOV;
const both = await Promise.all([refresh({ now: T0 + 40 * 3600e3, today: "2026-11-14" }), refresh({ now: T0 + 40 * 3600e3, today: "2026-11-14" })]);
assert.equal(both.filter((x) => x.skipped).length, 1); assert.equal(calls.filter((c) => c.url.includes("/v1/messages")).length, 1);
ok("two reads at the same moment make one model call");

// ---- the endpoint ----
function call2(url, headers = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    stocking({ method: "GET", url, headers }, res);
  });
}
let g = await call2("/api/stocking?state=GA");
assert.equal(g.status, 200); assert.equal(g.body.events.length, 16); assert.ok(g.body.events[0].day >= g.body.events.at(-1).day); assert.ok(g.body.run && "okAt" in g.body.run && !("error" in g.body.run));
assert.equal((await call2("/api/stocking")).status, 200, "Georgia is the default");
assert.equal((await call2("/api/stocking?state=TN")).status, 404);
ok("anyone can read the saved stockings and when the report was last read");
calls = [];
assert.equal((await call2("/api/stocking?refresh=1")).status, 403, "a visitor can't start a model call");
assert.equal((await call2("/api/stocking?refresh=1", { "user-agent": "Mozilla/5.0" })).status, 403);
assert.equal((await call2("/api/stocking?refresh=1&force=1", { "user-agent": "vercel-cron/1.0" })).status, 200, "the daily schedule can");
assert.equal(calls.filter((c) => c.url.includes("/v1/messages")).length, 0, "...but a schedule can't force, so inside three hours it reads nothing");
process.env.CRON_SECRET = "s3cret";
assert.equal((await call2("/api/stocking?refresh=1", { "user-agent": "vercel-cron/1.0" })).status, 403, "with a secret set, the user agent alone isn't enough");
assert.equal((await call2("/api/stocking?refresh=1", { authorization: "Bearer wrong" })).status, 403);
assert.equal((await call2("/api/stocking?refresh=1", { authorization: "Bearer s3cret" })).status, 200);
const [att] = await q("select count(*)::int as n from ga_stocking_runs"); assert.equal(att.n, 1);
ok("only the daily schedule (or the site admin) can start a read, and a schedule can't force one");

const vj = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
assert.ok(vj.crons.some((c) => c.path === "/api/stocking?refresh=1"), "the read is scheduled daily");
ok("the daily read is in vercel.json");
console.log(`\nAll ${n} checks passed.`);
