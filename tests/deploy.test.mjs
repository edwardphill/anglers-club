// Vercel packs each function with only the files it can trace, and a JSON file read through createRequire or readFileSync
// is not traced. This checks that every data file a function (or anything it imports) reads is listed in vercel.json's
// includeFiles for that function, so a missing file shows up here and not as a crashed function after a deploy.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")).functions || {};
const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");

function trace(entry) {
  const seen = new Set(), data = new Map(), queue = [entry];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const p = resolve(dirname(f), m[1]);
      if (/\.json$/.test(p)) data.set(relative(root, p), relative(root, f)); else queue.push(p);
    }
    for (const m of src.matchAll(/["'](\.\.?\/data\/[\w.-]+)["']/g)) data.set(relative(root, resolve(dirname(f), m[1])), relative(root, f));
  }
  return data;
}

let n = 0;
for (const f of readdirSync(join(root, "api")).filter((x) => x.endsWith(".js"))) {
  const need = trace(join(root, "api", f));
  const pats = [].concat((cfg["api/" + f] || {}).includeFiles || []).map(globRe);
  for (const [file, by] of need) assert.ok(pats.some((re) => re.test(file)), `api/${f} reads ${file} (through ${by}) but vercel.json doesn't include it for that function`);
  n++;
}
console.log(`ok deploy: ${n} functions have the data files they read`);
