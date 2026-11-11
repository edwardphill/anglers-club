// A database connection that goes silent (frozen function, closed pooler socket) must not hang a request.
// Uses a fake driver whose connections can be told to freeze; no database needed.
// Usage: node tests/db-stall.test.mjs
import assert from "node:assert/strict";

globalThis.__nacQueryMs = 150;
process.env.POSTGRES_URL = "postgres://x@localhost/x";
const { q, ensureSchema, resetConnection } = await import("../lib/db.js");

// Each new connection takes the next mode in `plan` ("ok" once the plan runs out).
let plan = [], conns = [], executed = [];
globalThis.__nacSqlFactory = () => {
  const c = { id: conns.length, mode: plan[conns.length] || "ok", ended: false };
  conns.push(c);
  return {
    unsafe(text) {
      executed.push([c.id, text]);
      if (c.mode === "freeze") return new Promise(() => {});
      if (c.mode === "closed") return Promise.reject(Object.assign(new Error("closed"), { code: "CONNECTION_CLOSED" }));
      if (c.mode === "bad") return Promise.reject(Object.assign(new Error("syntax error"), { code: "42601" }));
      return Promise.resolve([{ conn: c.id }]);
    },
    end() { c.ended = true; return Promise.resolve(); },
  };
};
const start = (...modes) => { resetConnection(); plan = modes; conns = []; executed = []; };

// 1. A read on a frozen connection is cut off; the connection is closed; the read succeeds on a new one.
start("freeze", "ok");
let t = Date.now();
assert.deepEqual(await q("select 1"), [{ conn: 1 }]);
assert.ok(Date.now() - t < 1000, "read finished quickly");
assert.equal(conns.length, 2, "a fresh connection was made");
assert.ok(conns[0].ended, "the stalled connection was closed");

// 2. The next statement keeps using the new connection (no churn).
assert.deepEqual(await q("select 2"), [{ conn: 1 }]);
assert.equal(conns.length, 2);

// 3. A write that stalls is not repeated: the caller gets a clean 503.
start("ok", "ok");
await q("select 1");
conns[0].mode = "freeze"; // the live connection goes silent between requests
await assert.rejects(q("insert into t values (1)"), (e) => e.status === 503 && /slow to answer/.test(e.message));
assert.equal(executed.filter(([, s]) => s.startsWith("insert")).length, 1, "the write ran once");
assert.deepEqual(await q("select 3"), [{ conn: 1 }], "and the next statement gets a fresh connection");

// 4. A connection the server already closed: reads retry on a fresh connection.
start("closed", "ok");
assert.deepEqual(await q("select 1"), [{ conn: 1 }]);

// 5. A bad statement is the caller's error: no retry, connection kept.
start("bad", "ok");
await assert.rejects(q("select nope"), (e) => e.code === "42601");
assert.equal(conns.length, 1);
assert.equal(conns[0].ended, false);

// 6. Both tries stalled: a 503, not a hang.
start("freeze", "freeze");
t = Date.now();
await assert.rejects(q("select 1"), (e) => e.status === 503);
assert.ok(Date.now() - t < 1500);

// 7. ensureSchema is not left pending forever by a stalled connection.
start("freeze", "freeze", "ok");
await assert.rejects(ensureSchema(), (e) => e.status === 503);
await ensureSchema();

console.log("db stall handling: ok");
