// Assembles public/index.html from src/club.html, the embedded Fly Picker and the Trout Map
// checklist; writes the files the tabs load later (coastlines, stocking schedules); and copies the
// Fly Picker's data and engine where the trip planner's server code can use them.
// Run after editing anything under src/: npm run build
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyLocal } from "./fp-local.mjs";
import { BRAND, HOME_TITLE, HOME_DESC, PRODUCTS, OTHER, orgLd, siteLd } from "../lib/brand.js";

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

// The home page's search and share metadata, structured data, and a crawlable copy of what the app shows (crawlers that
// don't run JavaScript see only this; the app removes it once it has drawn the home page). Where the site lives: SITE_URL,
// else Vercel's production address, else the known address, so a preview deploy still points search engines at production.
const E = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SITE = (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "https://angler-club.vercel.app")).replace(/\/+$/, "");
const homeLd = { "@context": "https://schema.org", "@graph": [orgLd(SITE), siteLd(SITE),
  { "@type": "WebApplication", "@id": SITE + "/#app", name: BRAND, url: SITE + "/", description: HOME_DESC, applicationCategory: "SportsApplication", operatingSystem: "Any (web browser)",
    featureList: [...PRODUCTS.map((p) => p.name), "Trip calendars for fishing and hunting clubs", "Trout stocking schedule map", "Trout species life list", "Public Tennessee dove field map"], publisher: { "@id": SITE + "/#org" } }] };
const seoHead = `<meta name="description" content="${E(HOME_DESC)}">
<link rel="canonical" href="${E(SITE)}/">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:site_name" content="${E(BRAND)}"><meta property="og:locale" content="en_US"><meta property="og:title" content="${E(HOME_TITLE)}"><meta property="og:description" content="${E(HOME_DESC)}"><meta property="og:url" content="${E(SITE)}/">
<meta property="og:image" content="${E(SITE)}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${E(BRAND)}: AI trip planner, fly fishing picker and fly shop reports">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${E(HOME_TITLE)}"><meta name="twitter:description" content="${E(HOME_DESC)}">
<script type="application/ld+json">${JSON.stringify(homeLd).replace(/</g, "\\u003c")}</script>`;
const seoStatic = `<section id="seo-static" class="home">
    <section class="hero"><h2>AI tools for fly fishing</h2><p>A trip planner that cites its sources, a fly fishing picker that ranks flies for your river and date, and river reports from local fly shops. Add a club calendar for your crew.</p></section>
    <section class="home-sec"><h2 class="home-h">Tools</h2>
      <ul class="tools-grid">${PRODUCTS.map((p, i) => `<li><a class="tool" href="${p.path}"><span class="tool-n">${String(i + 1).padStart(2, "0")}</span><span class="tool-t">${E(p.name)}</span><span class="tool-d">${E(p.text)}</span></a></li>`).join("")}</ul>
      <p class="hint">Also: ${OTHER.map((o) => `<a href="${o.path}">${E(o.name)}</a>`).join(" · ")}</p>
    </section>
  </section>`;
swap("<!--SEO_HEAD-->", seoHead);
swap("<!--SEO_STATIC-->", seoStatic);
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
// trip planner.
swap("/*STOCKING_GA*/", read("src/stocking-ga.js").trimEnd());
swap("/*SHOPS_UI*/", read("src/shops-ui.js").trimEnd());
swap("/*WAITLIST_UI*/", read("src/waitlist-ui.js").trimEnd());
swap("<!--TROUT_SPECIES-->", "<script>\n" + read("src/trout-species.js").trimEnd() +
  "\nwindow.TROUT_ART = " + JSON.stringify(art) + ";\nwindow.GENERATION = " +
  JSON.stringify(JSON.parse(read("data/generation.json"))) + ";\n</script>");

// Everything through the first </style> belongs in <head>; the rest is the body.
const cut = page.indexOf("</style>") + "</style>".length;
const head = page.slice(0, cut);
const body = page.slice(cut);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#F6F8F6">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
// trip planner reads the same file on the server.
writeFileSync(join(root, "public/stocking-tn.js"),
  "// Tennessee trout stocking schedule (TWRA). Generated from data/stocking-tn.json by npm run build.\n" +
  "window.STOCKING = " + read("data/stocking-tn.json").trim() + ";\n");
// Georgia's frequency sheet loads when the Georgia switch is first used.
writeFileSync(join(root, "public/stocking-ga.js"),
  "// Georgia trout stocking frequencies (Georgia WRD). Generated from data/stocking-ga.json by npm run build.\n" +
  "window.STOCKING_GA = " + JSON.stringify(JSON.parse(read("data/stocking-ga.json"))) + ";\n");

// The trip planner runs the Fly Picker's engine on the server: copy its data and engine out of
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
