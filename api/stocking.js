// GET /api/stocking?state=GA: every stocking Georgia's weekly report has listed so far (day, county, water as printed, the
//      frequency-sheet water it matched, Delayed Harvest or not) and when the report was last read. Public.
// GET /api/stocking?refresh=1: reads this week's report. Vercel's daily schedule does this; so does the site admin
//      (add &force=1 to skip the three-hour pause). Anyone else gets a 403, so a visitor can never start a model call.
import { route, HttpError } from "../lib/http.js";
import { ensureSchema } from "../lib/db.js";
import { currentUser } from "../lib/auth.js";
import { isAdmin } from "../lib/shops.js";
import { readEvents, refresh } from "../lib/gastock.js";

function fromSchedule(req) {
  const h = req.headers || {};
  if (process.env.CRON_SECRET) return String(h.authorization || "") === `Bearer ${process.env.CRON_SECRET}`;
  return /^vercel-cron\//i.test(String(h["user-agent"] || ""));
}

export default route(["GET"], async (req) => {
  await ensureSchema();
  const u = new URL(req.url, "http://x");
  if (u.searchParams.get("refresh")) {
    const admin = isAdmin(await currentUser(req));
    if (!admin && !fromSchedule(req)) throw new HttpError(403, "Only the site admin or the daily schedule can read the stocking report.");
    return refresh({ force: admin && u.searchParams.get("force") === "1" });
  }
  if (String(u.searchParams.get("state") || "GA").toUpperCase() !== "GA") throw new HttpError(404, "Dated stockings are only collected for Georgia; Tennessee's schedule comes with the page.");
  return readEvents();
});
