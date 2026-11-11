// Public pages for search engines and AI answers, served as plain HTML (not the app): a page per river and per
// shop, a directory of each, sitemap.xml, robots.txt and llms.txt. vercel.json rewrites the clean URLs to
// /api/page?kind=...; the markup lives in lib/pages.js. Only published reports from active shops appear.
//
//   /rivers  /rivers/south-holston  /shops  /shops/<slug>  /sitemap.xml  /robots.txt  /llms.txt  /photos/<id>.jpg (api/shops.js)
import { q, ensureSchema } from "../lib/db.js";
import { str } from "../lib/http.js";
import { LIVE_DAYS, DAY, ymd, shopOut, reportOut, REPORT_COLS } from "../lib/shops.js";
import { riverPage, shopPage, riversIndex, shopsIndex, sitemap, robots, llms, riverKey } from "../lib/pages.js";

// Where the pages say they live (canonical links, sitemap, JSON-LD): SITE_URL, else the production domain
// Vercel provides, else the host the request came to.
function baseUrl(req) {
  const set = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "");
  if (set) return set.replace(/\/+$/, "");
  const host = String((req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "angler-club.vercel.app").split(",")[0].trim().replace(/[^A-Za-z0-9.:-]/g, "");
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  return (local ? "http://" : "https://") + host;
}

const liveCut = (now) => ymd(now - LIVE_DAYS * DAY);
const FROM = "from shop_reports r join fly_shops s on s.id = r.shop_id";

async function activeShops() {
  return (await q(
    `select s.*, (select max(r.reported_on) from shop_reports r where r.shop_id = s.id and r.status = 'live') as last_report
       from fly_shops s where s.status = 'active' order by s.name limit 300`,
  )).map(shopOut);
}

async function latestByRiver(now) {
  const rows = await q(
    `select distinct on (r.river) ${REPORT_COLS} ${FROM}
      where r.status = 'live' and s.status = 'active' and r.reported_on >= $1 order by r.river, r.reported_on desc, r.at desc`,
    [liveCut(now)],
  );
  return Object.fromEntries(rows.map((r) => [r.river, reportOut(r)]));
}

const notFound = (what) => ({ status: 404, type: "text/html; charset=utf-8", cache: "public, s-maxage=60", body: `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found | Anglers Club</title><body style="font:18px Georgia,serif;max-width:560px;margin:60px auto;padding:0 18px"><h1>${what} isn't here</h1><p><a href="/rivers">Rivers</a> · <a href="/shops">Shops</a> · <a href="/">Anglers Club</a></p>` });

async function build(req) {
  const now = Date.now(), base = baseUrl(req);
  const kind = str(req.query && req.query.kind, 20);
  const html = (body) => ({ status: 200, type: "text/html; charset=utf-8", cache: "public, s-maxage=300, stale-while-revalidate=3600", body });

  if (kind === "robots") return { status: 200, type: "text/plain; charset=utf-8", cache: "public, s-maxage=3600", body: robots(base) };

  await ensureSchema();

  if (kind === "river") {
    const key = riverKey(str(req.query.key, 60));
    if (!key) return notFound("That river");
    const cut = liveCut(now);
    // One at a time: the database connection is a single one, and a stalled statement is cut and retried alone.
    const live = await q(`select ${REPORT_COLS} ${FROM} where r.river = $1 and r.status = 'live' and s.status = 'active' and r.reported_on >= $2
          order by r.reported_on desc, r.at desc limit 10`, [key, cut]);
    const old = await q(`select ${REPORT_COLS} ${FROM} where r.river = $1 and r.status = 'live' and s.status = 'active' and r.reported_on < $2
          order by r.reported_on desc, r.at desc limit 12`, [key, cut]);
    const shops = await q(`select * from fly_shops s where s.status = 'active' and s.rivers @> jsonb_build_array($1::text) order by s.name limit 20`, [key]);
    return html(riverPage({ base, key, reports: live.map(reportOut), archive: old.map(reportOut), shops: shops.map(shopOut), now }));
  }
  if (kind === "shop") {
    const [s] = await q("select * from fly_shops where slug = $1 and status = 'active'", [str(req.query.slug, 60).toLowerCase()]);
    if (!s) return notFound("That shop");
    const rows = await q(`select ${REPORT_COLS} ${FROM} where r.shop_id = $1 and r.status = 'live' order by r.reported_on desc, r.at desc limit 60`, [s.id]);
    return html(shopPage({ base, shop: shopOut(s), reports: rows.map(reportOut) }));
  }
  if (kind === "rivers") return html(riversIndex({ base, latest: await latestByRiver(now) }));
  if (kind === "shops") return html(shopsIndex({ base, shops: await activeShops() }));
  if (kind === "sitemap") {
    const shops = await activeShops();
    const dates = await q(`select r.river, max(r.reported_on) as d ${FROM} where r.status = 'live' and s.status = 'active' group by r.river`);
    return { status: 200, type: "application/xml; charset=utf-8", cache: "public, s-maxage=3600", body: sitemap({ base, shops, riverDates: Object.fromEntries(dates.map((r) => [r.river, r.d])) }) };
  }
  if (kind === "llms") {
    const shops = await activeShops();
    const latest = await latestByRiver(now);
    return { status: 200, type: "text/plain; charset=utf-8", cache: "public, s-maxage=3600", body: llms({ base, latest, shops }) };
  }
  return notFound("That page");
}

export default async function (req, res) {
  let out;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") out = { status: 405, type: "text/plain; charset=utf-8", cache: "no-store", body: "Method not allowed" };
    else out = await build(req);
  } catch (e) {
    console.error(e);
    out = { status: 500, type: "text/plain; charset=utf-8", cache: "no-store", body: "Something went wrong on the server. Try again in a moment." };
  }
  res.statusCode = out.status;
  res.setHeader("Content-Type", out.type);
  res.setHeader("Cache-Control", out.cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(req.method === "HEAD" ? undefined : out.body);
}
