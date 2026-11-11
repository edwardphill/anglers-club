// Runs every API route against a real Postgres through psql: guest names, optional Google sign-in (stood in for), open reads.
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
const guest = async (name, extra = {}, ip) => {
  const r = await call("auth", { method: "POST", ip, body: { type: "guest", name, ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const act = (who, club, type, data) => call("action", { method: "POST", token: who && who.token, body: { club, type, data } });
const state = (who, club) => call("state", { query: { club }, token: who && who.token });

let n = 0;
const ok = (label) => { n++; console.log("ok", n, label); };

// Fresh schema
spawnSync("psql", [...conn, "-q", "-c", "drop schema public cascade; create schema public;"], { encoding: "utf8" });

let r = await call("health");
assert.equal(r.status, 200); assert.equal(r.body.clubs, 0); ok("health creates tables");

r = await call("auth");
assert.equal(r.body.googleClientId, G.clientId); assert.equal(r.body.user, null); ok("auth config, nobody signed in");

// Google tokens that don't check out
r = await call("auth", { method: "POST", body: { type: "google", credential: "not.a.token" } });
assert.equal(r.status, 401);
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
r = await call("auth", { method: "POST", body: { type: "google", credential: G.mint({ sub: "x" }, { key: other }) } });
assert.equal(r.status, 401);
r = await call("auth", { method: "POST", body: { type: "google", credential: G.mint({ sub: "x", aud: "someone-else" }) } });
assert.equal(r.status, 401);
r = await call("auth", { method: "POST", body: { type: "google", credential: G.mint({ sub: "x", exp: Math.floor(Date.now() / 1000) - 600 }) } });
assert.equal(r.status, 401); ok("forged, wrong-audience and expired Google tokens refused");

// Names
r = await call("auth", { method: "POST", body: { type: "guest", name: "   " } });
assert.equal(r.status, 400);
r = await call("auth", { method: "POST", body: { type: "guest" } });
assert.equal(r.status, 400); ok("a name is required");
const ed = await guest("Edward\u0007  Hill");
assert.equal(ed.user.name, "Edward Hill"); assert.equal(ed.user.email, ""); assert.equal(ed.user.google, false);
r = await call("auth", { token: ed.token });
assert.equal(r.body.user.id, ed.user.id); ok("a name starts a session, control characters stripped");
assert.equal((await guest("x".repeat(80))).user.name.length, 30); ok("names are capped at 30 characters");

// Open reading
r = await call("clubs");
assert.equal(r.status, 200); assert.deepEqual(r.body.clubs, []); assert.deepEqual(r.body.mine, []); ok("anyone can list clubs");
r = await state(null, "nowhere-xx");
assert.equal(r.status, 404); ok("unknown club is a 404");

// Writing needs a name
const clubBody = { city: "Nashville", state: "TN", name: "", kinds: "both", waters: ["Caney Fork", "Elk River", "Caney Fork"], tz: "America/Chicago", lat: 36.16, lon: -86.78, region: "south" };
r = await call("clubs", { method: "POST", body: clubBody });
assert.equal(r.status, 401); ok("starting a club needs a name");
r = await call("clubs", { method: "POST", token: ed.token, body: { ...clubBody, handle: "Hutch" } });
assert.equal(r.status, 200, JSON.stringify(r.body));
const club = r.body.club.id;
assert.equal(club, "nashville-tn"); assert.equal(r.body.club.name, "Nashville Anglers Club");
assert.deepEqual(r.body.club.waters, ["Caney Fork", "Elk River"]);
assert.equal(r.body.club.pw_hash, undefined); ok("create club without a password");

r = await state(null, club);
assert.equal(r.status, 200); assert.equal(r.body.me, null); assert.deepEqual(r.body.catches, []);
assert.equal(r.body.members.length, 1); assert.equal(r.body.members[0].role, "owner");
assert.ok(!JSON.stringify(r.body).includes("@")); ok("anyone can read a club; no emails, no me");
r = await act(null, club, "trip.save", { kind: "fish", water: "Caney Fork", date: "2026-10-27" });
assert.equal(r.status, 401);
assert.equal((await state(null, club)).body.trips.length, 0); ok("no name, no trip");

const sam = await guest("Sam Ortiz");
r = await call("clubs", { token: sam.token });
assert.equal(r.body.clubs.length, 1); assert.equal(r.body.clubs[0].members, 1); assert.deepEqual(r.body.mine, []); ok("directory for someone who hasn't joined");
r = await state(sam, club);
assert.equal(r.status, 200); assert.equal(r.body.me, null); ok("named but not yet in the club: reads only");

r = await act(sam, "nowhere-xx", "rsvp.set", { tripId: "t", status: "in" });
assert.equal(r.status, 404); ok("can't join a club that isn't there");

const jo = await guest("Jo March");
r = await act(ed, club, "trip.save", { kind: "fish", water: "Caney Fork", title: "Morning wade", date: "2026-10-27", time: "06:00", meet: "Kroger lot", seats: 1, cond: "Off till 2", notes: "6x tippet" });
assert.equal(r.status, 200, JSON.stringify(r.body)); const tripId = r.body.id; ok("post trip");
r = await act(sam, club, "trip.save", { id: tripId, water: "Elk", date: "2026-10-27" });
assert.equal(r.status, 403); ok("non-host can't edit");
r = await act(sam, club, "rsvp.set", { tripId, status: "in" });
assert.equal(r.status, 200); ok("first RSVP joins the club and takes the seat");
r = await state(sam, club);
const samId = r.body.me.id;
assert.equal(r.body.me.role, "member"); assert.equal(r.body.members.find((m) => m.id === samId).handle, "Sam Ortiz");
r = await call("clubs", { token: sam.token });
assert.deepEqual(r.body.mine, [{ club, memberId: samId, role: "member" }]); ok("joined under the saved name");
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

r = await call("auth", { method: "POST", token: sam.token, body: { type: "rename", name: "Sammy" } });
assert.equal(r.body.user.name, "Sammy");
r = await call("auth", { method: "POST", token: sam.token, body: { type: "rename", name: "  " } });
assert.equal(r.status, 400);
r = await call("auth", { method: "POST", body: { type: "rename", name: "Nobody" } });
assert.equal(r.status, 401); ok("rename changes the name everywhere; needs a session");

r = await state(sam, club);
assert.equal(r.status, 200);
const s = r.body;
assert.equal(s.me.id, samId); assert.equal(s.members.length, 3);
assert.equal(s.members.find((m) => m.id === samId).handle, "Sammy");
assert.equal(s.members.find((m) => m.role === "owner").handle, "Hutch");
assert.equal(s.trips.length, 1); assert.equal(s.catches.length, 1); assert.equal(s.reports[0].count, 7);
r = await state(jo, club);
assert.equal(r.body.catches.length, 0);
r = await state(null, club);
assert.equal(r.body.catches.length, 0); assert.equal(r.body.trips.length, 1); ok("the life list stays private; the calendar is open");

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
r = await act(jo, club, "comment.add", { tripId, text: "Let me back in" });
assert.equal(r.status, 403);
r = await call("join", { method: "POST", token: jo.token, body: { club } });
assert.equal(r.status, 403);
r = await call("clubs", { token: jo.token });
assert.deepEqual(r.body.removed, [club]); assert.equal(r.body.clubs[0].members, 2);
r = await state(null, club);
assert.equal(r.status, 200); ok("removed names can't post, rejoin or see their own page; the public still reads");

r = await act(ed, club, "member.leave", {});
assert.equal(r.status, 400);
r = await act(sam, club, "member.leave", {});
assert.equal(r.status, 200);
r = await state(sam, club);
assert.equal(r.body.me, null);
r = await act(sam, club, "rsvp.set", { tripId, status: "maybe" });
assert.equal(r.status, 200); ok("members can leave and come back by posting; organizer can't leave");

// A membership from the password days carries over with the first name: silently when the old handle can serve as the name.
const legacyToken = crypto.randomBytes(32).toString("base64url");
psql(`insert into members (id, club_id, handle, role, token_hash, at) values ('mold', '${club}', 'Old Timer', 'member', '${crypto.createHash("sha256").update(legacyToken).digest("hex")}', 1)`);
const old = await guest("", { link: [{ club, token: legacyToken }, { club: "nope", token: "nope" }] });
assert.equal(old.user.name, "Old Timer"); assert.deepEqual(old.linked, [club]);
r = await state(old, club);
assert.equal(r.status, 200); assert.equal(r.body.me.id, "mold"); ok("password-era memberships carry over, with their old handle as the name");
const legacy2 = crypto.randomBytes(32).toString("base64url");
psql(`insert into members (id, club_id, handle, role, token_hash, at) values ('mold2', '${club}', '', 'member', '${crypto.createHash("sha256").update(legacy2).digest("hex")}', 1)`);
r = await call("auth", { method: "POST", body: { type: "guest", name: "", link: [{ club, token: legacy2 }] } });
assert.equal(r.status, 400);
const typed = await guest("Pat", { link: [{ club, token: legacy2 }] });
assert.deepEqual(typed.linked, [club]); ok("an old device with no handle is asked for a name, and keeps its club");

// Google is optional: signing in from a named device keeps the name and the clubs.
const g1 = await call("auth", { method: "POST", token: sam.token, body: { type: "google", credential: G.mint({ sub: "sam-g", email: "sam@example.com", name: "Samuel Ortiz", picture: "https://example.com/s.jpg" }) } });
assert.equal(g1.status, 200, JSON.stringify(g1.body));
assert.equal(g1.body.user.id, sam.user.id); assert.equal(g1.body.user.name, "Sammy"); assert.equal(g1.body.user.google, true);
r = await call("auth", { token: sam.token });
assert.equal(r.body.user.id, sam.user.id); ok("a guest who adds Google keeps their name and id");
const samNow = (await state(sam, club)).body.me.id;
r = await state(g1.body, club);
assert.equal(r.body.me.id, samNow);
// Second device: Google alone finds the same person; a guest from there is folded in.
const phone = await guest("Sam on phone");
await act(phone, club, "comment.add", { tripId, text: "From the phone" });
const g2 = await call("auth", { method: "POST", token: phone.token, body: { type: "google", credential: G.mint({ sub: "sam-g", email: "sam@example.com", name: "Samuel Ortiz" }) } });
assert.equal(g2.body.user.id, sam.user.id);
r = await state(g2.body, club);
assert.equal(r.body.me.id, samNow); ok("Google on a second device finds the same person");
const plain = await call("auth", { method: "POST", body: { type: "google", credential: G.mint({ sub: "kim-g", email: "kim@example.com", name: "Kim Lee" }) } });
assert.equal(plain.body.user.name, "Kim Lee");
const noName = await call("auth", { method: "POST", body: { type: "google", credential: G.mint({ sub: "zed-g", email: "zed@example.com", name: "" }) } });
assert.equal(noName.body.user.name, "zed"); ok("Google alone works too; a nameless account falls back to the email's first part");

r = await call("auth", { method: "POST", token: old.token, body: { type: "signout" } });
r = await call("auth", { token: old.token });
assert.equal(r.body.user, null);
r = await act(old, club, "rsvp.set", { tripId, status: "maybe" });
assert.equal(r.status, 401); ok("sign out ends the session");

// Rate limit on new names from one address
let blocked = 0;
for (let i = 0; i < 45; i++) {
  const x = await call("auth", { method: "POST", ip: "10.9.9.9", body: { type: "guest", name: "Bot " + i } });
  if (x.status === 429) blocked++;
}
assert.ok(blocked >= 4); ok("one address can't mint names without limit");

r = await act(ed, club, "nonsense", {});
assert.equal(r.status, 400); ok("unknown action refused");

// A database set up before guests (production) is migrated on the next cold start.
spawnSync("psql", [...conn, "-q", "-c", "update users set google_sub = id where google_sub is null; alter table users alter column google_sub set not null;"], { encoding: "utf8" });
assert.equal(psql("select is_nullable from information_schema.columns where table_name = 'users' and column_name = 'google_sub'"), "NO");
const migrated = await import(`../lib/db.js?migrate=${Date.now()}`);
await migrated.ensureSchema();
assert.equal(psql("select is_nullable from information_schema.columns where table_name = 'users' and column_name = 'google_sub'"), "YES"); ok("databases from the Google-only days allow guests");

// A database from the password days picks up the new tables on the next cold start.
spawnSync("psql", [...conn, "-q", "-c", "drop table sessions; drop table users cascade;"], { encoding: "utf8" });
const fresh = await import(`../lib/db.js?again=${Date.now()}`);
await fresh.ensureSchema();
assert.equal(psql("select relrowsecurity from pg_class where oid = to_regclass('public.sessions')"), "t");
assert.equal(psql("select count(*) from information_schema.columns where table_name = 'members' and column_name = 'user_id'"), "1");
ok("older databases get the sign-in tables");

console.log(`\nAll ${n} checks passed.`);
