// A stand-in for Vercel: serves public/ and runs api/*.js against a local Postgres.
// Usage: PGTEST="-h /socket -p 54329 -U user -d db" PORT=3999 node tests/dev-server.mjs
import http from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { usePsql } from "./pg-adapter.mjs";
import { fakeGoogle } from "./google-test.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
usePsql((process.env.PGTEST || "").split(" ").filter(Boolean));
// TEST_GOOGLE=1 swaps Google for a local test key; /test/google-token mints sign-in tokens for it.
const G = process.env.TEST_GOOGLE ? fakeGoogle() : null;
if (G) { process.env.GOOGLE_CLIENT_ID = G.clientId; globalThis.__nacJwks = G.jwks; }
const routes = {};
for (const name of readdirSync(join(root, "api")).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3))) {
  routes[name] = (await import(`../api/${name}.js`)).default;
}

// vercel.json's rewrites, applied the way Vercel does ("/rivers/:key" -> "/api/page?kind=river&key=:key"), so the clean
// URLs are tested through the same file that ships.
const rewrites = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")).rewrites.map((r) => ({
  re: new RegExp("^" + r.source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:([a-z]+)/g, "(?<$1>[^/]+)") + "/?$"), dest: r.destination,
}));
function rewrite(url) {
  for (const r of rewrites) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const d = new URL(r.dest.replace(/:([a-z]+)/g, (_, n) => encodeURIComponent(m.groups[n])), "http://localhost");
    for (const [k, v] of url.searchParams) if (!d.searchParams.has(k)) d.searchParams.set(k, v);
    return d;
  }
  return url;
}

http.createServer(async (req, res) => {
  const url = rewrite(new URL(req.url, "http://localhost"));
  if (G && url.pathname === "/test/google-token") {
    const p = Object.fromEntries(url.searchParams);
    res.setHeader("Content-Type", "text/plain");
    return res.end(G.mint({ sub: p.sub, name: p.name, email: p.email || `${p.sub}@example.com`, picture: p.picture || "" }));
  }
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
    // Vercel's response helpers on top of Node's own response, so streaming routes can write().
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    return routes[m[1]](vreq, res);
  }
  const file = join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
  const type = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json" }[file.split(".").pop()];
  res.setHeader("Content-Type", type || "application/octet-stream");
  res.end(readFileSync(file));
}).listen(Number(process.env.PORT || 3999), () => console.log("dev server ready"));
