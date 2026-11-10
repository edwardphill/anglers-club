// Runs every API route against a real Postgres through psql, with a stand-in for Google sign-in.
// Usage: PGTEST="-h /path/to/socket -p 54329 -U user -d dbname" node tests/api.test.mjs
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { usePsql } from "./pg-adapter.mjs";
import { fakeGoogle } from "./google-test.mjs";

const conn = (process.env.PGTEST || "").split(" ").filter(Boolean);
if (!conn.length) {
  console.log("Set PGTEST to psql connection flags to run these tests.");
  process.exit(0);
}
usePsql(conn);
const G = fakeGoogle();
process.env.GOOGLE_CLIENT_ID = G.clientId;
globalThis.__nacJwks = G.jwks;
const psql = (sql) => spawnSync("psql", [...conn, "-qtAc", sql], { encoding: "utf8" }).stdout.trim();

const handlers = {
  health: (await import("../api/health.js")).default,
  auth: (await import("../api/auth.js")).default,
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
const signIn = async (sub, name, extra = {}) => {
  const r = await call("auth", { method: "POST", body: { type: "google", credential: G.mint({ sub, email: `${sub}@example.com`, name, picture: `https://example.com/${sub}.jpg` }), ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const act = (who, club, type, data) => call("action", { method: "POST", token: who.token, body: { club, type, data } });
const state = (who, club) => call("state", { query: { club }, token: who.token });

let n = 0;
const ok = (label) => { n++; console.log("ok", n, label); };

// Fresh schema
spawnSync("psql", [...conn, "-q", "-c", "drop schema public cascade; create schema public;"], { encoding: "utf8" });

let r = await call("health");
assert.equal(r.status, 200); assert.equal(r.body.clubs, 0); ok("health creates tables");

r = await call("auth");
assert.equal(r.body.googleClientId, G.clientId); assert.equal(r.body.user, null); ok("auth config, signed out");

// Bad tokens
r = await call("auth", { method: "POST", body: { type: "google", credential: "not.a.token" } });
assert.equal(r.status, 401);
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
r = await call("auth", { method: "POST", body: { type: "google", credential: G.mint({ sub: "x" }, { key: other }) } });
assert.equal(r.status, 401);
r = await call("auth", { method: "POST", body: { type: "google", credential: G.mint({ sub: "x", aud: "someone-else" }) } });
assert.equal(r.status, 401);
r = await call("auth", { method: "POST", body: { type: "google", credential: G.mint({ sub: "x", exp: Math.floor(Date.now() / 1000) - 600 }) } });
assert.equal(r.status, 401); ok("forged, wrong-audience and expired Google tokens refused");

const ed = await signIn("edward", "Edward Hill");
assert.equal(ed.user.name, "Edward Hill"); assert.equal(ed.user.email, "edward@example.com");
r = await call("auth", { token: ed.token });
assert.equal(r.body.user.id, ed.user.id); ok("Google sign-in starts a session");

r = await call("clubs");
assert.equal(r.status, 401); ok("club list needs sign-in");

const clubBody = { city: "Nashville", state: "TN", name: "", kinds: "both", waters: ["Caney Fork", "Elk River", "Caney Fork"], tz: "America/Chicago", lat: 36.16, lon: -86.78, region: "south" };
r = await call("clubs", { method: "POST", token: ed.token, body: clubBody });
assert.equal(r.status, 200, JSON.stringify(r.body));
const club = r.body.club.id;
assert.equal(club, "nashville-tn"); assert.equal(r.body.club.name, "Nashville Anglers Club");
assert.deepEqual(r.body.club.waters, ["Caney Fork", "Elk River"]);
assert.equal(r.body.club.pw_hash, undefined); ok("create club without a password");

const sam = await signIn("sam", "Sam Ortiz");
r = await call("clubs", { token: sam.token });
assert.equal(r.body.clubs.length, 1); assert.equal(r.body.clubs[0].members, 1); assert.deepEqual(r.body.mine, []); ok("directory for a new user");

r = await state(sam, club);
assert.equal(r.status, 403); ok("trips are members-only");

r = await call("join", { method: "POST", token: sam.token, body: { club } });
assert.equal(r.status, 200); const samId = r.body.memberId;
r = await call("join", { method: "POST", token: sam.token, body: { club } });
assert.equal(r.body.memberId, samId); ok("anyone signed in can join, once");

r = await call("clubs", { token: sam.token });
assert.deepEqual(r.body.mine, [{ club, memberId: samId, role: "member" }]);

const jo = await signIn("jo", "Jo March");
await call("join", { method: "POST", token: jo.token, body: { club } });

r = await act(ed, club, "trip.save", { kind: "fish", water: "Caney Fork", title: "Morning wade", date: "2026-10-27", time: "06:00", meet: "Kroger lot", seats: 1, cond: "Off till 2", notes: "6x tippet" });
assert.equal(r.status, 200, JSON.stringify(r.body)); const tripId = r.body.id; ok("post trip");
r = await act(sam, club, "trip.save", { id: tripId, water: "Elk", date: "2026-10-27" });
assert.equal(r.status, 403); ok("non-host can't edit");
r = await act(sam, club, "rsvp.set", { tripId, status: "in" });
assert.equal(r.status, 200); ok("rsvp in");
r = await act(jo, club, "rsvp.set", { tripId, status: "in" });
assert.equal(r.status, 409); ok("full trip refuses another seat");
r = await act(jo, club, "comment.add", { tripId, text: "I'll drive. It's Jo's truck." });
assert.equal(r.status, 200); const cid = r.body.id;
r = await act(sam, club, "comment.delete", { id: cid });
assert.equal(r.status, 403); ok("can't delete someone else's comment");
r = await act(sam, club, "report.save", { tripId, worked: "Zebra Midge #20", count: "7", cond: "", notes: "" });
assert.equal(r.status, 200); ok("report saved");
r = await act(sam, club, "catch.add", { speciesId: "westslope-cutthroat", caughtOn: "2026-08-14", water: "Middle Fork", note: "Hopper" });
assert.equal(r.status, 200);
r = await act(sam, club, "me.update", { handle: "Sammy" });

r = await state(sam, club);
assert.equal(r.status, 200);
const s = r.body;
assert.equal(s.me.id, samId); assert.equal(s.me.role, "member"); assert.equal(s.me.email, "sam@example.com");
assert.equal(s.members.length, 3);
const samRow = s.members.find((m) => m.id === samId);
assert.equal(samRow.handle, "Sammy"); assert.equal(samRow.picture, "https://example.com/sam.jpg");
assert.equal(s.members.find((m) => m.role === "owner").handle, "Edward");
assert.equal(s.trips.length, 1); assert.equal(s.catches.length, 1); assert.equal(s.reports[0].count, 7);
ok("state has members with Google names and photos");

r = await act(ed, club, "club.password", { password: "x" });
assert.equal(r.status, 400); ok("club passwords are gone");

r = await act(ed, club, "club.update", { ...clubBody, name: "Music City Anglers", waters: ["Harpeth River"] });
assert.equal(r.status, 200);
r = await act(sam, club, "club.update", { ...clubBody, name: "Mine now" });
assert.equal(r.status, 403); ok("only the organizer edits the club");

r = await act(ed, club, "member.remove", { id: (await state(jo, club)).body.me.id });
assert.equal(r.status, 200);
r = await state(jo, club);
assert.equal(r.status, 403);
r = await call("join", { method: "POST", token: jo.token, body: { club } });
assert.equal(r.status, 403);
r = await call("clubs", { token: jo.token });
assert.deepEqual(r.body.removed, [club]); assert.equal(r.body.clubs[0].members, 2); ok("removed member can't see trips or rejoin");

r = await act(ed, club, "member.leave", {});
assert.equal(r.status, 400);
r = await act(sam, club, "member.leave", {});
assert.equal(r.status, 200);
r = await call("join", { method: "POST", token: sam.token, body: { club } });
assert.equal(r.status, 200); ok("members can leave and rejoin; organizer can't leave");

// A membership from the password days links to the Google account on first sign-in.
const legacyToken = crypto.randomBytes(32).toString("base64url");
psql(`insert into members (id, club_id, handle, role, token_hash, at) values ('mold', '${club}', 'Old Timer', 'member', '${crypto.createHash("sha256").update(legacyToken).digest("hex")}', 1)`);
const old = await signIn("oldtimer", "Pat Old", { link: [{ club, token: legacyToken }, { club: "nope", token: "nope" }] });
assert.deepEqual(old.linked, [club]);
r = await state(old, club);
assert.equal(r.status, 200); assert.equal(r.body.me.id, "mold"); ok("older memberships carry over on first Google sign-in");

r = await call("auth", { method: "POST", token: old.token, body: { type: "signout" } });
r = await call("clubs", { token: old.token });
assert.equal(r.status, 401); ok("sign out ends the session");

r = await act(ed, club, "nonsense", {});
assert.equal(r.status, 400); ok("unknown action refused");

// A database set up before Google sign-in (production) picks up the new tables on the next cold start.
spawnSync("psql", [...conn, "-q", "-c", "drop table sessions; drop table users cascade;"], { encoding: "utf8" });
const fresh = await import(`../lib/db.js?again=${Date.now()}`);
await fresh.ensureSchema();
assert.equal(psql("select relrowsecurity from pg_class where oid = to_regclass('public.sessions')"), "t");
assert.equal(psql("select count(*) from information_schema.columns where table_name = 'members' and column_name = 'user_id'"), "1");
ok("older databases get the sign-in tables");

console.log(`\nAll ${n} checks passed.`);
