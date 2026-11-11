// The forum end to end against a real Postgres through psql: open reading, posting with a saved name, the rules and rate
// limits, spam traps, reports that hide a post, the admin's tools, and the crawlable pages.
// Usage: PGTEST="-h /path/to/socket -p 54329 -U user -d dbname" node tests/forum.test.mjs
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

const forum = (await import("../api/forum.js")).default;
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
    handler({ method, query, body, headers: { authorization: token ? `Bearer ${token}` : "", "x-forwarded-for": ip, host: "test.example" } }, res);
  });
}
const F = (body, token, ip) => call(forum, { method: "POST", body, token, ip });
const GET = (op, token) => call(forum, { query: { op }, token });
const PAGE = (kind, extra = {}) => call(page, { query: { kind, ...extra } });
const guest = async (name, ip) => (await call(auth, { method: "POST", ip, body: { type: "guest", name } })).body;
const google = async (sub, name, email) => (await call(auth, { method: "POST", body: { type: "google", credential: G.mint({ sub, email, name }) } })).body;
const unthrottle = () => psql("delete from attempts where key like 'forum%'");
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };
const keyOf = (url) => url.split("/forum/t/")[1].split(/[?#]/)[0];
const ldOf = (html) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);

spawnSync("psql", [...conn, "-q", "-c", "drop schema public cascade; create schema public;"], { encoding: "utf8" });

// ---- reading is open ----
let r = await PAGE("forum");
assert.equal(r.status, 200); assert.match(r.body, /<h1>Forum<\/h1>/); assert.match(r.body, /No threads yet/);
for (const c of ["General fly fishing", "Rivers and water reports", "Flies and hatches", "Gear", "Hunting", "Clubs, trips and meetups", "Fly shops and guides"]) assert.ok(r.body.includes(c), c);
assert.match(r.body, /rel="canonical" href="https:\/\/test\.example\/forum"/); assert.match(r.body, /index,follow/);
r = await PAGE("forumcat", { key: "rivers" }); assert.equal(r.status, 200); assert.match(r.body, /Rivers and water reports/);
r = await PAGE("forumcat", { key: "nope" }); assert.equal(r.status, 404);
r = await PAGE("forumthread", { key: "x-ftnothing" }); assert.equal(r.status, 404);
ok("the forum, its categories and a missing thread read without any sign-in");

// ---- posting needs a name ----
const riley = await guest("Riley", "10.1.1.1");
const pat = await guest("Pat", "10.1.1.2");
const lee = await guest("Lee", "10.1.1.3");
const sam = await guest("Sam", "10.1.1.4");
const admin = await google("adm", "Edward", "admin@example.com");
r = await F({ op: "thread", category: "rivers", title: "South Holston flows this week", body: "Anyone fished the tailwater since the release schedule changed?" });
assert.equal(r.status, 401); ok("posting without a name is refused");

// ---- what a thread may hold ----
const T = (over) => F({ op: "thread", category: "rivers", title: "South Holston flows this week", body: "Anyone fished the tailwater since the release schedule changed?", ...over }, riley.token, "10.1.1.1");
for (const [label, over, re] of [
  ["category", { category: "politics" }, /category/i], ["short title", { title: "Hi" }, /title/i], ["short body", { body: "ok" }, /more/i],
  ["link in the title", { title: "Check www.spam.example now" }, /links out of the title/i],
  ["four links", { body: "a http://a.example b http://b.example c http://c.example d http://d.example" }, /3 links/],
]) { r = await T(over); assert.equal(r.status, 400, label + " " + JSON.stringify(r.body)); assert.match(r.body.error, re, label); }
ok("a bad category, a short title or post, a link in the title and more than three links are refused");

// ---- starting a thread; the page; escaping ----
const nasty = `Use <script>alert(1)</script> & "quotes" www.example.com/a?b=1&c=2 and https://flyai.example/x)`;
r = await T({ body: "Line one.\n\nLine two with <b>bold</b>.\n" + nasty });
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.url, /^\/forum\/t\/south-holston-flows-this-week-ft[0-9a-f]{12}$/);
const url1 = r.body.url, key1 = keyOf(url1);
r = await PAGE("forumthread", { key: key1 }); assert.equal(r.status, 200);
const th = r.body;
assert.match(th, /<h1>South Holston flows this week<\/h1>/); assert.match(th, /Riley/);
assert.ok(!th.includes("<script>alert(1)</script>") && !th.includes("<b>bold</b>"), "user text is escaped");
assert.match(th, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.match(th, /<p>Line one\.<\/p>/);
assert.match(th, /<a href="https:\/\/www\.example\.com\/a\?b=1&amp;c=2" rel="nofollow ugc noopener" target="_blank">/);
assert.match(th, /<a href="https:\/\/flyai\.example\/x" rel="nofollow ugc noopener"/);
assert.match(r.headers["cache-control"], /s-maxage=10$/);
const data = ldOf(th); assert.equal(data["@type"], "DiscussionForumPosting"); assert.equal(data.author.name, "Riley"); assert.equal(data.headline, "South Holston flows this week");
assert.equal(data.url, "https://test.example" + url1); assert.equal(data.interactionStatistic.userInteractionCount, 0);
ok("a thread is posted and its page escapes the text, links people's URLs safely and carries DiscussionForumPosting data");

// ---- the address ----
r = await PAGE("forumthread", { key: "wrong-words-" + key1.split("-").pop() });
assert.equal(r.status, 301); assert.equal(r.headers.location, url1);
r = await PAGE("forumthread", { key: "x-ft'; drop table users; --" }); assert.equal(r.status, 404);
assert.equal(psql("select count(*) from users"), "5"); ok("a thread's address is canonical and a hostile one is just not found");

// ---- rate limits and the duplicate check ----
r = await T({ title: "A second thread right away", body: "A different post body entirely, about hatches." });
assert.equal(r.status, 429); assert.match(r.body.error, /minute/);
unthrottle();
r = await T({ body: "Line one.\n\nLine two with <b>bold</b>.\n" + nasty }); assert.equal(r.status, 409); unthrottle();
const gear = (i) => F({ op: "thread", category: "gear", title: "Rod question number " + i, body: "Which four weight is worth buying? " + i }, pat.token, "10.2.2.2");
for (let i = 0; i < 5; i++) { r = await gear(i); assert.equal(r.status, 200, "thread " + i + " " + JSON.stringify(r.body)); psql("delete from attempts where key like 'forum-thread-gap%'"); }
r = await gear(5); assert.equal(r.status, 429); assert.match(r.body.error, /day's limit/);
ok("threads are limited per minute and per day, and the same post twice is refused");
psql("delete from forum_threads where author_name = 'Pat'"); psql("delete from attempts");

// ---- replies ----
const rep = (token, body, ip) => F({ op: "reply", thread: key1.split("-").pop(), body }, token, ip);
r = await rep(pat.token, "x", "10.1.1.2"); assert.equal(r.status, 400);
r = await rep(pat.token, "Fished it Tuesday: two generators, wade fishing was tough, float was good.", "10.1.1.2");
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.url, /^\/forum\/t\/south-holston-flows-this-week-ft[0-9a-f]{12}#fp[0-9a-f]{12}$/);
const post1 = r.body.url.split("#")[1];
r = await rep(pat.token, "Fished it Tuesday: two generators, wade fishing was tough, float was good.", "10.1.1.2"); assert.equal(r.status, 429);
unthrottle();
r = await rep(pat.token, "Fished it Tuesday: two generators, wade fishing was tough, float was good.", "10.1.1.2"); assert.equal(r.status, 409); unthrottle();
r = await rep(lee.token, "Thanks Pat! Which fly worked best on the float?", "10.1.1.3"); assert.equal(r.status, 200); unthrottle();
r = await PAGE("forumthread", { key: key1 }); const t2 = r.body;
assert.match(t2, /2 replies/); assert.ok(t2.indexOf("Pat") < t2.indexOf("Thanks Pat")); assert.ok(t2.includes(`id="${post1}"`));
const d2 = ldOf(t2); assert.equal(d2.interactionStatistic.userInteractionCount, 2); assert.equal(d2.comment.length, 2); assert.equal(d2.comment[0].author.name, "Pat");
r = await PAGE("forum"); assert.match(r.body, /South Holston flows this week/); assert.match(r.body, /2 replies/);
r = await rep(sam.token, "Hello", "10.1.1.4"); assert.equal(r.status, 200); unthrottle(); psql("delete from forum_posts where author_name = 'Sam'");
r = await call(forum, { method: "POST", body: { op: "reply", thread: "ftdoesnotexist", body: "Hello there" }, token: sam.token }); assert.equal(r.status, 404);
ok("replies post, count, show in order and appear in the page data; a missing thread is not found");

// ---- spam traps ----
const before = psql("select count(*) from forum_threads");
r = await F({ op: "thread", category: "gear", title: "Cheap watches online", body: "Visit our shop for the best deals today.", website: "http://spam.example" }, sam.token, "10.1.1.4");
assert.equal(r.status, 200); assert.equal(psql("select count(*) from forum_threads"), before); unthrottle();
ok("a bot that fills the hidden field gets a quiet success and nothing is posted");

// ---- reports hide a post ----
const rid = key1.split("-").pop();
r = await F({ op: "report", kind: "thread", id: rid }, riley.token); assert.equal(r.status, 400); assert.match(r.body.error, /own/);
r = await F({ op: "report", kind: "thread", id: rid }, pat.token); assert.equal(r.status, 200); assert.deepEqual([r.body.reports, r.body.hidden], [1, false]);
r = await F({ op: "report", kind: "thread", id: rid }, pat.token); assert.equal(r.body.reports, 1);
r = await F({ op: "report", kind: "thread", id: rid }, lee.token); assert.deepEqual([r.body.reports, r.body.hidden], [2, false]);
r = await F({ op: "report", kind: "thread", id: rid }, sam.token); assert.deepEqual([r.body.reports, r.body.hidden], [3, true]);
assert.equal((await PAGE("forumthread", { key: key1 })).status, 404);
assert.ok(!(await PAGE("forum")).body.includes("South Holston flows"));
assert.ok(!(await PAGE("sitemap")).body.includes(key1)); assert.ok(!(await PAGE("llms")).body.includes(key1));
r = await F({ op: "report", kind: "thread", id: "nothere" }, sam.token); assert.equal(r.status, 404);
r = await F({ op: "report", kind: "user", id: rid }, sam.token); assert.equal(r.status, 400);
ok("three different people reporting a thread hides it everywhere; reporting twice counts once; your own post can't be reported");

// ---- the admin ----
r = await F({ op: "mod", kind: "thread", id: rid, action: "unhide" }, riley.token); assert.equal(r.status, 403);
r = await GET("reported", riley.token); assert.equal(r.status, 403);
r = await GET("reported", admin.token); assert.equal(r.status, 200); assert.equal(r.body.threads.length, 1); assert.equal(r.body.threads[0].hidden, true); assert.equal(r.body.threads[0].reports, 3);
r = await F({ op: "mod", kind: "thread", id: rid, action: "unhide" }, admin.token); assert.equal(r.status, 200);
assert.equal((await PAGE("forumthread", { key: key1 })).status, 200); assert.equal(psql("select count(*) from forum_reports"), "0");
r = await F({ op: "mod", kind: "thread", id: rid, action: "pin" }, admin.token); assert.equal(r.status, 200);
unthrottle();
r = await F({ op: "thread", category: "rivers", title: "A newer rivers thread", body: "Newer than the pinned one, but it should sit below it." }, lee.token, "10.1.1.3");
assert.equal(r.status, 200); const key2 = keyOf(r.body.url);
let cat = (await PAGE("forumcat", { key: "rivers" })).body;
assert.ok(cat.indexOf("South Holston flows") < cat.indexOf("A newer rivers thread")); assert.match(cat, /Pinned/);
r = await F({ op: "mod", kind: "thread", id: rid, action: "lock" }, admin.token); assert.equal(r.status, 200); unthrottle();
r = await rep(lee.token, "Can I still reply?", "10.1.1.3"); assert.equal(r.status, 403); assert.match(r.body.error, /locked/);
assert.match((await PAGE("forumthread", { key: key1 })).body, /This thread is locked/);
r = await F({ op: "mod", kind: "thread", id: rid, action: "unlock" }, admin.token); r = await F({ op: "mod", kind: "thread", id: rid, action: "unpin" }, admin.token);
r = await F({ op: "mod", kind: "post", id: post1, action: "hide" }, admin.token); assert.equal(r.status, 200);
assert.match((await PAGE("forumthread", { key: key1 })).body, /1 reply/);
r = await F({ op: "mod", kind: "post", id: post1, action: "delete" }, admin.token); assert.equal(psql(`select count(*) from forum_posts where id = '${post1}'`), "0");
r = await F({ op: "mod", kind: "thread", id: rid, action: "explode" }, admin.token); assert.equal(r.status, 400);
r = await F({ op: "mod", kind: "thread", id: key2.split("-").pop(), action: "delete" }, admin.token); assert.equal((await PAGE("forumthread", { key: key2 })).status, 404);
// a guest who calls themselves Admin is still not one
const fake = await guest("Admin", "10.9.9.9"); r = await F({ op: "mod", kind: "thread", id: rid, action: "hide" }, fake.token); assert.equal(r.status, 403);
ok("the admin can hide, restore, pin, lock and delete; nobody else can, whatever they call themselves");

// ---- removing your own ----
r = await F({ op: "remove", kind: "thread", id: rid }, pat.token); assert.equal(r.status, 403);
r = await GET("me", riley.token); assert.equal(r.body.admin, false); assert.ok(r.body.own.threads.includes(rid));
r = await GET("me", admin.token); assert.equal(r.body.admin, true);
r = await GET("me"); assert.deepEqual(r.body, { user: null, admin: false, own: { threads: [], posts: [] } });
r = await F({ op: "remove", kind: "thread", id: rid }, riley.token); assert.equal(r.status, 200);
assert.equal((await PAGE("forumthread", { key: key1 })).status, 404); assert.equal(psql(`select count(*) from forum_threads where id = '${rid}'`), "1");
ok("people can remove their own posts (hidden, not erased) and only their own");

// ---- pages of threads, the sitemap and llms.txt ----
psql(`insert into forum_threads (id, category, title, body, author_id, author_name, at, last_at) select 'ftbulk' || lpad(g::text, 6, '0'), 'gear', 'Bulk gear thread ' || g, 'A thread of filler text number ' || g, (select id from users limit 1), 'Bulk', 1000000 + g, 1000000 + g from generate_series(1, 27) g`);
r = await PAGE("forumcat", { key: "gear" }); assert.equal(r.body.match(/class="fx-row"/g).length, 25); assert.match(r.body, /Page 1 of 2/); assert.match(r.body, /href="\/forum\/c\/gear\?page=2">Older/);
assert.match(r.body, /Bulk gear thread 27/); assert.ok(!r.body.includes("Bulk gear thread 1<")); assert.match(r.body, /index,follow/);
r = await PAGE("forumcat", { key: "gear", page: "2" }); assert.equal(r.body.match(/class="fx-row"/g).length, 2); assert.match(r.body, /noindex,follow/); assert.match(r.body, /Newer/);
r = await PAGE("forumcat", { key: "gear", page: "-3" }); assert.equal(r.status, 200); r = await PAGE("forumcat", { key: "gear", page: "zzz" }); assert.equal(r.status, 200);
const sm = (await PAGE("sitemap")).body; assert.match(sm, /\/forum<\/loc>/); assert.match(sm, /\/forum\/c\/hunting<\/loc>/); assert.match(sm, /\/forum\/t\/bulk-gear-thread-27-ftbulk000027<\/loc><lastmod>1970-01-01<\/lastmod>/);
const lm = (await PAGE("llms")).body; assert.match(lm, /## Forum/); assert.match(lm, /\[Bulk gear thread 27\]\(https:\/\/test\.example\/forum\/t\/bulk-gear-thread-27-ftbulk000027\)/);
ok("category pages paginate (later pages are noindex), and the sitemap and llms.txt list the forum and its threads");

// ---- the home page's footer and the database ----
assert.match((await PAGE("forum")).body, /<a href="\/forum">Forum<\/a>/);
assert.equal(psql("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'forum_%' and c.relkind = 'r' and c.relrowsecurity"), "3");
ok("every forum table has row-level security");

// ---- an address can't post forever ----
unthrottle(); psql("delete from attempts");
let last;
for (let i = 0; i < 12; i++) { last = await F({ op: "thread", category: "general", title: "Spam thread number " + i, body: "Different text every time, number " + i + "." }, (await guest("Bot" + i, "10.7." + i + ".1")).token, "10.5.5.5"); psql("delete from attempts where key like 'forum-thread%' or key like 'forum-reply%'"); }
assert.equal(last.status, 429); assert.match(last.body.error, /connection/);
ok("one address can only start so many threads a day, however many names it makes");
console.log("all forum checks passed");
