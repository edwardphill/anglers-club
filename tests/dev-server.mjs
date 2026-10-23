// A stand-in for Vercel: serves public/ and runs api/*.js against a local Postgres.
// Usage: PGTEST="-h /socket -p 54329 -U user -d db" PORT=3999 node tests/dev-server.mjs
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { usePsql } from "./pg-adapter.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
usePsql((process.env.PGTEST || "").split(" ").filter(Boolean));
const routes = {};
for (const name of ["health", "clubs", "join", "state", "action"]) {
  routes[name] = (await import(`../api/${name}.js`)).default;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const m = /^\/api\/([a-z]+)$/.exec(url.pathname);
  if (m && routes[m[1]]) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const vreq = {
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
      get body() { return raw ? JSON.parse(raw) : null; },
    };
    const vres = {
      setHeader: (k, v) => res.setHeader(k, v),
      status(c) { res.statusCode = c; return this; },
      json(o) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); },
    };
    return routes[m[1]](vreq, vres);
  }
  const file = join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("Content-Type", file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
  res.end(readFileSync(file));
}).listen(Number(process.env.PORT || 3999), () => console.log("dev server ready"));
