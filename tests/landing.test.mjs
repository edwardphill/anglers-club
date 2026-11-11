// The product pages (AI fly fishing picker, trip planner, river report tool, fly shop discoverability), the home page's search metadata, and the
// site-wide discoverability files. These pages need no database. Run: node tests/landing.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = (await import("../api/page.js")).default;
const { robots, llms, sitemap, NAV } = await import("../lib/pages.js");
const { BRAND, PRODUCTS, HOME_DESC, HOME_TITLE } = await import("../lib/brand.js");
const FPD = JSON.parse(readFileSync(new URL("../data/flypicker.json", import.meta.url), "utf8"));

const call = (query) => new Promise((resolve) => {
  const headers = {};
  const res = { statusCode: 200, setHeader(k, v) { headers[k.toLowerCase()] = v; }, end(body) { resolve({ status: this.statusCode, body, headers }); } };
  page({ method: "GET", query, headers: { host: "test.example", "x-forwarded-proto": "https" } }, res);
});
const base = "https://test.example";
const ld = (html) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };

const pages = [["flypicker", "/fly-picker", "AI fly fishing picker"], ["tripplanner", "/trip-planner", "Trip planner"], ["rivertool", "/river-report-tool", "River report tool"], ["forshops", "/for-shops", "Fly shop AI discoverability"]];
for (const [kind, path, h1] of pages) {
  const r = await call({ kind }); assert.equal(r.status, 200, kind);
  const h = r.body;
  assert.ok(h.includes(`<h1>${h1}</h1>`), "h1 names the product in the words people search");
  assert.equal((h.match(/<h1>/g) || []).length, 1, "one h1");
  assert.ok(h.includes(`<link rel="canonical" href="${base}${path}">`));
  assert.ok(h.includes("index,follow"));
  assert.match(h, /<title>[^<]{20,75}\| Fly AI<\/title>/);
  const d = /<meta name="description" content="([^"]+)"/.exec(h)[1]; assert.ok(d.length >= 90 && d.length <= 175, `description length ${d.length}`);
  assert.equal((h.match(/<meta name="description"/g) || []).length, 1);
  assert.ok(h.includes(`<meta property="og:image" content="${base}/og.png">`) && h.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(h.includes('<link rel="icon" href="/favicon.svg"'));
  const g = ld(h)["@graph"]; const types = g.map((x) => x["@type"]);
  assert.ok(types.includes("Organization") && types.includes("WebSite") && types.includes("WebPage") && types.includes("FAQPage"), types.join());
  const faq = g.find((x) => x["@type"] === "FAQPage"); assert.ok(faq.mainEntity.length >= 4);
  for (const q of faq.mainEntity) assert.ok(h.includes(`<h3>${q.name.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}</h3>`), "every FAQ in the JSON-LD is on the page as text: " + q.name);
  assert.ok(!/<[a-z]/i.test(faq.mainEntity.map((q) => q.acceptedAnswer.text).join("")), "FAQ answers in JSON-LD are plain text");
  assert.ok(!/\bundefined\b|\[object/.test(h), "no template leftovers");
  assert.ok(PRODUCTS.every((p) => h.includes(`href="${p.path}"`)), "every product page links to every product page (footer)");
}
ok("each product page has one h1 in the searched words, a canonical, a title and description of sane length, Open Graph and Twitter cards, a favicon, and Organization, WebSite, WebPage and FAQPage data that matches the text");

let h = (await call({ kind: "flypicker" })).body;
const nSrc = FPD.sources.sources.length, nFlies = Object.keys(FPD.flies).length, nRivers = Object.keys(FPD.rivers).length;
assert.ok(h.includes(`${nSrc} dated reports`) && h.includes(`${nFlies}-fly catalog`), "numbers come from the picker's own data");
for (const r of Object.values(FPD.rivers)) assert.ok(h.includes(r.name), r.name);
assert.ok(h.includes('href="/rivers/south-holston"'));
assert.ok(/rules engine, not a chatbot/i.test(h) && /not a chatbot/i.test(h), "says plainly that the picker isn't a language model");
assert.ok(ld(h)["@graph"].some((x) => x["@type"] === "SoftwareApplication" && x.featureList.length >= 4));
ok("the picker page states its real numbers from the data (reports, flies, rivers), links each river, and says it is a rules engine, not a chatbot");

h = (await call({ kind: "tripplanner" })).body;
assert.ok(/Stocking and dam generation data cover Tennessee today/.test(h) && /Yes\. Check flows/.test(h), "states its limits");
assert.ok(h.includes('href="/guides"') && h.includes('href="/fly-picker"'));
assert.ok(!/Claude|Anthropic|OpenAI|GPT/.test(h), "doesn't name a model vendor");
ok("the trip planner page states its limits (Tennessee stocking and generation, can be wrong), links guides and the picker, and names no model vendor");

// The way into the tool comes first: a launch card right under each explainer page's title.
for (const [kind, href] of [["flypicker", "/picker"], ["tripplanner", "/plan"], ["rivertool", "/my-shop"], ["clubs", "/#start"], ["forshops", "/my-shop"]]) {
  const hh = (await call({ kind })).body;
  assert.ok(new RegExp(`</h1>\\s*<div class="launch"><a class="cta" href="${href.replace(/[/#]/g, (c) => "\\" + c)}">Open|</h1>\\s*<div class="launch"><a class="cta" href="${href.replace(/[/#]/g, (c) => "\\" + c)}">Start`).test(hh), kind + " opens with the launch card for " + href);
}
ok("every explainer page opens with a launch card that goes to the tool itself (the picker, the planner, the shop panel, a new club)");

h = (await call({ kind: "rivertool" })).body;
assert.ok(/photograph/i.test(h) && /An image alone can't be read/.test(h) && /up to six/.test(h) && /checks every report before it goes live/.test(h), "says what it does, why words matter and who checks");
assert.ok(/misread a number/.test(h) && /by invitation/.test(h) && h.includes("10 days"), "states its limits");
assert.ok(h.includes('href="/for-shops"') && h.includes('href="/shops"') && h.includes('href="/rivers/south-holston"'));
assert.ok(ld(h)["@graph"].some((x) => x["@type"] === "SoftwareApplication" && x.featureList.length >= 4));
assert.ok(!/Claude|Anthropic|OpenAI|GPT/.test(h), "names no model vendor");
ok("the river report tool page says what the tool does and why the photo is turned into words, says the shop checks every report and that it can misread a number, and links the shop pages and rivers");

h = (await call({ kind: "forshops" })).body;
assert.ok(h.includes('href="/river-report-tool"'), "the discoverability page links to the tool");
assert.ok(/guarantee/i.test(h) && /by invitation/i.test(h) && h.includes('href="/llms.txt"') && h.includes('href="/shops"'));
assert.ok(h.includes("10 days"), "the 10-day window matches LIVE_DAYS");
assert.ok(ld(h)["@graph"].some((x) => x["@type"] === "Service"));
ok("the shop page promises no AI recommendations, says shops join by invitation, states the 10-day window, and carries Service data");

// ---- site-wide files ----
const rb = robots(base);
for (const bot of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended", "Googlebot"]) assert.ok(rb.includes(`User-agent: ${bot}\nAllow: /\nDisallow: /api/`), bot);
assert.ok(rb.includes("User-agent: *\nAllow: /\nDisallow: /api/") && rb.includes(`Sitemap: ${base}/sitemap.xml`));
ok("robots.txt names the search and AI crawlers, each with the /api/ rule repeated (a named group ignores the * group), and points at the sitemap");

const sm = sitemap({ base, shops: [], guides: [], riverDates: {} });
for (const p of ["/", "/fly-picker", "/trip-planner", "/river-report-tool", "/for-shops"]) assert.ok(sm.includes(`<loc>${base}${p}</loc>`), p);
assert.ok(/<loc>https:\/\/test\.example\/fly-picker<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sm));
ok("the sitemap lists the home page and the product pages with a lastmod");

const lt = llms({ base, latest: {}, shops: [], guides: [] });
assert.ok(lt.startsWith("# Fly AI\n\n> ") && lt.includes(HOME_DESC));
for (const p of PRODUCTS) assert.ok(lt.includes(`[${p.name}](${base}${p.path})`), p.name);
assert.ok(/rules engine, not a chatbot/.test(lt) && /Nothing on this site is a guarantee/.test(lt));
assert.ok(lt.includes("## Fishing tools") && lt.includes("## Hunting") && /transcribes it into a written report for each river/.test(lt));
ok("llms.txt leads with the one-line description, lists the products with links under fishing and hunting, and says what is and isn't a language model");

assert.deepEqual(NAV.slice(0, 3).map((x) => x[0]), ["/picker", "/plan", "/river-report-tool"]);   // the header opens the tools themselves
ok("the site header leads with the three tools");

// ---- the home page ----
const home = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
assert.ok(home.includes(`<title>${HOME_TITLE}</title>`));
assert.equal((home.match(/<meta name="description"/g) || []).length, 1, "one description");
assert.equal((home.match(/rel="canonical"/g) || []).length, 1);
assert.ok(/<link rel="canonical" href="https:\/\/[^"]+\/">/.test(home));
assert.ok(home.includes('<meta property="og:image" content="https://') && home.includes('rel="apple-touch-icon"'));
const hg = ld(home)["@graph"]; assert.ok(hg.some((x) => x["@type"] === "WebApplication" && x.featureList.includes("AI fly fishing picker")));
assert.ok(home.includes('<section id="seo-static"') && PRODUCTS.every((p) => home.includes(`<a class="tool" href="${p.path}">`)), "crawlable copy of the home page, with links to each product page");
assert.ok(home.includes('$("#seo-static")') && home.includes("s.remove()"), "the app removes the static copy once it has drawn");
assert.ok(!/SEO_HEAD|SEO_STATIC|Cinzel|Garamond/.test(home));
ok("the home page has the title, one description, a canonical, Open Graph image, WebApplication data, and a crawlable list of the products that the app removes on boot");

const TOOLS_SRC = /const TOOLS = \[(.*?)\n\];/s.exec(home)[1];
const toolGroup = (name) => (new RegExp(`\\{ group: "(\\w+)", name: "${name}"`).exec(TOOLS_SRC) || [])[1];
assert.equal(toolGroup("Public TN dove fields"), "hunting"); assert.equal(toolGroup("TN grouse map"), "hunting");
for (const n of ["Fly Picker", "Trip planner", "River report tool", "Trout map", "Fly shops", "Guides", "Logbook"]) assert.equal(toolGroup(n), "fishing", n);
const order = [...TOOLS_SRC.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);
assert.ok(order.indexOf("Logbook") > order.indexOf("Guides") && order.indexOf("Logbook") === order.indexOf("Guides") + 1, "the Logbook sits at the end of the fishing tools");
assert.ok(order.indexOf("Stocking calendar") < order.indexOf("River report tool") && order.indexOf("River report tool") < order.indexOf("Trout map"), "the stocking calendar comes before the river report tool, which no shop uses yet");
assert.ok(home.includes('"Fishing"') && home.includes('"Hunting"') && /\.tool:hover\{background:var\(--tc\)/.test(home), "two sections, and a selected card fills with its own color");
assert.equal(toolGroup("Forum"), "community"); assert.equal(toolGroup("Club calendar"), "community");
assert.ok(home.includes('"Forums and clubs"') && !/group: "clubs"/.test(TOOLS_SRC) && home.indexOf('["hunting", "Hunting"') < home.indexOf('["community", "Forums and clubs"'), "Forum and Club calendar share the third section");
assert.ok(JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")).redirects.some((r) => r.source === "/ai-fly-guide" && r.destination === "/trip-planner" && r.permanent), "the old trip planner address redirects for good");
ok("the home page splits the tools into fishing and hunting (dove and grouse under hunting), lists the stocking calendar ahead of the river report tool and the Logbook last among the fishing tools, and fills a selected card with its own color");

const png = readFileSync(new URL("../public/og.png", import.meta.url));
assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
assert.ok(readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8").includes("<svg"));
ok("the share image is 1200 by 630 and the favicon is there");

console.log(`\nAll ${n} checks passed.`);
