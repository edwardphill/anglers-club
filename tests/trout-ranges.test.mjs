// The Trout Map's range shapes: which species have one, that the generated file matches the list that drives it,
// that every shape parses and each species' marker sits inside its own shape, and that the page draws, hit-tests and
// labels them. No database needed. Usage: node tests/trout-ranges.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const win = {}; vm.runInNewContext(read("../src/trout-species.js"), { window: win });
vm.runInNewContext(read("../src/trout-land.js"), { window: win });
const species = new Map(win.TROUT_SPECIES.map((r) => [r[0], r]));
const L = win.TROUT_LAND;
const J = JSON.parse(read("../scripts/trout_ranges.json"));
const ids = Object.keys(J).filter((k) => !k.startsWith("_"));
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };

// ---- the list and the generated file agree ----
assert.ok(ids.length >= 15, "at least the fifteen first shapes are listed");
for (const id of ids) {
  assert.ok(species.has(id), id + " is a species on the checklist");
  assert.ok(Array.isArray(J[id]) && J[id].length && J[id].every((u) => typeof u === "string" && u), id + " lists at least one unit");
}
assert.deepEqual(Object.keys(L.ranges).sort(), [...ids].sort(), "the generated file has a shape for every listed species and no other");
ok("every listed species is on the checklist and has exactly one generated shape");

// ---- each shape parses, is closed, and is not a sliver ----
const rings = (d) => d.split("M").slice(1).map((r) => r.replace(/Z\s*$/, "").trim().split(/\s*L\s*/).map((p) => p.split(",").map(Number)));
for (const id of ids) {
  const rs = rings(L.ranges[id]);
  assert.ok(rs.length, id + " has at least one ring");
  for (const r of rs) {
    assert.ok(r.length >= 3, id + " ring has three or more points");
    assert.ok(r.every((p) => p.length === 2 && p.every(Number.isFinite)), id + " every point is a pair of numbers");
    assert.ok(r.every(([x, y]) => x >= 0 && x <= L.w && y >= 0 && y <= L.h), id + " stays on the chart");
  }
  assert.ok(L.ranges[id].endsWith("Z"), id + " is closed");
}
ok("every shape parses into closed rings that stay on the chart");

// ---- the marker (where the label and tap target sit) lies inside its species' own shape ----
const D2R = Math.PI / 180;
// Natural Earth 1 forward projection, the same polynomial the generator uses.
function ne1(lon, lat) {
  const l = lat * D2R, l2 = l * l, l4 = l2 * l2;
  const X = lon * D2R * (0.8707 - 0.131979 * l2 + l4 * (-0.013791 + l4 * (0.003971 * l2 - 0.001529 * l4)));
  const Y = l * (1.007226 + l2 * (0.015085 + l4 * (-0.044475 + 0.028874 * l2 - 0.005916 * l4)));
  return [L.tx + L.s * X, L.ty - L.s * Y];
}
const inside = (rs, x, y) => { // even-odd, as the page fills it
  let c = false;
  for (const r of rs) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
for (const id of ids) {
  const sp = species.get(id), [x, y] = ne1(sp[7], sp[6]);
  assert.ok(inside(rings(L.ranges[id]), x, y), id + " marker (" + sp[6] + ", " + sp[7] + ") is inside its shape");
}
ok("each shaped species' marker sits inside its own shape");

// ---- the page uses them, and says what they are ----
const html = read("../public/index.html");
for (const frag of ["hasShape", "inShape", "L.ranges[x.id]", 'fill-rule="evenodd"', "new Path2D(hasShape(x)"]) assert.ok(html.includes(frag), "built page contains " + frag);
assert.ok(html.includes("Shaded ranges follow state, province and country lines"), "the legend says what the shading is");
assert.ok(html.includes("Shaded along state, province and country lines") && html.includes("A rough circle."), "the species sheet says whether its range is a shape or a circle");
assert.ok(html.includes("Boundaries: Natural Earth"), "the saved image credits the boundary data");
assert.ok(!/iucn/i.test(read("../scripts/trout_ranges.json").replace(/"_about"[^\n]*\n/, "")), "no IUCN range data is listed as a source");
assert.ok(read("../src/trout-land.js").length < 450000, "the land file stays under 450 KB");
ok("the built page draws, hit-tests and labels the shapes, and the land file stays small");

console.log("all " + n + " trout range checks passed");
