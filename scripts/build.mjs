// Assembles public/index.html from src/club.html, the embedded Fly Picker and the Trout Map
// checklist, and copies the Trout Map's coastlines to public/trout-land.js.
// Run after editing anything under src/: npm run build
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let page = read("src/club.html");
const swap = (marker, text) => {
  if (page.split(marker).length !== 2) throw new Error(`Expected exactly one ${marker} in src/club.html`);
  page = page.replace(marker, () => text);
};
swap("<!--FP_TEMPLATE-->", read("src/flypicker/template.html").trimEnd());
swap("<!--FP_SCRIPTS-->", read("src/flypicker/scripts.html").trimEnd());
swap("<!--TROUT_SPECIES-->", "<script>\n" + read("src/trout-species.js").trimEnd() + "\n</script>");

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
console.log(`public/index.html: ${(html.length / 1024).toFixed(0)} KB`);
