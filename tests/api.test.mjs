// Runs every API route against a real Postgres through psql.
// Usage: PGTEST="-h /path/to/socket -p 54329 -U user -d dbname" node tests/api.test.mjs
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { usePsql } from "./pg-adapter.mjs";

const conn = (process.env.PGTEST || "").split(" ").filter(Boolean);
if (!conn.length) {
  console.log("Set PGTEST to psql connection flags to run these tests.");
  process.exit(0);
}
usePsql(conn);

const handlers = {
  health: (await import("../api/health.js")).default,
  clubs: (await import("../api/clubs.js")).default,
  join: (await import("../api/join.js")).default,
  state: (await import("../api/state.js")).default,
  action: (await import("../api/action.js")).default,
};

function call(name, { method = "GET", query = {}, body, token, ip = "10.0.0.1" } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); },
    };
    handlers[name]({ method, query, body, headers: { authorization: token ? `Bearer ${token}` : "", "x-forwarded-for": ip } }, res);
  });
}
const act = (session, type, data) =>
  call("action", { method: "POST", token: session.token, body: { club: session.clubId, type, data } });
const state = (session) => call("state", { query: { club: session.clubId }, token: session.token });

let n = 0;
const ok = (label) => { n++; console.log("ok", n, label); };

// Fresh schema
spawnSync("psql", [...conn, "-q", "-c", "drop schema public cascade; create schema public;"], { encoding: "utf8" });

let r = await call("health");
assert.equal(r.status, 200); assert.equal(r.body.clubs, 0); ok("health creates tables");

const clubBody = { city: "Nashville", state: "TN", name: "", kinds: "both", waters: ["Caney Fork", "Elk River", "Caney Fork"], tz: "America/Chicago", lat: 36.16, lon: -86.78, region: "south", password: "Riffle", handle: "Edward" };
r = await call("clubs", { method: "POST", body: { ...clubBody, password: "no" } });
assert.equal(r.status, 400); ok("short password refused");

r = await call("clubs", { method: "POST", body: clubBody });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.club.id, "nashville-tn");
assert.equal(r.body.club.name, "Nashville Anglers Club");
assert.deepEqual(r.body.club.waters, ["Caney Fork", "Elk River"]);
assert.equal(r.body.club.hasPassword, true);
assert.equal(r.body.club.pw_hash, undefined);
const owner = r.body.session;
assert.equal(r.body.club.ownerId, owner.memberId); ok("create club");

r = await call("clubs", { method: "POST", body: clubBody });
assert.match(r.body.club.id, /^nashville-tn-[0-9a-f]{4}$/); ok("second club in same city gets its own id");

r = await call("clubs");
assert.equal(r.body.clubs.length, 2); assert.equal(r.body.clubs[0].members, 1); ok("directory lists clubs");

r = await call("join", { method: "POST", body: { club: "nashville-tn", password: "wrong", handle: "Sam" } });
assert.equal(r.status, 403); ok("wrong password refused");

r = await call("join", { method: "POST", body: { club: "nashville-tn", password: "  RIFFLE ", handle: "Sam" } });
assert.equal(r.status, 200); const sam = r.body.session; ok("password is not case-sensitive");

r = await call("join", { method: "POST", body: { club: "nashville-tn", password: "riffle", handle: "Jo" } });
const jo = r.body.session;

r = await state({ ...sam, token: "bogus" });
assert.equal(r.status, 401); ok("bad token refused");
r = await call("state", { query: { club: "nashville-tn-xxxx" }, token: sam.token });
assert.equal(r.status, 401); ok("token only works for its own club");

r = await act(owner, "trip.save", { kind: "fish", water: "Caney Fork", title: "Morning wade", date: "2026-10-27", time: "06:00", meet: "Kroger lot", seats: 1, cond: "Off till 2", notes: "6x tippet" });
assert.equal(r.status, 200, JSON.stringify(r.body)); const tripId = r.body.id; ok("post trip");

r = await act(sam, "trip.save", { id: tripId, water: "Elk", date: "2026-10-27" });
assert.equal(r.status, 403); ok("non-host can't edit");

r = await act(sam, "rsvp.set", { tripId, status: "in" });
assert.equal(r.status, 200, JSON.stringify(r.body)); ok("rsvp in");
r = await act(jo, "rsvp.set", { tripId, status: "in" });
assert.equal(r.status, 409); ok("full trip refuses another seat");
r = await act(jo, "rsvp.set", { tripId, status: "maybe" });
assert.equal(r.status, 200); ok("maybe allowed when full");
r = await act(sam, "rsvp.set", { tripId, status: "in" });
assert.equal(r.status, 200); ok("re-saving your own seat is fine");
r = await act(owner, "rsvp.set", { tripId, status: "in" });
assert.equal(r.status, 400); ok("host can't rsvp own trip");

r = await act(jo, "comment.add", { tripId, text: "I'll drive. It's Jo's truck." });
assert.equal(r.status, 200); const cid = r.body.id; ok("comment with quotes");
r = await act(sam, "comment.delete", { id: cid });
assert.equal(r.status, 403); ok("can't delete someone else's comment");

r = await act(sam, "report.save", { tripId, worked: "Zebra Midge #20", count: "7", cond: "", notes: "" });
assert.equal(r.status, 200); ok("report saved");
r = await act(sam, "report.save", { tripId, worked: "", count: "", cond: "", notes: "" });
assert.equal(r.status, 400); ok("empty report refused");

r = await act(sam, "me.update", { handle: "Sammy" });
assert.equal(r.status, 200);

r = await state(sam);
assert.equal(r.status, 200);
const s = r.body;
assert.equal(s.me.id, sam.memberId); assert.equal(s.me.role, "member");
assert.equal(s.members.length, 3); assert.ok(s.members.find((m) => m.handle === "Sammy"));
assert.equal(s.trips.length, 1); assert.equal(s.trips[0].seats, 1); assert.equal(s.trips[0].hostId, owner.memberId);
assert.equal(typeof s.trips[0].at, "number"); assert.equal(s.trips[0].canceled, false);
assert.equal(s.rsvps.length, 2); assert.equal(s.rsvps.find((x) => x.uid === jo.memberId).status, "maybe");
assert.equal(s.comments[0].text, "I'll drive. It's Jo's truck.");
assert.equal(s.reports[0].count, 7);
assert.equal(s.club.ownerId, owner.memberId); ok("state has everything in the right shapes");

r = await act(sam, "club.password", { password: "new one" });
assert.equal(r.status, 403); ok("only organizer changes password");
r = await act(owner, "club.password", { password: "Hatch" });
assert.equal(r.status, 200);
r = await call("join", { method: "POST", body: { club: "nashville-tn", password: "riffle" } });
assert.equal(r.status, 403);
r = await call("join", { method: "POST", body: { club: "nashville-tn", password: "hatch", handle: "New" } });
assert.equal(r.status, 200); ok("new password works, old one doesn't");

r = await act(owner, "club.update", { ...clubBody, name: "Music City Anglers", waters: ["Harpeth River"] });
assert.equal(r.status, 200);
r = await state(owner);
assert.equal(r.body.club.name, "Music City Anglers"); assert.deepEqual(r.body.club.waters, ["Harpeth River"]); ok("club details update");

r = await act(owner, "trip.cancel", { id: tripId, canceled: true });
assert.equal(r.status, 200);
r = await act(jo, "rsvp.set", { tripId, status: "maybe" });
assert.equal(r.status, 400); ok("canceled trip takes no RSVPs");

r = await act(owner, "member.remove", { id: jo.memberId });
assert.equal(r.status, 200);
r = await state(jo);
assert.equal(r.status, 401); ok("removed member is signed out");

r = await act(owner, "trip.delete", { id: tripId });
assert.equal(r.status, 200);
r = await state(sam);
assert.equal(r.body.trips.length, 0); assert.equal(r.body.rsvps.length, 0); assert.equal(r.body.comments.length, 0); assert.equal(r.body.reports.length, 0);
ok("deleting a trip removes its RSVPs, thread and reports");

r = await act(owner, "member.leave", {});
assert.equal(r.status, 400);
r = await act(sam, "member.leave", {});
assert.equal(r.status, 200); ok("members can leave, organizer can't");

for (let i = 0; i < 9; i++) r = await call("join", { method: "POST", ip: "10.9.9.9", body: { club: "nashville-tn", password: "nope" } });
assert.equal(r.status, 429); ok("password guessing is rate limited");

r = await act(owner, "nonsense", {});
assert.equal(r.status, 400); ok("unknown action refused");

console.log(`\nAll ${n} checks passed.`);
