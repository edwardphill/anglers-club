// One place for the product name and the words the home page, the public pages and the app all use,
// so a rename or a rewording is a one-file change. Used by lib/pages.js, lib/landing.js and scripts/build.mjs.
export const BRAND = "Fly AI";
export const HOME_TITLE = "Fly AI: AI fly guide, AI fly fishing picker and fly shop reports";
export const HOME_DESC = "AI fly guide and fly fishing picker: ranks flies by river and date from hatch charts and dated shop reports, with sources. Plus a river report tool that turns a shop's whiteboard photo into text.";
export const TAGLINE = "AI tools for fly fishing";
export const LANDING_UPDATED = "2026-11-11"; // bump when a product page changes: it is the sitemap lastmod

// The tools, in the order the home page and the footers list them. `path` is a public page; `app` marks a tool that
// lives inside a club in the app and has no page of its own.
export const PRODUCTS = [
  { name: "AI fly fishing picker", short: "Fly Picker", path: "/fly-picker", text: "Which flies to tie on, ranked for your river and date from hatch charts and dated shop and guide reports." },
  { name: "AI fly guide", short: "AI fly guide", path: "/ai-fly-guide", text: "Ask where and when to fish. The answer weighs hatches, stocking, dam generation, weather and recent reports, and links its sources." },
  { name: "River report tool", short: "River report tool", path: "/river-report-tool", text: "A fly shop photographs its weekly whiteboard; Fly AI transcribes it into a dated, written river report for each river on it, and the shop checks and publishes." },
  { name: "Fly shop AI discoverability", short: "For fly shops", path: "/for-shops", text: "A fly shop's weekly river report, published as plain dated text that search engines and AI tools can read." },
];
export const OTHER = [
  { name: "River reports", path: "/rivers" }, { name: "Fly shops", path: "/shops" }, { name: "Fly fishing guides", path: "/guides" },
  { name: "Public Tennessee dove fields", path: "/dove-fields" }, { name: "Tennessee grouse map", path: "/grouse" },
];

// schema.org for the home page and the product pages: the organization and the site, once, so every page names the same entity.
export const orgLd = (base) => ({ "@type": "Organization", "@id": base + "/#org", name: BRAND, url: base + "/", logo: base + "/apple-touch-icon.png" });
export const siteLd = (base) => ({ "@type": "WebSite", "@id": base + "/#site", name: BRAND, url: base + "/", description: HOME_DESC, inLanguage: "en-US", publisher: { "@id": base + "/#org" } });
export const faqLd = (items) => ({ "@type": "FAQPage", mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
