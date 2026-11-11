// Assembles public/index.html from src/club.html, the embedded Fly Picker and the Trout Map
// checklist; writes the files the tabs load later (coastlines, stocking schedule); and copies the
// Fly Picker's data and engine where the Trip Planner's server code can use them.
// Run after editing anything under src/: npm run build
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyLocal } from "./fp-local.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// The embedded Fly Picker is generated from its own repo; our additions (data/fp-local.json) are
// applied here so a resync does not drop them. Everything below uses the patched text.
const FP = applyLocal({ scripts: read("src/flypicker/scripts.html"), template: read("src/flypicker/template.html") });

let page = read("src/club.html");
const swap = (marker, text) => {
  if (page.split(marker).length !== 2) throw new Error(`Expected exactly one ${marker} in src/club.html`);
  page = page.replace(marker, () => text);
};
swap("<!--FP_TEMPLATE-->", FP.template.trimEnd());
swap("<!--FP_SCRIPTS-->", FP.scripts.trimEnd());
// Species illustrations: trout-art/<species-id>.png (or .jpg, .webp, .svg) replaces the generic
// trout on that species' card. Files are copied to public/trout-art/.
const artDir = join(root, "trout-art"), art = {};
if (existsSync(artDir)) {
  mkdirSync(join(root, "public/trout-art"), { recursive: true });
  for (const f of readdirSync(artDir).sort()) {
    const m = /^([a-z0-9-]+)\.(png|jpe?g|webp|svg)$/i.exec(f);
    if (!m) continue;
    copyFileSync(join(artDir, f), join(root, "public/trout-art", f));
    art[m[1].toLowerCase()] = "/trout-art/" + f;
  }
}
// Dam generation schedules (data/generation.json) are linked from trips, the Stocking tab and the
// Trip Planner.
swap("/*SHOPS_UI*/", read("src/shops-ui.js").trimEnd());
swap("/*WAITLIST_UI*/", read("src/waitlist-ui.js").trimEnd());
swap("<!--TROUT_SPECIES-->", "<script>\n" + read("src/trout-species.js").trimEnd() +
  "\nwindow.TROUT_ART = " + JSON.stringify(art) + ";\nwindow.GENERATION = " +
  JSON.stringify(JSON.parse(read("data/generation.json"))) + ";\n</script>");

// Everything through the first </style> belongs in <head>; the rest is the body.
const cut = page.indexOf("</style>") + "</style>".length;
const head = page.slice(0, cut);
const body = page.slice(cut);

const icon =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#F5F3E8"/>' +
      '<path d="M10 38c6-8 12-8 18 0s12 8 18 0 8-6 8-6" fill="none" stroke="#2C6A99" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M32 10l8 18H24z" fill="#BF4128"/></svg>',
  );

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Fishing and hunting trip calendars for clubs in any city: post a trip, RSVP, plan in one thread, keep a logbook.">
<meta name="theme-color" content="#F5F3E8">
<link rel="icon" href="${icon}">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}</style>
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;

mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public/index.html"), html);
// The Trout Map's coastlines load with that tab, not with the page.
copyFileSync(join(root, "src/trout-land.js"), join(root, "public/trout-land.js"));
// The Stocking tab's schedule loads with that tab too. data/stocking-tn.json is the source; the
// Trip Planner reads the same file on the server.
writeFileSync(join(root, "public/stocking-tn.js"),
  "// Tennessee trout stocking schedule (TWRA). Generated from data/stocking-tn.json by npm run build.\n" +
  "window.STOCKING = " + read("data/stocking-tn.json").trim() + ";\n");

// The Trip Planner runs the Fly Picker's engine on the server: copy its data and engine out of
// the embedded Fly Picker so the two never drift apart.
const fp = FP.scripts;
const dataLine = fp.split("\n").find((l) => l.startsWith("const DATA = "));
if (!dataLine) throw new Error("Fly Picker data not found in src/flypicker/scripts.html");
writeFileSync(join(root, "data/flypicker.json"), dataLine.slice("const DATA = ".length).replace(/;\s*$/, "") + "\n");
const e0 = fp.indexOf("const FP = (() => {"), e1 = fp.indexOf("module.exports = FP;");
if (e0 < 0 || e1 < 0) throw new Error("Fly Picker engine not found in src/flypicker/scripts.html");
writeFileSync(join(root, "lib/fp-engine.cjs"),
  "// The Fly Picker's engine, copied from src/flypicker/scripts.html by npm run build. Do not edit.\n" +
  "/* eslint-disable */\nconst DATA = require(\"../data/flypicker.json\");\n" + fp.slice(e0, e1) + "module.exports = FP;\n");
console.log(`public/index.html: ${(html.length / 1024).toFixed(0)} KB`);
