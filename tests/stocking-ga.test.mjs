// Georgia's trout stocking frequencies (data/stocking-ga.json): the sheet's six tables are all there, every footnote
// mark means something, every county can be placed on the map, and the files the Stocking tab loads are up to date.
// No database needed. Usage: node tests/stocking-ga.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const D = JSON.parse(read("data/stocking-ga.json"));
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };

// ---- the sheet's tables ----
const perTable = D.groups.map((g) => D.waters.filter((w) => w.group === g.id).length);
assert.deepEqual(D.groups.map((g) => g.id), [1, 2, 3, 4, 5, 6]);
assert.deepEqual(perTable, [28, 23, 5, 25, 2, 3], "waters per table, as printed on the 2026 sheet");
assert.equal(D.waters.length, 86);
assert.ok(D.source.startsWith("https://georgiawildlife.com/") && /Trout%20Stocking%20Frequencies/.test(D.source), "the source is the state's sheet");
assert.ok(D.weekly.startsWith("https://georgiawildlife.com/"), "the weekly report is linked");
assert.equal(D.months, "March through October");
assert.ok(D.page.startsWith("https://georgiawildlife.com/") && /Delayed Harvest/.test(D.winter), "the sheet covers March through October; Delayed Harvest streams are stocked from November 1");
ok("86 waters in six tables (28, 23, 5, 25, 2, 3), with the state's sheet as the source");

// ---- footnote marks ----
const marks = {};
for (const w of D.waters) {
  const g = D.groups[w.group - 1];
  if (w.mark) {
    assert.ok(g.marks[w.mark], `${w.name} uses ${w.mark}, which table ${g.id} doesn't define`);
    assert.equal(w.late, g.marks[w.mark].late, `${w.name}: "after July 4" follows its footnote`);
    marks[g.id + w.mark] = (marks[g.id + w.mark] || 0) + 1;
  } else assert.equal(w.late, g.late, `${w.name}: "after July 4" follows its table`);
}
for (const g of D.groups) for (const [m, v] of Object.entries(g.marks)) { assert.ok(v.text && v.tag, `table ${g.id} ${m} reads in words`); assert.ok(marks[g.id + m], `table ${g.id} ${m} is used`); }
assert.deepEqual(marks, { "1*": 3, "1**": 8, "2*": 5, "2**": 3, "2***": 1, "4*": 18 }, "starred waters, as printed on the sheet");
assert.equal(D.waters.filter((w) => w.late === true).length, 54);
assert.equal(D.waters.filter((w) => w.late === null).length, 4, "once a year (3) and the water under construction (1) say nothing about July 4");
ok("every footnote mark is defined for its table, used, and read as a plain sentence");

// ---- waters and counties ----
const seen = new Set();
for (const w of D.waters) {
  const key = w.name + "|" + w.county; assert.ok(!seen.has(key), "duplicate " + key); seen.add(key);
  for (const c of w.county.split(", ")) {
    const p = D.counties[c]; assert.ok(p, `${c} County has a location`);
    assert.ok(p[0] > 33.5 && p[0] < 35.05 && p[1] > -85.65 && p[1] < -82.0, `${c} is inside the map`);
  }
}
for (const c of Object.keys(D.counties)) assert.ok(D.waters.some((w) => w.county.split(", ").includes(c)), `${c} has a water`);
const same = (name) => D.waters.filter((w) => w.name === name).map((w) => w.county).sort();
assert.deepEqual(same("Panther Creek"), ["Habersham", "Stephens"]);
assert.deepEqual(same("Tallulah River"), ["Rabun", "Towns"]);
assert.deepEqual(same("Brasstown Creek"), ["Towns", "Union"]);
assert.deepEqual(same("Lanier Tailwaters"), ["Forsyth, Gwinnett"], "a water in two counties is one record");
assert.equal(D.waters.find((w) => w.alias).name, "West Armuchee Creek");
for (const [x, y] of D.outline) assert.ok(x > -85.7 && x < -81.9 && y > 33.4 && y < 35.1, "outline inside the map");
ok("same-named waters in different counties stay separate, every county has a place on the map");

// ---- the files the app loads ----
const loaded = read("public/stocking-ga.js");
assert.ok(loaded.startsWith("//") && loaded.includes("window.STOCKING_GA = "), "public/stocking-ga.js is generated");
assert.deepEqual(JSON.parse(loaded.slice(loaded.indexOf("window.STOCKING_GA = ") + 21).replace(/;\s*$/, "")), D, "public/stocking-ga.js matches the data: run npm run build");
const app = read("public/index.html");
assert.ok(!/nothing is going in the water/.test(read("src/stocking-ga.js")), "never says nothing is stocked in the off season: Delayed Harvest is stocked from November 1");
assert.ok(app.includes('data-sksa="GA"') && app.includes("function gaSheetMarkup") && app.includes('id="ga-map"'), "the built app has the Georgia switch: run npm run build");
assert.ok(/stockOk = \(\) => .*"GA"/.test(app), "Georgia clubs get the Stocking tab");
ok("the Stocking tab's Georgia script and screen are built from the data");

// ---- the dated view: counties the weekly report names that the sheet doesn't, and what the screen does with them ----
for (const c of ["Fulton", "Cobb", "Pickens", "Polk"]) {
  const [lat, lon] = D.reportCounties[c] || [];
  assert.ok(lat > 33.4 && lat < 35.1 && lon > -85.7 && lon < -81.9, `${c} County has a place on the map`);
}
assert.ok(!D.cities.some(([n]) => n === "Atlanta"), "the Atlanta label would sit on the Fulton County circle");
const src = read("src/stocking-ga.js");
assert.ok(app.includes("function gaEvRow") && app.includes('api("stocking?state=GA")') && app.includes('id="ga-evlist"') && app.includes('id="ga-when"'), "the built app lists the reported stockings: run npm run build");
assert.ok(/function gaEvMatch/.test(src) && /GA\.when !== "all"/.test(src), "the window filter is there");
assert.ok(!/addDays\([^)]*,\s*\d+\)[^;]*gaEvRow|upcoming|next stocking|will be stocked/i.test(src), "nothing on the Georgia screen predicts a date");
assert.ok(/reports a stocking after it happens/i.test(src), "the screen says the dates are after the fact");
ok("the dated Georgia view is built, places every county the report names, and predicts nothing");
console.log(`\nAll ${n} checks passed.`);
