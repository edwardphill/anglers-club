// Georgia says when it stocked, not when it will: the Weekly Trout Stocking Report, a PDF the state replaces every week.
// This reads each week's report (Claude transcribes the table; the checks below are plain code), keeps every stocking
// with the date printed, matches it to a water on the frequency sheet only where name and county agree, and leaves the
// rest as printed. Nothing here predicts a date. data/stocking-ga.json is the frequency sheet.
import { createRequire } from "node:module";
import { q, ensureSchema } from "./db.js";

const require = createRequire(import.meta.url);
const D = require("../data/stocking-ga.json");

const API = () => (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages";
export const STOCKING_MODEL = () => process.env.STOCKING_MODEL || process.env.PLANNER_MODEL || "claude-sonnet-5-5";
const GAP = 3 * 3600e3;   // the report is checked at most every three hours, however it is asked

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, "0");
// "5/12/2026" -> "2026-05-12", or "" when it isn't a real date.
export function isoDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  if (!m) return "";
  const [mo, d, y] = [+m[1], +m[2], +m[3]], t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : "";
}
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d)); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/* ---------- reading the report ---------- */
// What the transcription is asked to produce: the week's date range, then one "date|county|water" line per table row.
export const PROMPT = `This PDF is the Georgia DNR Wildlife Resources Division "Weekly Trout Stocking Report". Transcribe it exactly, with no other text.
First line: WEEK|<first date>|<last date>, the date range in the report's title, as M/D/YYYY.
Then one line for every row of the table, in order: <date>|<county>|<waterbody>
Copy each date, county and water name exactly as printed, including suffixes such as (DH), (F) or (WMA) and any spelling you think is wrong. Do not correct, merge, skip, reorder or add rows. If a row has no date, skip it. If the PDF has no table, output only the first line.`;

const COUNTY = /^[A-Za-z][A-Za-z .'-]{1,30}(?:\s*\/\s*[A-Za-z][A-Za-z .'-]{1,30})?$/;
// Turns the transcription into rows. A row that doesn't hold up (a date outside the week the report names, a typo like a
// year of 1932, a county that isn't a county) is set aside and counted, never repaired.
export function parseReport(text, today = new Date().toISOString().slice(0, 10)) {
  let from = "", to = "";
  const rows = [], skipped = [], seen = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/[ \t]+/g, " ").trim();
    if (!line) continue;
    const wk = /^WEEK\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(line)
      || /Weekly Trout Stocking Report:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(line);
    if (wk) {
      if (!from) {
        const a = isoDate(wk[1]), b = isoDate(wk[2]);
        // A week is at most two weeks long; a title that says otherwise (a typo in the year, say) is not trusted as the range.
        if (a && b && b >= a && b <= addDays(a, 14)) { from = a; to = b; }
      }
      continue;
    }
    const m = /^\|?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|?$/.exec(line)
      || /^(\d{1,2}\/\d{1,2}\/\d{4})\s+([A-Za-z]+(?:\s*\/\s*[A-Za-z]+)?)\s+(\S.*)$/.exec(line);
    if (!m) continue;   // a heading, a table rule, anything that isn't a row
    const day = isoDate(m[1]);
    const county = m[2].replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
    const water = m[3].replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    let why = "";
    if (!day) why = "date";
    else if (!COUNTY.test(county)) why = "county";
    else if (water.length < 2 || water.length > 80) why = "water";
    else if (from && to ? day < from || day > to : day < addDays(today, -400) || day > addDays(today, 14)) why = "outside the week";
    if (why) { skipped.push({ line, why }); continue; }
    const key = day + "|" + county + "|" + water;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ day, county, water });
  }
  return { from, to, rows, skipped };
}

/* ---------- matching to the frequency sheet ---------- */
// Names the report prints differently from the sheet, each one the same water in the same county. Anything not listed
// here has to match by its words alone; when it doesn't, it stays a separate row as printed.
const ALIAS = {
  "blueridge tailwaters": "blue ridge tailwaters", "middle broad river": "middle fork broad river",
  "west fork chattooga river": "west fork chattooga", "west armuchee": "west armuchee creek", "west armurchee creek": "west armuchee creek",
  "cartercay river": "cartecay river", "coosawatee river": "coosawattee river", "elijay river": "ellijay river",
  "black rock lake": "blackrock lake", "racoon creek": "raccoon creek", "little cedar": "little cedar creek",
};
export function norm(name) {
  let s = String(name).toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[.']/g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\s\d+$/, "");   // "Mill Creek - 1"
  s = s.split(" ").map((t, i, a) => (t === "tw" || t === "tailwater" ? "tailwaters" : t === "cr" ? "creek" : t === "rv" || (t === "r" && i === a.length - 1) ? "river" : t === "wf" ? "west fork" : t === "mf" ? "middle fork" : t)).join(" ");
  return ALIAS[s] || s;
}
const BY_NAME = new Map();
D.waters.forEach((w, i) => { const k = norm(w.name); BY_NAME.set(k, [...(BY_NAME.get(k) || []), i]); });
// The index of the sheet's water for a reported (county, water), or null. Both name and county have to agree, and a name
// that fits two waters in the county list is not guessed at.
export function matchWater(county, water) {
  const cs = new Set(String(county).toLowerCase().split("/").map((c) => c.trim()));
  const hits = (BY_NAME.get(norm(water)) || []).filter((i) => D.waters[i].county.toLowerCase().split(", ").some((c) => cs.has(c)));
  return hits.length === 1 ? hits[0] : null;
}
export const isDH = (water) => /\bDH\b/i.test(water);

/* ---------- fetching and saving ---------- */
async function fetchReport() {
  const res = await fetch(D.weekly, { headers: { "user-agent": "FlyAI stocking reader" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error("fetch " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200 || buf.length > 8e6 || buf.subarray(0, 5).toString() !== "%PDF-") throw new Error("not a pdf");
  return buf;
}
async function transcribe(pdf) {
  const res = await fetch(API(), {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: STOCKING_MODEL(), max_tokens: 6000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
        { type: "text", text: PROMPT },
      ] }],
    }),
    signal: AbortSignal.timeout(55000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error("model " + res.status);
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}
async function finish(now, f) {
  await q(
    `update ga_stocking_runs set ok = $2, ok_at = case when $2 then $1 else ok_at end, week = $3, rows = $4, skipped = $5, error = $6 where id = 1`,
    [now, !!f.ok, f.week || "", f.rows || 0, f.skipped || 0, f.error || ""],
  );
  return f;
}
// Reads this week's report and saves its stockings. At most once every three hours (force skips that, for the admin).
export async function refresh({ force = false, now = Date.now(), today } = {}) {
  await ensureSchema();
  await q("insert into ga_stocking_runs (id) values (1) on conflict do nothing");
  const [claim] = await q("update ga_stocking_runs set at = $1 where id = 1 and at <= $2 returning at", [now, force ? now : now - GAP]);
  if (!claim) return { ok: true, skipped: "checked recently" };
  if (!process.env.ANTHROPIC_API_KEY) return finish(now, { ok: false, error: "no model key" });
  let parsed;
  try {
    const text = await transcribe(await fetchReport());
    parsed = parseReport(text, today || new Date(now).toISOString().slice(0, 10));
  } catch (e) { return finish(now, { ok: false, error: String(e.message || e).slice(0, 80) }); }
  const week = parsed.from && parsed.to ? `${parsed.from} to ${parsed.to}` : "";
  if (!parsed.rows.length) return finish(now, { ok: false, week, skipped: parsed.skipped.length, error: parsed.skipped.length ? "every row was set aside" : "no rows read" });
  for (let i = 0; i < parsed.rows.length; i += 100) {
    const part = parsed.rows.slice(i, i + 100), args = [];
    const values = part.map((r, j) => { args.push(r.day, r.county, r.water, parsed.from, parsed.to, now); return `($${j * 6 + 1},$${j * 6 + 2},$${j * 6 + 3},$${j * 6 + 4},$${j * 6 + 5},$${j * 6 + 6})`; });
    await q(`insert into ga_stockings (day, county, water, week_from, week_to, seen) values ${values.join(",")}
             on conflict (day, county, water) do update set week_from = excluded.week_from, week_to = excluded.week_to, seen = excluded.seen`, args);
  }
  return finish(now, { ok: true, week, rows: parsed.rows.length, skipped: parsed.skipped.length });
}

// Every stocking saved so far, newest first, each with the sheet's water it matched (an index into data/stocking-ga.json
// waters, or null), and when the report was last read. Public: it is the state's own report.
export async function readEvents() {
  await ensureSchema();
  const rows = await q("select day, county, water from ga_stockings order by day desc, county, water limit 3000");
  const [run] = await q("select at, ok, ok_at, week, rows, skipped from ga_stocking_runs where id = 1");
  return {
    events: rows.map((r) => ({ day: r.day, county: r.county, water: r.water, w: matchWater(r.county, r.water), dh: isDH(r.water) })),
    run: run ? { checkedAt: run.at, ok: !!run.ok, okAt: run.ok_at || null, week: run.week, rows: run.rows, skipped: run.skipped } : null,
  };
}
