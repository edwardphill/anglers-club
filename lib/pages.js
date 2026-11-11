// Public pages for search engines and AI answers: one page per river and per shop, a directory of each,
// a sitemap, robots.txt and llms.txt. Plain HTML with the report text, dates and photo descriptions in
// it (a photo alone can't be read or cited), and schema.org data. Pure functions: api/page.js fetches the data.
import { createRequire } from "node:module";
import { RIVERS, LIVE_DAYS, ageDays } from "./shops.js";
import { DOVE } from "./dovedata.js";

// Public river URLs use hyphens (/rivers/south-holston); the Fly Picker's ids use underscores.
export const riverSlug = (k) => String(k).replace(/_/g, "-");
export const riverKey = (slug) => { const k = String(slug || "").toLowerCase().replace(/-/g, "_"); return Object.hasOwn(RIVERS, k) ? k : ""; };

const FP = createRequire(import.meta.url)("../data/flypicker.json");

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const dateLong = (s) => { const [y, m, d] = s.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const ageText = (d) => (d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago");
const where = (s) => [s.city, s.state].filter(Boolean).join(", ");
export const trim = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };
export const ld = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const flyName = (id) => (FP.flies[id] ? FP.flies[id].name : id);

const CSS = `:root{color-scheme:light;--ground:#FBF8F1;--paper:#FFFDF8;--ink:#1E2A22;--muted:#4A564E;--hair:#DDD3BE;--brass:#9C7A3C;--green:#1F4D3A}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:18px/1.55 "EB Garamond",Garamond,Georgia,serif}
header.site,main,footer{max-width:760px;margin:0 auto;padding:0 18px}
header.site{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-top:18px;padding-bottom:14px;border-bottom:3px double var(--brass)}
header.site a{font:500 .8rem/1 "Cinzel","Times New Roman",serif;letter-spacing:.18em;text-transform:uppercase;color:var(--ink);text-decoration:none}
h1,h2,h3{font-family:"Cormorant Garamond",Garamond,Georgia,serif;line-height:1.15;margin:0}h1{font-size:2.1rem;margin:26px 0 6px}h2{font-size:1.5rem;margin:34px 0 10px}h3{font-size:1.2rem}
a{color:var(--green)}p{margin:8px 0}.meta,.muted{color:var(--muted);font-size:.95rem}
.rep{border:1px solid var(--hair);background:var(--paper);padding:16px 18px;margin:14px 0}.rep figure{margin:10px 0}.rep img{max-width:100%;height:auto;max-height:420px;border:1px solid var(--hair)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 14px;margin:10px 0}dt{color:var(--muted)}dd{margin:0}
.tag{display:inline-block;font:500 .66rem/1 "Cinzel",serif;letter-spacing:.14em;text-transform:uppercase;border:1px solid var(--brass);padding:4px 7px;color:#7D5F28}
.cta{display:inline-block;border:1px solid var(--ink);padding:9px 16px;text-decoration:none;color:var(--ink);font:500 .78rem/1 "Cinzel",serif;letter-spacing:.14em;text-transform:uppercase;margin:8px 0}
ul.plain{padding-left:20px}details{margin:8px 0}footer{padding-top:30px;padding-bottom:40px;color:var(--muted);font-size:.9rem}`;

export function layout({ base, path, title, description, image, ld: data, body, noindex, head = "", foot = "", note = "Shop reports are written by the shops and posted by them each week. Anglers Club doesn't verify conditions; check flows and regulations before you go." }) {
  const url = base + path;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="${noindex ? "noindex,follow" : "index,follow,max-image-preview:large"}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Anglers Club"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Cormorant+Garamond:wght@500;600&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap">
<style>${CSS}</style>
${head}
<script type="application/ld+json">${ld(data)}</script>
</head><body>
<header class="site"><a href="/">Anglers Club</a><nav><a href="/rivers">Rivers</a> &nbsp; <a href="/shops">Shops</a> &nbsp; <a href="/dove-fields">Dove fields</a></nav></header>
<main>${body}</main>
${foot}
<footer>${esc(note)}</footer>
</body></html>`;
}

// ---------- reports ----------

const photoUrl = (base, r) => (r.photo ? base + r.photo : "");

function reportHtml(base, r, { showShop = true, showRiver = false } = {}) {
  const live = r.age <= LIVE_DAYS;
  const rows = [
    ["Flow", r.flow], ["Clarity", r.clarity], ["Water temperature", r.tempF != null ? r.tempF + "°F" : ""],
    ["Hatches", (r.hatches || []).join(", ")],
    ["Flies working", (r.flies || []).map((f) => f.name + (f.size ? " " + f.size : "") + (f.note ? " (" + f.note + ")" : "")).join(", ")],
  ].filter(([, v]) => v);
  return `<article class="rep" id="r-${esc(r.id)}">
<h3>${esc(r.title)}</h3>
<p class="meta">${showShop && r.shop ? `<a href="/shops/${esc(r.shop.slug)}">${esc(r.shop.name)}</a>${r.shop.city ? ", " + esc(where(r.shop)) : ""} · ` : ""}${showRiver ? `<a href="/rivers/${esc(riverSlug(r.river))}">${esc(r.riverName)}</a> · ` : ""}<time datetime="${esc(r.reportedOn)}">${esc(dateLong(r.reportedOn))}</time> (${esc(ageText(r.age))}) ${live ? "" : `<span class="tag">Archived</span>`}</p>
${r.photo ? `<figure><img src="${esc(r.photo)}" alt="${esc((r.shop ? r.shop.name + " " : "") + "fishing report for the " + r.riverName + ", " + dateLong(r.reportedOn))}" loading="lazy"></figure>` : ""}
<p>${esc(r.summary)}</p>
${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
${r.tactics ? `<p><strong>Where and how:</strong> ${esc(r.tactics)}</p>` : ""}
${r.transcript ? `<details><summary>Text from the report photo</summary><p>${esc(r.transcript)}</p></details>` : ""}
</article>`;
}

function articleLd(base, r, parent, riverId) {
  return {
    "@type": "Article", "@id": `${parent}#r-${r.id}`, headline: r.title, datePublished: r.reportedOn, dateModified: r.reportedOn,
    inLanguage: "en-US", articleBody: r.summary, isPartOf: { "@id": parent },
    ...(r.shop ? { author: { "@type": "Organization", name: r.shop.name, url: `${base}/shops/${r.shop.slug}` } } : {}),
    ...(riverId ? { about: { "@id": riverId } } : {}),
    ...(r.photo ? { image: photoUrl(base, r) } : {}),
  };
}

// ---------- the Fly Picker's side of a river page ----------

function flyPickerSection(key, month) {
  const r = FP.rivers[key];
  if (!r) return "";
  const plan = (r.plan || []).find((p) => p.months.includes(month));
  const notes = (r.hatch_notes || []).filter((n) => n.months.includes(month)).slice(0, 4);
  if (!plan && !notes.length) return "";
  const link = (s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.site || s.source)}</a>`;
  return `<h2>What to fish on the ${esc(r.name)} in ${MONTHS[month - 1]}</h2>
${plan ? `<ul class="plain">${plan.picks.map((p) => `<li><strong>${esc(flyName(p.fly))}</strong> ${esc(p.size || "")}: ${esc(p.why)}</li>`).join("")}</ul>
<p>${esc(plan.dries_text || "")}</p>${plan.src && plan.src.length ? `<p class="muted">Sources: ${plan.src.map(link).join(", ")}</p>` : ""}` : ""}
${notes.length ? `<h3>What's hatching</h3><ul class="plain">${notes.map((n) => `<li>${esc(n.text)} <span class="muted">· <a href="${esc(n.url)}" rel="noopener">${esc(n.source)}</a></span></li>`).join("")}</ul>` : ""}
<p class="muted">From the Fly Picker, which ranks flies from hatch charts and published reports. It does not use the shop reports above.</p>`;
}

// ---------- pages ----------

export function riverPage({ base, key, reports, archive, shops, now = Date.now() }) {
  const river = RIVERS[key], month = new Date(now).getUTCMonth() + 1, year = new Date(now).getUTCFullYear();
  const path = "/rivers/" + riverSlug(key), riverId = base + path + "#river";
  const latest = reports[0];
  const title = `${river.name} fishing report and what to fish, ${MONTHS[month - 1]} ${year} | Anglers Club`;
  const description = latest
    ? trim(`Shop report from ${latest.shop.name}, ${dateLong(latest.reportedOn)}: ${latest.summary}`, 158)
    : trim(`What's hatching and which flies to fish on the ${river.name} in ${MONTHS[month - 1]}, from guide and fly shop reports.`, 158);
  const body = `<h1>${esc(river.name)} fishing report</h1>
<p class="muted">Weekly reports from local fly shops, with what's hatching and which flies to fish this month.</p>
<h2>Shop reports, last ${LIVE_DAYS} days</h2>
${reports.length ? reports.map((r) => reportHtml(base, r)).join("") : `<p>No shop has posted a report for the ${esc(river.name)} in the last ${LIVE_DAYS} days.${shops.length ? " These shops cover it:" : ""}</p>`}
${!reports.length && shops.length ? `<ul class="plain">${shops.map((s) => `<li><a href="/shops/${esc(s.slug)}">${esc(s.name)}</a>${s.city ? ", " + esc(where(s)) : ""}</li>`).join("")}</ul>` : ""}
<p><a class="cta" href="/">Ask a shop in the Anglers Club app</a></p>
${flyPickerSection(key, month)}
${archive.length ? `<h2>Earlier reports</h2>${archive.map((r) => reportHtml(base, r)).join("")}` : ""}`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "RiverBodyOfWater", "@id": riverId, name: river.name, url: base + path, geo: { "@type": "GeoCoordinates", latitude: river.lat, longitude: river.lon } },
      { "@type": "CollectionPage", "@id": base + path, url: base + path, name: title, description, about: { "@id": riverId }, inLanguage: "en-US" },
      ...[...reports, ...archive].map((r) => articleLd(base, r, base + path, riverId)),
    ],
  };
  return layout({ base, path, title, description, image: latest ? photoUrl(base, latest) : "", ld: data, body });
}

export function shopPage({ base, shop, reports }) {
  const path = "/shops/" + shop.slug, shopId = base + path + "#shop";
  const live = reports.filter((r) => r.age <= LIVE_DAYS), old = reports.filter((r) => r.age > LIVE_DAYS);
  const names = shop.rivers.map((k) => RIVERS[k]).filter(Boolean);
  const title = `${shop.name}${shop.city ? ", " + where(shop) : ""}: weekly river reports | Anglers Club`;
  const description = trim(reports[0]
    ? `${shop.name} fishing report, ${dateLong(reports[0].reportedOn)}: ${reports[0].summary}`
    : `${shop.name}${shop.city ? " in " + where(shop) : ""}${names.length ? " reports on " + names.map((r) => r.name).join(", ") : ""}.`, 158);
  const body = `<h1>${esc(shop.name)}</h1>
<p class="meta">${esc(where(shop))}${shop.website ? ` · <a href="${esc(shop.website)}" rel="nofollow noopener">${esc(shop.website.replace(/^https:\/\//, ""))}</a>` : ""}${shop.instagram ? ` · <a href="https://www.instagram.com/${esc(shop.instagram)}/" rel="nofollow noopener">@${esc(shop.instagram)}</a>` : ""}</p>
${shop.about ? `<p>${esc(shop.about)}</p>` : ""}
${names.length ? `<p>Reports on ${names.map((r) => `<a href="/rivers/${esc(riverSlug(r.key))}">${esc(r.name)}</a>`).join(", ")}.</p>` : ""}
<p><a class="cta" href="/">Message ${esc(shop.name)} in the Anglers Club app</a></p>
<h2>Latest reports</h2>
${live.length ? live.map((r) => reportHtml(base, r, { showShop: false, showRiver: true })).join("") : `<p>No report in the last ${LIVE_DAYS} days.</p>`}
${old.length ? `<h2>Earlier reports</h2>${old.map((r) => reportHtml(base, r, { showShop: false, showRiver: true })).join("")}` : ""}`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "LocalBusiness", "@id": shopId, name: shop.name, url: base + path, ...(shop.about ? { description: shop.about } : {}),
        address: { "@type": "PostalAddress", ...(shop.city ? { addressLocality: shop.city } : {}), ...(shop.state ? { addressRegion: shop.state } : {}), addressCountry: "US" },
        ...(shop.lat != null && shop.lon != null ? { geo: { "@type": "GeoCoordinates", latitude: shop.lat, longitude: shop.lon } } : {}),
        sameAs: [shop.website, shop.instagram ? `https://www.instagram.com/${shop.instagram}/` : ""].filter(Boolean) },
      { "@type": "CollectionPage", "@id": base + path, url: base + path, name: title, description, about: { "@id": shopId }, inLanguage: "en-US" },
      ...reports.map((r) => articleLd(base, { ...r, shop }, base + path, `${base}/rivers/${riverSlug(r.river)}#river`)),
    ],
  };
  return layout({ base, path, title, description, image: reports[0] ? photoUrl(base, reports[0]) : "", ld: data, body });
}

export function riversIndex({ base, latest }) {
  const rows = Object.values(RIVERS).sort((a, b) => a.name.localeCompare(b.name));
  const body = `<h1>River fishing reports</h1>
<p class="muted">Weekly reports from local fly shops on the rivers in the Fly Picker.</p>
<ul class="plain">${rows.map((r) => { const l = latest[r.key]; return `<li><a href="/rivers/${esc(riverSlug(r.key))}">${esc(r.name)}</a>${l ? ` <span class="muted">· ${esc(l.shop.name)}, ${esc(dateLong(l.reportedOn))}</span>` : ""}</li>`; }).join("")}</ul>`;
  const title = "River fishing reports from local fly shops | Anglers Club", description = "Weekly fishing reports from local fly shops, river by river, with what's hatching and which flies to fish.";
  const data = { "@context": "https://schema.org", "@type": "CollectionPage", name: title, description, url: base + "/rivers",
    mainEntity: { "@type": "ItemList", itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, url: `${base}/rivers/${riverSlug(r.key)}`, name: r.name })) } };
  return layout({ base, path: "/rivers", title, description, ld: data, body });
}

export function shopsIndex({ base, shops }) {
  const body = `<h1>Fly shops</h1>
<p class="muted">Local fly shops that post a river report every week.</p>
${shops.length ? `<ul class="plain">${shops.map((s) => `<li><a href="/shops/${esc(s.slug)}">${esc(s.name)}</a>${s.city ? ", " + esc(where(s)) : ""}${s.lastReport ? ` <span class="muted">· last report ${esc(dateLong(s.lastReport))}</span>` : ""}</li>`).join("")}</ul>` : `<p>No shops are listed yet.</p>`}`;
  const title = "Fly shops with weekly river reports | Anglers Club", description = "Local fly shops that post a fishing report every week, with what's hatching and which flies are working.";
  const data = { "@context": "https://schema.org", "@type": "CollectionPage", name: title, description, url: base + "/shops",
    mainEntity: { "@type": "ItemList", itemListElement: shops.map((s, i) => ({ "@type": "ListItem", position: i + 1, url: `${base}/shops/${s.slug}`, name: s.name })) } };
  return layout({ base, path: "/shops", title, description, ld: data, body });
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function sitemap({ base, shops, riverDates }) {
  const urls = [
    { loc: base + "/" }, { loc: base + "/rivers" }, { loc: base + "/shops" }, { loc: base + "/dove-fields", lastmod: DOVE.checked },
    ...DOVE.fields.map((f) => ({ loc: `${base}/dove-fields/${f.slug}`, lastmod: DOVE.checked })),
    ...Object.keys(RIVERS).map((k) => ({ loc: `${base}/rivers/${riverSlug(k)}`, lastmod: riverDates[k] })),
    ...shops.map((s) => ({ loc: `${base}/shops/${s.slug}`, lastmod: s.lastReport })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${xml(u.lastmod)}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
}

export const robots = (base) => `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`;

export function llms({ base, latest, shops }) {
  const rows = Object.values(RIVERS).sort((a, b) => a.name.localeCompare(b.name));
  return `# Anglers Club

> A trip calendar for fishing and hunting clubs, with a Fly Picker that ranks flies from hatch charts and published reports, and weekly river reports posted by local fly shops.

## River reports
${rows.map((r) => { const l = latest[r.key]; return `- [${r.name}](${base}/rivers/${riverSlug(r.key)}): ${l ? `latest shop report ${l.reportedOn} from ${l.shop.name}. ${trim(l.summary, 220)}` : "no shop report in the last " + LIVE_DAYS + " days; the page lists what's hatching and which flies to fish this month."}`; }).join("\n")}

## Dove fields
- [Public dove fields map](${base}/dove-fields): ${DOVE.fields.length} TWRA public dove fields (${DOVE.regions.map((r) => r.name + ", " + r.area).join("; ")}), each with GPS coordinates, directions, crops, permits and ${DOVE.season} hunt days. Checked ${DOVE.checked}.

## Fly shops
${shops.length ? shops.map((s) => `- [${s.name}](${base}/shops/${s.slug})${s.city ? ": " + where(s) : ""}`).join("\n") : "- None listed yet."}

## Notes
- Shop reports are written by the shops and are labeled with the shop and the report date. Reports older than ${LIVE_DAYS} days are archived with their date.
- The Fly Picker's picks come from hatch charts and published reports and do not use the shop reports.
`;
}

export { ageDays };
