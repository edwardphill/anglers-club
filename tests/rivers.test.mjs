// The river waitlist against a real Postgres through psql: asking for a river, "me too", what the admin sees, and the rules.
// Usage: PGTEST="-h /path/to/socket -p 54329 -U user -d dbname" node tests/rivers.test.mjs
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

const rivers = (await import("../api/rivers.js")).default;
const auth = (await import("../api/auth.js")).default;

function call(handler, { method = "GET", query = {}, body, token, ip = "10.0.0.1" } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); },
      end(b) { resolve({ status: this.statusCode, body: b }); },
    };
    handler({ method, query, body, headers: { authorization: token ? `Bearer ${token}` : "", "x-forwarded-for": ip } }, res);
  });
}
const guest = async (name, ip) => { const r = await call(auth, { method: "POST", ip, body: { type: "guest", name } }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const G1 = async (sub, email) => (await call(auth, { method: "POST", body: { type: "google", credential: G.mint({ sub, email, name: sub }) } })).body;
const get = (token, query) => call(rivers, { query, token });
const post = (body, token, ip) => call(rivers, { method: "POST", body, token, ip });
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };

spawnSync("psql", [...conn, "-q", "-c", "drop schema public cascade; create schema public;"], { encoding: "utf8" });
const a = await guest("Ana", "10.1.0.1"), b = await guest("Ben", "10.1.0.2"), c = await guest("Cy", "10.1.0.3");
const admin = await G1("adm", "admin@example.com");

let r = await get();
assert.equal(r.status, 200); assert.deepEqual(r.body.waitlist, []); assert.equal(r.body.admin, false);
r = await post({ name: "Kennebec River", state: "ME" }); assert.equal(r.status, 401); ok("the list starts empty, anyone can read it, and asking needs a saved name");

const longNotes = "Target brook trout and landlocked salmon; the fly shop in Greenville knows the stretch. ".repeat(5).trim();
const longName = "The Very Long Named Tributary of the Upper West Branch of the Penobscot";
r = await post({ name: "Kennebec River", state: "me", stretch: "Below Wyman Dam", water: "tailwater", gauge: "01049265", notes: longNotes }, a.token, "10.1.0.1");
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.key, "kennebec-me"); assert.equal(r.body.waitlist.length, 1);
assert.deepEqual({ name: r.body.waitlist[0].name, state: r.body.waitlist[0].state, votes: r.body.waitlist[0].votes, mine: r.body.waitlist[0].mine }, { name: "Kennebec River", state: "ME", votes: 1, mine: true });
assert.ok(!("stretch" in r.body.waitlist[0]) && !("notes" in r.body.waitlist[0])); ok("a request goes on the waitlist and answers with its key; the public list leaves out the details");

r = await post({ name: longName, state: "ME", stretch: "x".repeat(150), notes: longNotes }, a.token, "10.1.0.1");
assert.equal(r.status, 200);
assert.equal(psql(`select name from river_requests where key = '${r.body.key}'`), longName);
assert.equal(psql(`select length(notes) from river_requests where key = '${r.body.key}'`), String(longNotes.length));
assert.equal(psql(`select length(stretch) from river_requests where key = '${r.body.key}'`), "150"); ok("river names, stretches and notes are kept whole (not cut at a name's length)");

r = await post({ name: "kennebec", state: "ME" }, b.token, "10.1.0.2");
assert.equal(r.body.key, "kennebec-me"); assert.equal(r.body.waitlist.find((x) => x.key === "kennebec-me").votes, 2);
r = await post({ name: "The Kennebec (lower)", state: "ME" }, b.token, "10.1.0.2");
assert.equal(r.body.waitlist.find((x) => x.key === "kennebec-me").votes, 2);
r = await post({ name: "Kennebec", state: "NH" }, c.token, "10.1.0.3");
assert.ok(r.body.waitlist.some((x) => x.key === "kennebec-nh")); ok("the same river asked twice is one entry with a count; the same person can't count twice; another state is another river");

r = await get(c.token);
assert.equal(r.body.waitlist[0].key, "kennebec-me"); assert.equal(r.body.waitlist[0].mine, false); assert.equal(r.body.waitlist.find((x) => x.key === "kennebec-nh").mine, true);
r = await post({ key: "kennebec-me", me: true }, c.token, "10.1.0.3");
assert.equal(r.body.waitlist[0].votes, 3); assert.equal(r.body.waitlist[0].mine, true);
r = await post({ key: "kennebec-me", me: true }, c.token, "10.1.0.3"); assert.equal(r.body.waitlist[0].votes, 3);
r = await post({ key: "kennebec-me", me: false }, c.token, "10.1.0.3"); assert.equal(r.body.waitlist[0].votes, 2); assert.equal(r.body.waitlist[0].mine, false);
r = await post({ key: "no-such-river", me: true }, c.token, "10.1.0.3"); assert.equal(r.status, 404); ok("'me too' adds this person once, taking it back removes them, and most-wanted comes first");

for (const [bad, why] of [[{ name: "", state: "ME" }, "name"], [{ name: "K", state: "ME" }, "short name"], [{ name: "12345", state: "ME" }, "no letters"], [{ name: "Kennebec" }, "state"], [{ name: "Kennebec", state: "Atlantis" }, "made-up state"], [{ name: "Kennebec", state: "ZZ" }, "made-up code"], [{ name: "Kennebec", state: "ME", gauge: "123" }, "gauge"]]) {
  r = await post(bad, a.token, "10.1.0.1"); assert.equal(r.status, 400, why);
}
r = await post({ name: "Kennebec", state: "Other or outside the US", water: "nonsense" }, b.token, "10.1.0.2"); assert.equal(r.status, 200);
r = await post({ name: "Kennebec River", state: "Maine" }, c.token, "10.1.0.3"); assert.equal(r.body.key, "kennebec-me"); // the form sends the state's name
await post({ key: "kennebec-me", me: false }, c.token, "10.1.0.3");
assert.equal(psql("select water from river_requests where key = 'kennebec-other' limit 1"), ""); ok("a request needs a name and a state; a made-up water type is dropped");

r = await post({ name: "Elk River", state: "TN" }, a.token, "10.1.0.1");
assert.equal(r.status, 409); assert.match(r.body.error, /Elk River is already in the Fly Picker/);
r = await post({ name: "south holston", state: "TN" }, a.token, "10.1.0.1"); assert.equal(r.status, 409);
r = await post({ name: "Elk River", state: "CO" }, a.token, "10.1.0.1"); assert.equal(r.status, 200); assert.ok(r.body.waitlist.some((x) => x.key === "elk-co"));
psql(`insert into river_requests (id, key, name, state, user_id, at) select 'old1', 'tellico-tn', 'Tellico', 'TN', id, 1 from users limit 1`);
r = await get(); assert.ok(!r.body.waitlist.some((x) => x.key === "tellico-tn")); ok("a river already in the Fly Picker is turned away, and drops off the list if it was asked for earlier");

r = await get(a.token, { detail: "1" }); assert.ok(!("stretch" in r.body.waitlist[0]));
r = await get(admin.token, { detail: "1" }); assert.equal(r.body.admin, true);
const k = r.body.waitlist.find((x) => x.key === "kennebec-me");
assert.equal(k.stretch, "Below Wyman Dam"); assert.equal(k.water, "tailwater"); assert.equal(k.gauge, "01049265"); assert.equal(k.notes, longNotes); ok("the details (stretch, water, gauge, notes) are for the site admin only");

const spam = await guest("Spam", "10.1.0.9");
let last;
for (let i = 0; i < 21; i++) last = await post({ name: `Creek Number ${String.fromCharCode(97 + i)}`, state: "ME" }, spam.token, "10.1.0.9");
assert.equal(last.status, 429); ok("a person can't flood the list: 20 requests an hour");
console.log(`rivers: ${n} groups ok`);
process.exit(0);
