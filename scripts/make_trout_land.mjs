// Generates src/trout-land.js: the Trout Map's coastlines, country borders and species range shapes, already
// projected (Natural Earth 1, cropped to 20°S–84°N, where every native trout range sits) as SVG path data.
// The page places species markers with the same projection constants, so it needs no map library.
//
// Run when the ranges in scripts/trout_ranges.json change, then commit the output:
//   node scripts/make_trout_land.mjs path/to/natural-earth-vector/geojson [path/to/node_modules]
// Input: Natural Earth 1:10m admin-0 countries and admin-1 states/provinces as GeoJSON (public domain), from
// github.com/nvkelso/natural-earth-vector. Needs d3-geo.
//
// Land and ranges both come from the same 10m boundaries, so a range's coast is the land's coast. Each range is its
// units' outlines dissolved (an edge two units share cancels), simplified in map units, and written as one path.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const [dir, modules = "/opt/npm-tools/node_modules"] = process.argv.slice(2);
if (!dir) { console.error("usage: node scripts/make_trout_land.mjs natural-earth-vector/geojson [node_modules]"); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const d3 = await import(pathToFileURL(join(modules, "d3-geo/src/index.js")).href);
const load = (f) => JSON.parse(readFileSync(join(dir, f), "utf8")).features;
const countries = load("ne_10m_admin_0_countries.geojson"), states = load("ne_10m_admin_1_states_provinces.geojson");
const config = JSON.parse(readFileSync(join(root, "scripts/trout_ranges.json"), "utf8"));
const species = (() => { const win = {}; new Function("window", readFileSync(join(root, "src/trout-species.js"), "utf8"))(win); return win.TROUT_SPECIES; })();

/* Projection: the same constants the page uses. */
const W = 960, LAT_N = 84, LAT_S = -20, EPS = +process.env.EPS || 0.3, MIN_AREA = +process.env.MIN_AREA || 0.6;   // EPS: simplification, map units; MIN_AREA: smallest island kept
const proj = d3.geoNaturalEarth1().scale(1).translate([0, 0]);
const S = (W / 2) / proj([180, 0])[0];
const yN = proj([0, LAT_N])[1] * S, yS = proj([0, LAT_S])[1] * S;
const TY = 4 - yN, H = Math.ceil(yS - yN + 8);
proj.scale(S).translate([W / 2, TY]);

/* Rings of a GeoJSON geometry. */
const ringsOf = (g) => !g ? [] : g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
const Q = 1e4, key = ([x, y]) => Math.round(x * Q) + "," + Math.round(y * Q);
const unkey = (k) => k.split(",").map((v) => +v / Q);

/* Dissolve: every ring edge a→b cancels against b→a from another unit; what is left is the outline.
   Returns the outline as closed rings of keys and the cancelled edges (the borders between units). */
function dissolve(rings) {
  const edges = new Map(), shared = new Map();
  for (const r of rings) {
    const ks = r.map(key);
    if (ks[0] === ks[ks.length - 1]) ks.pop();
    for (let i = 0; i < ks.length; i++) {
      const a = ks[i], b = ks[(i + 1) % ks.length];
      if (a === b) continue;
      const back = b + ">" + a;
      if (edges.has(back)) { edges.delete(back); shared.set(a < b ? a + ">" + b : back, [a, b]); }
      else edges.set(a + ">" + b, [a, b]);
    }
  }
  const out = new Map();
  for (const [a, b] of edges.values()) { if (!out.has(a)) out.set(a, []); out.get(a).push(b); }
  const loops = [];
  while (out.size) {
    const start = out.keys().next().value, ring = [start];
    let cur = start;
    for (;;) {
      const list = out.get(cur);
      if (!list) break;
      const nxt = list.pop();
      if (!list.length) out.delete(cur);
      if (nxt === start) break;
      ring.push(nxt); cur = nxt;
    }
    if (ring.length > 2) loops.push(ring);
  }
  return { loops, shared: [...shared.values()] };
}

/* Simplification (Douglas–Peucker) in map units. */
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let m = -1, md = 0;
    for (let k = i + 1; k < j; k++) { const d = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / len; if (d > md) { md = d; m = k; } }
    if (md > eps) { keep[m] = 1; stack.push([i, m], [m, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
// A closed ring, projected and simplified: split at the point farthest from the first so each half simplifies on its own.
function ringPts(loop) {
  const pts = loop.map((k) => proj(unkey(k)));
  let far = 0, fd = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > fd) { fd = d; far = i; } });
  const a = dp(pts.slice(0, far + 1), EPS), b = dp([...pts.slice(far), pts[0]], EPS);
  const r = [...a, ...b.slice(1, -1)];
  return r.length >= 3 && area(r) >= MIN_AREA ? r : null;
}
const num = (v) => (Math.round(v * 10) / 10).toString();
const pathOf = (rings) => rings.map((r) => "M" + r.map((p) => num(p[0]) + "," + num(p[1])).join("L") + "Z").join("");

/* Land: every country dissolved into continents. Rings that lie wholly south of the crop (Antarctica) are dropped. */
const north = (ring) => ring.some(([, y]) => y > LAT_S - 1);
const landRings = countries.flatMap((f) => ringsOf(f.geometry)).filter(north);
const land = dissolve(landRings);
const landLoops = land.loops.map(ringPts).filter(Boolean);

/* Country borders: edges two countries share, joined into lines and simplified. */
function chains(edgeList) {
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const [a, b] of edgeList) { add(a, b); add(b, a); }
  const seen = new Set(), ek = (a, b) => (a < b ? a + ">" + b : b + ">" + a), lines = [];
  const walk = (from, to) => {
    const line = [from, to]; seen.add(ek(from, to));
    for (;;) {
      const here = line[line.length - 1], next = [...adj.get(here)].filter((n) => !seen.has(ek(here, n)));
      if (adj.get(here).size !== 2 || !next.length) break;
      seen.add(ek(here, next[0])); line.push(next[0]);
    }
    return line;
  };
  for (const [a, ns] of adj) if (ns.size !== 2) for (const b of ns) if (!seen.has(ek(a, b))) lines.push(walk(a, b));
  for (const [a, ns] of adj) for (const b of ns) if (!seen.has(ek(a, b))) lines.push(walk(a, b));   // loops with no end
  return lines;
}
const borderLines = chains(land.shared.filter(([a]) => unkey(a)[1] > LAT_S - 1)).map((l) => dp(l.map((k) => proj(unkey(k))), EPS)).filter((l) => l.length > 1);
const bordersD = borderLines.map((l) => "M" + l.map((p) => num(p[0]) + "," + num(p[1])).join("L")).join("");

/* Ranges: each species' units, dissolved. */
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const c0 = (f) => [f.properties.NAME, f.properties.NAME_LONG, f.properties.ADMIN, f.properties.BRK_NAME].map(norm);
function unitFeatures(u) {
  let hit;
  if (u.startsWith("iso:")) hit = states.filter((f) => f.properties.iso_3166_2 === u.slice(4));
  else if (/^[A-Z]{2}:region=/.test(u)) { const [cc, v] = [u.slice(0, 2), norm(u.slice(10))]; hit = states.filter((f) => f.properties.iso_a2 === cc && norm(f.properties.region) === v); }
  else if (/^[A-Z]{2}:/.test(u)) {
    const [cc, v] = [u.slice(0, 2), norm(u.slice(3))], of = states.filter((f) => f.properties.iso_a2 === cc);
    hit = of.filter((f) => norm(f.properties.name) === v);
    if (!hit.length) hit = of.filter((f) => String(f.properties.name_alt || "").split("|").map(norm).includes(v));
  } else hit = countries.filter((f) => c0(f).includes(norm(u)));
  if (!hit.length) throw new Error(`range unit "${u}" matches nothing in Natural Earth`);
  if (hit.length > 1 && !/region=/.test(u)) throw new Error(`range unit "${u}" matches ${hit.length} units: ${hit.map((f) => f.properties.name || f.properties.NAME).join(", ")}`);
  return hit;
}
const ranges = {}, shapes = {};
const ids = new Set(species.map((s) => s[0]));
for (const [id, units] of Object.entries(config)) {
  if (id.startsWith("_")) continue;
  if (!ids.has(id)) throw new Error(`scripts/trout_ranges.json has "${id}", which is not in src/trout-species.js`);
  const rings = units.flatMap((u) => unitFeatures(u).flatMap((f) => ringsOf(f.geometry)));
  const loops = dissolve(rings).loops.map(ringPts).filter(Boolean);
  if (!loops.length) throw new Error(`${id} drew nothing`);
  shapes[id] = loops;
  ranges[id] = pathOf(loops);
}

/* A marker has to sit inside its own shape (even-odd), or the tap target and the picture disagree. */
const inside = (loops, x, y) => { let c = false; for (const r of loops) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const outside = species.filter((s) => shapes[s[0]] && !inside(shapes[s[0]], ...proj([s[7], s[6]])));
if (outside.length) { console.error("Marker outside its range shape (move lat/lon in src/trout-species.js):\n" + outside.map((s) => `  ${s[0]} ${s[6]},${s[7]}`).join("\n")); process.exitCode = 1; }

const out = { w: W, h: H, s: +S.toFixed(6), tx: W / 2, ty: +TY.toFixed(6), latN: LAT_N, latS: LAT_S, land: pathOf(landLoops), borders: bordersD, ranges };
const body = `// Generated by scripts/make_trout_land.mjs from Natural Earth 1:10m (public domain) and scripts/trout_ranges.json. Do not edit.\n` +
  `// Natural Earth 1 projection: x = tx + s * X(lon, lat), y = ty - s * Y(lon, lat), lon/lat in radians.\n` +
  `// ranges: species id -> path for the state, province and country lines that make up its native range.\n` +
  `window.TROUT_LAND = ${JSON.stringify(out)};\n`;
writeFileSync(join(root, "src/trout-land.js"), body);
console.log(`src/trout-land.js: ${(body.length / 1024).toFixed(0)} KB (land ${(out.land.length / 1024).toFixed(0)}, borders ${(bordersD.length / 1024).toFixed(0)}, ranges ${(JSON.stringify(ranges).length / 1024).toFixed(0)}), ${W}×${H}, ${Object.keys(ranges).length} range shapes`);
