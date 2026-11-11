// Public pages for search engines and AI answers: one page per river and per shop, a directory of each,
// a sitemap, robots.txt and llms.txt. Plain HTML with the report text, dates and photo descriptions in
// it (a photo alone can't be read or cited), and schema.org data. Pure functions: api/page.js fetches the data.
import { createRequire } from "node:module";
import { RIVERS, LIVE_DAYS, ageDays } from "./shops.js";
import { DOVE } from "./dovedata.js";
import { tripNames, igUrl, signals } from "./guides.js";
import { BRAND, HOME_DESC, PRODUCTS, OTHER, LANDING_UPDATED } from "./brand.js";

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

const CSS = `:root{color-scheme:light;--ground:#F6F8F6;--paper:#FFFFFF;--ink:#0C1A14;--muted:#55655C;--hair:#DCE4DF;--brass:#8DA096;--green:#0F6B4F;--green-wash:#E8F3EE;--deep:#0F3D2E;--mint:#3DDC97;--sans:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--label:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
main,footer{max-width:760px;margin:0 auto;padding:0 18px}
header.site{display:flex;justify-content:space-between;flex-wrap:wrap;align-items:baseline;gap:6px 24px;max-width:760px;margin:0 auto;padding:18px 18px 14px;border-bottom:1px solid var(--hair)}
header.site a{font:500 .85rem/1.4 var(--sans);color:var(--muted);text-decoration:none}header.site a:hover{color:var(--ink)}
header.site>a{font-weight:700;font-size:1.02rem;letter-spacing:-.01em;color:var(--ink)}
header.site>a::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--deep);margin-left:6px}
header.site nav{display:flex;flex-wrap:wrap;gap:4px 16px}
h1,h2,h3{font-family:var(--sans);line-height:1.2;margin:0;letter-spacing:-.02em}h1{font-size:1.9rem;font-weight:700;margin:26px 0 6px}h2{font-size:1.3rem;font-weight:600;margin:34px 0 10px}h3{font-size:1.05rem;font-weight:600}
a{color:var(--green)}p{margin:8px 0}.meta,.muted{color:var(--muted);font-size:.92rem}
.rep{border:1px solid var(--hair);background:var(--paper);border-radius:10px;padding:16px 18px;margin:14px 0}.rep figure{margin:10px 0}.rep img{max-width:100%;height:auto;max-height:420px;border:1px solid var(--hair);border-radius:6px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 14px;margin:10px 0}dt{color:var(--muted)}dd{margin:0}
.tag{display:inline-block;font:500 .66rem/1 var(--label);letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--hair);border-radius:4px;padding:4px 7px;color:var(--muted);background:var(--paper)}
.cta{display:inline-block;background:var(--deep);color:#fff;border-radius:8px;padding:10px 16px;text-decoration:none;font:500 .88rem/1 var(--sans);margin:8px 0}
.cta:hover{background:#0A2A20}
ul.plain,ol.plain{padding-left:22px}ul.plain li,ol.plain li{margin:6px 0}.lede{font-size:1.1rem;color:var(--muted);margin:6px 0 14px}.cta.ghost{background:transparent;color:var(--ink);border:1px solid #CAD6CF}.cta.ghost:hover{background:var(--paper)}footer nav{margin-top:14px;font-size:.88rem;line-height:1.9}footer nav a{color:var(--muted);margin-right:14px;white-space:nowrap}details{margin:8px 0}.tx{margin:12px 0 4px;padding-top:10px;border-top:1px solid var(--hair)}.tx h4{margin:0 0 4px;font:500 .82rem/1.4 var(--sans);color:var(--muted)}.tx p{margin:0;white-space:pre-line;font-size:.95rem}footer{padding-top:30px;padding-bottom:40px;color:var(--muted);font-size:.88rem}`;

// The public pages' header links, in order.
export const NAV = [["/fly-picker", "Fly Picker"], ["/ai-fly-guide", "AI fly guide"], ["/river-report-tool", "River report tool"], ["/rivers", "Rivers"], ["/shops", "Shops"], ["/guides", "Guides"]];
// Every public page, for the footer: a link from every page to every other is how crawlers and people find them all.
const FOOT = [...PRODUCTS.map((p) => [p.path, p.name]), ...OTHER.map((p) => [p.path, p.name])];

export function layout({ base, path, title, description, image, ld: data, body, noindex, head = "", foot = "", note = "Shop reports are written by the shops and posted by them each week. Fly AI doesn't verify conditions; check flows and regulations before you go." }) {
  const url = base + path;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="${noindex ? "noindex,follow" : "index,follow,max-image-preview:large"}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Fly AI"><meta property="og:locale" content="en_US"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image || base + "/og.png")}">${image ? "" : `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Fly AI: AI fly guide, fly fishing picker and fly shop reports">`}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#F6F8F6">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>${CSS}</style>
${head}
<script type="application/ld+json">${ld(data)}</script>
</head><body>
<header class="site"><a href="/">${BRAND}</a><nav>${NAV.map(([h, t]) => `<a href="${h}">${t}</a>`).join(" ")}</nav></header>
<main>${body}</main>
${foot}
<footer>${esc(note)}<nav aria-label="Fly AI pages">${FOOT.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join(" ")}</nav></footer>
</body></html>`;
}

// ---------- reports ----------

const photoUrl = (base, r) => (r.photo ? base + r.photo : "");
// The photo in words: what the shop's photo shows (written by Fly AI, checked by the shop), or a plain fallback for older reports.
const photoAlt = (r) => r.photoAlt || ((r.shop ? r.shop.name + " " : "") + "fishing report for the " + r.riverName + ", " + dateLong(r.reportedOn));

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
${r.photo ? `<figure><img src="${esc(r.photo)}" alt="${esc(photoAlt(r))}" loading="lazy"></figure>` : ""}
<p>${esc(r.summary)}</p>
${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
${r.tactics ? `<p><strong>Where and how:</strong> ${esc(r.tactics)}</p>` : ""}
${r.transcript ? `<div class="tx"><h4>${r.photo ? "What the shop's report says, as written" : "As written"}</h4><p>${esc(r.transcript)}</p></div>` : ""}
</article>`;
}

function articleLd(base, r, parent, riverId) {
  return {
    "@type": "Article", "@id": `${parent}#r-${r.id}`, headline: r.title, datePublished: r.reportedOn, dateModified: r.reportedOn,
    inLanguage: "en-US", articleBody: r.summary, isPartOf: { "@id": parent },
    ...(r.shop ? { author: { "@type": "Organization", name: r.shop.name, url: `${base}/shops/${r.shop.slug}` } } : {}),
    ...(riverId ? { about: { "@id": riverId } } : {}),
    ...(r.photo ? { image: { "@type": "ImageObject", url: photoUrl(base, r), contentUrl: photoUrl(base, r), description: photoAlt(r) } } : {}),
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

export function riverPage({ base, key, reports, archive, shops, guides = [], now = Date.now() }) {
  const river = RIVERS[key], month = new Date(now).getUTCMonth() + 1, year = new Date(now).getUTCFullYear();
  const path = "/rivers/" + riverSlug(key), riverId = base + path + "#river";
  const latest = reports[0];
  const title = `${river.name} fishing report and what to fish, ${MONTHS[month - 1]} ${year} | Fly AI`;
  const description = latest
    ? trim(`Shop report from ${latest.shop.name}, ${dateLong(latest.reportedOn)}: ${latest.summary}`, 158)
    : trim(`What's hatching and which flies to fish on the ${river.name} in ${MONTHS[month - 1]}, from guide and fly shop reports.`, 158);
  const body = `<h1>${esc(river.name)} fishing report</h1>
<p class="muted">Weekly reports from local fly shops, with what's hatching and which flies to fish this month.</p>
<h2>Shop reports, last ${LIVE_DAYS} days</h2>
${reports.length ? reports.map((r) => reportHtml(base, r)).join("") : `<p>No shop has posted a report for the ${esc(river.name)} in the last ${LIVE_DAYS} days.${shops.length ? " These shops cover it:" : ""}</p>`}
${!reports.length && shops.length ? `<ul class="plain">${shops.map((s) => `<li><a href="/shops/${esc(s.slug)}">${esc(s.name)}</a>${s.city ? ", " + esc(where(s)) : ""}</li>`).join("")}</ul>` : ""}
<p><a class="cta" href="/">Ask a shop in the Fly AI app</a></p>
${guides.length ? `<h2>Guides on the ${esc(river.name)}</h2>
<ul class="plain">${guides.map((g) => `<li><a href="/guides/${esc(g.slug)}">${esc(g.name)}</a>${g.city ? ", " + esc(where(g)) : ""}${tripNames(g.trips).length ? ` <span class="muted">· ${esc(tripNames(g.trips).join(", "))}</span>` : ""}${g.instagrams.length ? ` <span class="muted">· <a href="${esc(igUrl(g.instagrams[0]))}" rel="nofollow noopener">@${esc(g.instagrams[0])}</a></span>` : ""}</li>`).join("")}</ul>
<p class="muted">Guides list themselves and are not verified by Fly AI. <a href="/guides">All guides</a></p>` : ""}
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

export function shopPage({ base, shop, reports, guides = [] }) {
  const path = "/shops/" + shop.slug, shopId = base + path + "#shop";
  const live = reports.filter((r) => r.age <= LIVE_DAYS), old = reports.filter((r) => r.age > LIVE_DAYS);
  const names = shop.rivers.map((k) => RIVERS[k]).filter(Boolean);
  const title = `${shop.name}${shop.city ? ", " + where(shop) : ""}: weekly river reports | Fly AI`;
  const description = trim(reports[0]
    ? `${shop.name} fishing report, ${dateLong(reports[0].reportedOn)}: ${reports[0].summary}`
    : `${shop.name}${shop.city ? " in " + where(shop) : ""}${names.length ? " reports on " + names.map((r) => r.name).join(", ") : ""}.`, 158);
  const body = `<h1>${esc(shop.name)}</h1>
<p class="meta">${esc(where(shop))}${shop.website ? ` · <a href="${esc(shop.website)}" rel="nofollow noopener">${esc(shop.website.replace(/^https:\/\//, ""))}</a>` : ""}${shop.instagram ? ` · <a href="https://www.instagram.com/${esc(shop.instagram)}/" rel="nofollow noopener">@${esc(shop.instagram)}</a>` : ""}</p>
${shop.about ? `<p>${esc(shop.about)}</p>` : ""}
${names.length ? `<p>Reports on ${names.map((r) => `<a href="/rivers/${esc(riverSlug(r.key))}">${esc(r.name)}</a>`).join(", ")}.</p>` : ""}
<p><a class="cta" href="/">Message ${esc(shop.name)} in the Fly AI app</a></p>
${guides.length ? `<p>Guides who list ${esc(shop.name)}: ${guides.map((g) => `<a href="/guides/${esc(g.slug)}">${esc(g.name)}</a>`).join(", ")}. <span class="muted">Guides list themselves; the shop hasn't confirmed this.</span></p>` : ""}
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
  const title = "River fishing reports from local fly shops | Fly AI", description = "Weekly fishing reports from local fly shops, river by river, with what's hatching and which flies to fish.";
  const data = { "@context": "https://schema.org", "@type": "CollectionPage", name: title, description, url: base + "/rivers",
    mainEntity: { "@type": "ItemList", itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, url: `${base}/rivers/${riverSlug(r.key)}`, name: r.name })) } };
  return layout({ base, path: "/rivers", title, description, ld: data, body });
}

export function shopsIndex({ base, shops }) {
  const body = `<h1>Fly shops</h1>
<p class="muted">Local fly shops that post a river report every week.</p>
${shops.length ? `<ul class="plain">${shops.map((s) => `<li><a href="/shops/${esc(s.slug)}">${esc(s.name)}</a>${s.city ? ", " + esc(where(s)) : ""}${s.lastReport ? ` <span class="muted">· last report ${esc(dateLong(s.lastReport))}</span>` : ""}</li>`).join("")}</ul>` : `<p>No shops are listed yet.</p>`}`;
  const title = "Fly shops with weekly river reports | Fly AI", description = "Local fly shops that post a fishing report every week, with what's hatching and which flies are working.";
  const data = { "@context": "https://schema.org", "@type": "CollectionPage", name: title, description, url: base + "/shops",
    mainEntity: { "@type": "ItemList", itemListElement: shops.map((s, i) => ({ "@type": "ListItem", position: i + 1, url: `${base}/shops/${s.slug}`, name: s.name })) } };
  return layout({ base, path: "/shops", title, description, ld: data, body });
}

// ---------- guides ----------

const riverLinks = (g) => (g.rivers || []).map((k) => RIVERS[k]).filter(Boolean);

export function guidePage({ base, guide: g }) {
  const path = "/guides/" + g.slug, id = base + path + "#guide";
  const rivs = riverLinks(g), trips = tripNames(g.trips), sig = signals(g);
  const places = [...rivs.map((r) => r.name), ...(g.waters ? [g.waters] : [])];
  const title = `${g.name}${g.city ? ", " + where(g) : ""}: fly fishing guide${rivs[0] ? " on the " + rivs[0].name : ""} | Fly AI`;
  const description = trim(`${g.name}${g.city ? " in " + where(g) : ""} guides${places.length ? " on " + places.join(", ") : ""}. ${g.about}`, 158);
  const igs = (g.instagrams || []).map((h) => `<a href="${esc(igUrl(h))}" rel="nofollow noopener">@${esc(h)}</a>`);
  const body = `<h1>${esc(g.name)}</h1>
<p class="meta">Fly fishing guide${g.city ? " · " + esc(where(g)) : ""}${g.website ? ` · <a href="${esc(g.website)}" rel="nofollow noopener">${esc(g.website.replace(/^https:\/\//, ""))}</a>` : ""}${igs.length ? " · Instagram " + igs.join(", ") : ""}</p>
<p>${esc(g.about)}</p>
<p><a class="cta" href="/">Message ${esc(g.name)} in the Fly AI app</a></p>
${places.length ? `<h2>Where ${esc(g.name)} guides</h2><ul class="plain">${rivs.map((r) => `<li><a href="/rivers/${esc(riverSlug(r.key))}">${esc(r.name)}</a></li>`).join("")}${g.waters ? `<li>${esc(g.waters)}</li>` : ""}</ul>` : ""}
${trips.length ? `<h2>Trips</h2><ul class="plain">${trips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
${sig.length || (g.shops || []).length ? `<h2>Credentials and ties</h2>
<ul class="plain">${igs.length ? `<li>Instagram: ${igs.join(", ")}</li>` : ""}${g.years ? `<li>${g.years} year${g.years === 1 ? "" : "s"} guiding <span class="muted">(self-reported)</span></li>` : ""}${g.credentials ? `<li>${esc(g.credentials)} <span class="muted">(self-reported)</span></li>` : ""}
${(g.shops || []).map((s) => `<li>Works with ${s.listed ? `<a href="/shops/${esc(s.slug)}">${esc(s.name)}</a>` : esc(s.name) + ` <span class="muted">(not on Fly AI)</span>`}${s.instagram ? ` · <a href="${esc(igUrl(s.instagram))}" rel="nofollow noopener">@${esc(s.instagram)}</a>` : ""}</li>`).join("")}</ul>
<p class="muted">Fly AI doesn't verify these. An Instagram account and the shops a guide names are things you can check yourself.</p>` : ""}`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "LocalBusiness", "@id": id, name: g.name, url: base + path, description: g.about, additionalType: "https://schema.org/SportsActivityLocation",
        address: { "@type": "PostalAddress", ...(g.city ? { addressLocality: g.city } : {}), ...(g.state ? { addressRegion: g.state } : {}), addressCountry: "US" },
        sameAs: [g.website, ...(g.instagrams || []).map(igUrl)].filter(Boolean),
        ...(places.length ? { areaServed: places.map((n) => ({ "@type": "Place", name: n })) } : {}),
        knowsAbout: ["Fly fishing", ...rivs.map((r) => r.name)],
        ...(trips.length ? { makesOffer: trips.map((t) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: t } })) } : {}) },
      { "@type": "WebPage", "@id": base + path, url: base + path, name: title, description, about: { "@id": id }, inLanguage: "en-US" },
    ],
  };
  return layout({ base, path, title, description, ld: data, body, note: "Guide profiles are written by the guides themselves. Fly AI doesn't verify credentials, licenses or availability; ask before you book." });
}

export function guidesIndex({ base, guides }) {
  const body = `<h1>Fly fishing guides</h1>
<p class="muted">Guides who list themselves on Fly AI: where they guide, their Instagram, the shops they work with, and a message button in the app.</p>
${guides.length ? guides.map((g) => `<article class="rep"><h3><a href="/guides/${esc(g.slug)}">${esc(g.name)}</a></h3>
<p class="meta">${esc(where(g))}${g.instagrams.length ? ` · <a href="${esc(igUrl(g.instagrams[0]))}" rel="nofollow noopener">@${esc(g.instagrams[0])}</a>` : ""}</p>
<p>${esc(trim(g.about, 220))}</p>
<p class="muted">${esc([riverLinks(g).map((r) => r.name).join(", "), g.waters, tripNames(g.trips).join(", ")].filter(Boolean).join(" · "))}</p></article>`).join("") : `<p>No guides have listed themselves yet.</p>`}
<p class="muted">Are you a guide? Open the Fly AI app, choose Shops and guides, and add yourself with a Google sign-in.</p>`;
  const title = "Fly fishing guides in Tennessee and beyond | Fly AI", description = "Fly fishing guides who list themselves on Fly AI: rivers, trip types, Instagram and the shops they work with.";
  const data = { "@context": "https://schema.org", "@type": "CollectionPage", name: title, description, url: base + "/guides",
    mainEntity: { "@type": "ItemList", itemListElement: guides.map((g, i) => ({ "@type": "ListItem", position: i + 1, url: `${base}/guides/${g.slug}`, name: g.name })) } };
  return layout({ base, path: "/guides", title, description, ld: data, body, note: "Guide profiles are written by the guides themselves. Fly AI doesn't verify credentials, licenses or availability; ask before you book." });
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function sitemap({ base, shops, guides = [], riverDates }) {
  const urls = [
    { loc: base + "/", lastmod: LANDING_UPDATED }, ...PRODUCTS.map((p) => ({ loc: base + p.path, lastmod: LANDING_UPDATED })), { loc: base + "/rivers" }, { loc: base + "/shops" }, { loc: base + "/guides" }, { loc: base + "/dove-fields", lastmod: DOVE.checked }, { loc: base + "/grouse", lastmod: "2026-05-25" },
    ...DOVE.fields.map((f) => ({ loc: `${base}/dove-fields/${f.slug}`, lastmod: DOVE.checked })),
    ...Object.keys(RIVERS).map((k) => ({ loc: `${base}/rivers/${riverSlug(k)}`, lastmod: riverDates[k] })),
    ...shops.map((s) => ({ loc: `${base}/shops/${s.slug}`, lastmod: s.lastReport })),
    ...guides.map((g) => ({ loc: `${base}/guides/${g.slug}` })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${xml(u.lastmod)}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
}

// Search and AI crawlers are welcome on every public page; /api/ is for the app. A crawler with its own group ignores the "*"
// group, so each one repeats the /api/ rule. Take a name out of this list to opt that crawler out.
const BOTS = ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "GPTBot", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot"];
export const robots = (base) => `User-agent: *\nAllow: /\nDisallow: /api/\n\n${BOTS.map((b) => `User-agent: ${b}\nAllow: /\nDisallow: /api/\n`).join("\n")}\nSitemap: ${base}/sitemap.xml\n`;

export function llms({ base, latest, shops, guides = [] }) {
  const rows = Object.values(RIVERS).sort((a, b) => a.name.localeCompare(b.name));
  return `# ${BRAND}

> ${HOME_DESC}

${BRAND} is a set of AI tools for fly fishing. The fly picker is a rules engine, not a chatbot: it ranks flies from hatch charts and dated reports and cites them. The AI fly guide (the trip planner) is the part that uses a language model, and it lists its sources. Fly shops post weekly river reports that are published here as dated plain-text pages.

## Fishing tools
${PRODUCTS.map((p) => `- [${p.name}](${base}${p.path}): ${p.text}`).join("\n")}
- Trip calendars: private calendars for fishing and hunting clubs, with RSVPs and a thread per trip (in the app at ${base}/).

## River reports
${rows.map((r) => { const l = latest[r.key]; return `- [${r.name}](${base}/rivers/${riverSlug(r.key)}): ${l ? `latest shop report ${l.reportedOn} from ${l.shop.name}. ${trim(l.summary, 220)}` : "no shop report in the last " + LIVE_DAYS + " days; the page lists what's hatching and which flies to fish this month."}`; }).join("\n")}

## Hunting
- [Public dove fields map](${base}/dove-fields): ${DOVE.fields.length} TWRA public dove fields (${DOVE.regions.map((r) => r.name + ", " + r.area).join("; ")}), each with GPS coordinates, directions, crops, permits and ${DOVE.season} hunt days. Checked ${DOVE.checked}.
- [Ruffed grouse in Tennessee: a field report](${base}/grouse): range, decline and habitat, with a map of Christmas Bird Count, eBird and GBIF sightings back to 1966.

## Fly fishing guides
${guides.length ? guides.map((g) => `- [${g.name}](${base}/guides/${g.slug})${g.city ? ": " + where(g) : ""}${g.rivers.length ? "; guides on " + g.rivers.map((k) => (RIVERS[k] || {}).name).filter(Boolean).join(", ") : ""}${g.instagrams.length ? "; Instagram @" + g.instagrams[0] : ""}`).join("\n") : "- None listed yet."}

## Fly shops
${shops.length ? shops.map((s) => `- [${s.name}](${base}/shops/${s.slug})${s.city ? ": " + where(s) : ""}`).join("\n") : "- None listed yet."}

## Notes
- Guide profiles are written by the guides and are not verified by Fly AI.
- Shop reports are written by the shops and are labeled with the shop and the report date. A shop photographs its weekly whiteboard; Fly AI transcribes it into a written report for each river on it and describes the photo in words, and the shop checks the text before it is published. Reports older than ${LIVE_DAYS} days are archived with their date.
- The Fly Picker ranks flies from hatch charts and dated reports gathered from public posts by shops, guides and blogs. Reports that shops post on Fly AI appear beside it in a "From the shops" card and do not change the ranking.
- Nothing on this site is a guarantee of conditions. Check flows, closures and regulations with the agency or the dam operator.
`;
}

export { ageDays };
