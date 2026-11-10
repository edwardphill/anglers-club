// The Trip Planner: a member asks where and when to fish; Claude answers from the club's own data
// (the Fly Picker's hatch model and reports, the state stocking schedule, the club's trip reports
// and planned trips) plus a few targeted web searches for what changes daily (dam generation,
// flows, weather, fresh reports). Answers stream back to the page as newline-delimited JSON.
import { createRequire } from "node:module";
import { q } from "./db.js";
import FP from "./fp-engine.cjs";

const require = createRequire(import.meta.url);
const FPDATA = require("../data/flypicker.json");
const STOCK = require("../data/stocking-tn.json");

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTH.map((m) => m.slice(0, 3));

export const MODEL = () => process.env.PLANNER_MODEL || "claude-sonnet-5-5";
const API = () => (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages";

/* ---------- dates ---------- */
export function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const longDate = (s) => parseD(s).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = (s) => parseD(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function miles(a, b) {
  const r = 3958.8, rad = Math.PI / 180, p1 = a.lat * rad, p2 = b.lat * rad;
  const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(x)));
}

/* ---------- the club's data, as compact text for the prompt ---------- */
function flyPickerSection(club, t0) {
  const month = Number(t0.slice(5, 7));
  const rivers = Object.entries(FPDATA.rivers).filter(([, r]) => r.region === club.region);
  const lines = [`## What's eating (the club's Fly Picker, ${MONTH[month - 1]})`,
    "Modeled from the season, typical water temperature, and fishing reports. Each fly lists the reports that named it."];
  const one = (req, label) => {
    const r = FP.recommend({ fly_type: "any", water_temp_f: null, sky: "partly", windy: false, flow: "normal", date: t0, ...req });
    lines.push(`### ${label} (typical water ${r.conditions.water_temp_f}°F)`);
    lines.push("Eating: " + r.eating.slice(0, 6).map((f) => `${f.name} ${Math.round(f.share * 100)}%`).join(", "));
    for (const f of r.flies.slice(0, 7)) {
      const src = (f.sources?.items || []).slice(0, 2).map((s) => `[${s.site}, ${s.date}](${s.url})`).join("; ");
      lines.push(`- ${f.name} ${f.sizes || ""} (${f.family}): ${f.reason}${src ? `. Reports: ${src}` : ""}`);
    }
  };
  for (const [id, river] of rivers) {
    one({ river: id }, `${river.label || river.name}: ${river.place || ""}`);
    const notes = (river.hatch_notes || []).filter((n) => (n.months || []).includes(month));
    for (const n of notes) lines.push(`- Note: ${n.text} ([${n.source}, ${n.date}](${n.url}))`);
  }
  const types = club.region === "south" ? ["tailwater", "freestone", "small_stream"] : ["freestone", "tailwater"];
  for (const wt of types) one({ region: club.region, water_type: wt }, `Any ${FPDATA.water_types[wt]?.name || wt} in the ${club.region} region`);
  return lines.join("\n");
}

function stockingSection(club, t0) {
  if (club.state !== STOCK.state) return "";
  const evEnd = (e) => (e[1] === "week" ? addDays(e[0], 5) : e[0]);
  const label = (e) => (e[1] === "week" ? `week of ${shortDate(e[0])}` : shortDate(e[0]));
  const month = Number(t0.slice(5, 7));
  const rows = [];
  for (const L of STOCK.waters) {
    const mi = miles(club, L);
    if (mi > 175) continue;
    const recent = L.ev.filter((e) => evEnd(e) < t0 && e[0] >= addDays(t0, -35));
    const next = L.ev.filter((e) => evEnd(e) >= t0 && e[0] <= addDays(t0, 45)).slice(0, 3);
    const monthly = [...new Set(L.months.flatMap((m) => m[1]))].sort((a, b) => a - b);
    if (!recent.length && !next.length && !monthly.includes(month)) continue;
    const bits = [];
    if (recent.length) bits.push("stocked " + recent.slice(-2).map(label).join(", "));
    if (next.length) bits.push("next " + next.map(label).join(", "));
    if (monthly.length) bits.push("stocked monthly in " + monthly.map((m) => MON[m - 1]).join(", "));
    rows.push({ mi, line: `- ${L.name} (${L.county} Co., ${mi} mi from the club; ${L.types.join(", ")}; ${L.species.join(", ")}): ${bits.join("; ")}` });
  }
  rows.sort((a, b) => a.mi - b.mi);
  return [`## Stocking (${STOCK.agency} ${STOCK.season} schedule, ${STOCK.source})`,
    `"Week of" dates are Sundays; the stocking happens within five days. Waters within 175 miles with a stocking in the last five weeks or the next six:`,
    ...rows.slice(0, 45).map((r) => r.line)].join("\n");
}

async function clubSection(club, t0) {
  const [reports, trips] = await Promise.all([
    q(`select t.water, t.title, t.date, t.kind, r.worked, r.count, r.cond, r.notes, m.handle
       from reports r join trips t on t.id = r.trip_id left join members m on m.id = r.member_id
       where r.club_id = $1 and t.date >= $2 order by t.date desc limit 25`, [club.id, addDays(t0, -120)]),
    q(`select t.water, t.title, t.date, t.time, t.seats, m.handle as host,
         (select count(*) from rsvps v where v.trip_id = t.id and v.status = 'in')::int as ins
       from trips t left join members m on m.id = t.host_id
       where t.club_id = $1 and t.date >= $2 and t.date <= $3 and not t.canceled and t.kind = 'fish'
       order by t.date, t.time limit 20`, [club.id, t0, addDays(t0, 21)]),
  ]);
  const lines = ["## The club's recent trip reports"];
  if (!reports.length) lines.push("None in the last four months.");
  for (const r of reports) {
    const bits = [r.worked && `worked: ${r.worked}`, r.count !== null && r.count !== undefined && `${r.count} ${r.kind === "hunt" ? "harvested" : "fish"}`, r.cond && `conditions: ${r.cond}`, r.notes && `notes: ${String(r.notes).slice(0, 240)}`].filter(Boolean);
    lines.push(`- ${shortDate(r.date)}, ${r.title || r.water}${r.title && r.water ? ` (${r.water})` : ""}, ${r.handle || "a member"}: ${bits.join("; ")}`);
  }
  lines.push("", "## Fishing trips members have planned (next three weeks)");
  if (!trips.length) lines.push("None.");
  for (const t of trips) {
    const seats = t.seats === null || t.seats === undefined ? "open invite" : `${Math.max(0, t.seats - t.ins)} of ${t.seats} seats open`;
    lines.push(`- ${shortDate(t.date)}${t.time ? " " + t.time : ""}: ${t.title || t.water}${t.title && t.water ? ` (${t.water})` : ""}, hosted by ${t.host || "a member"}, ${seats}`);
  }
  return lines.join("\n");
}

export async function buildContext(club, t0) {
  const waters = Array.isArray(club.waters) ? club.waters : [];
  return [
    `# ${club.name}, ${club.city}, ${club.state}`,
    `Club location: ${club.lat}, ${club.lon}. Home waters: ${waters.length ? waters.join(", ") : "not listed"}.`,
    `Today: ${longDate(t0)}. Tomorrow: ${longDate(addDays(t0, 1))}.`,
    "",
    flyPickerSection(club, t0),
    "",
    stockingSection(club, t0),
    "",
    await clubSection(club, t0),
  ].filter((x) => x !== null).join("\n");
}

export function systemPrompt(club, t0) {
  return `You are the Trip Planner for the ${club.name}, a private club of friends around ${club.city}, ${club.state} who fish together. Members ask where and when to go fishing. Answer like a well-informed friend at the local fly shop: direct, specific and brief.

Today is ${longDate(t0)} in ${club.tz}. Work out the exact date the member means ("tomorrow", "Saturday", "this weekend") from that.

Start from the club data in the member's message: the Fly Picker's hatch model and the fishing reports behind it, the state stocking schedule, and the club's own trip reports and planned trips. Then use web search, and fetch a page when a search result isn't enough, for what changes day to day and isn't in the data:
- dam release or generation schedules for tailwaters (TVA posts them for its dams, such as Tims Ford on the Elk River, Normandy on the Duck, and the East Tennessee tailwaters; the US Army Corps of Engineers, Nashville District, runs Center Hill on the Caney Fork and Dale Hollow on the Obey),
- current flows or gauge heights (USGS),
- the weather forecast for the day in question,
- fishing reports from the last few weeks.
Keep searches few and targeted. If you can't find a generation schedule or a flow, say so plainly and say where to check. Never guess release times, flows or stocking dates.

Write it in this shape:
1. A first line with the pick: which water, which day, and what time of day.
2. Short sections with bold labels: **Why**, **What's eating**, **Stocking**, **Water and weather**, **Flies to bring**. Leave out a section that has nothing useful.
3. When two choices are close, say what would change your mind (for example, "if they generate before noon, go to the Elk instead").
Stay under about 250 words. Use markdown: bold labels, short bullet lists, and links. When a fact comes from the club data and has a URL there, link it as a markdown link. When generation matters on a tailwater, remind them the water rises fast once it starts. If a member already has a trip planned that fits, say so. If the question isn't about fishing, help briefly anyway.`;
}

/* ---------- Claude, streamed ---------- */
// Calls the Messages API with web search and web fetch, and turns its event stream into the
// small events the page reads: {t:"status"|"text"|"cite"|"error"|"done"}.
export async function streamAnswer({ system, messages, club, send, deadline }) {
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 4,
      user_location: { type: "approximate", city: club.city, country: "US", timezone: club.tz } },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 3, citations: { enabled: true }, max_content_tokens: 12000 },
  ];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(5000, deadline - Date.now()));
  let res;
  try {
    res = await fetch(API(), {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL(), max_tokens: 6000, system, messages, tools, stream: true }),
    });
  } catch (e) {
    clearTimeout(timer);
    send({ t: "error", v: ctrl.signal.aborted ? "That took too long. Try a narrower question." : "Couldn't reach Claude. Try again in a minute." });
    return;
  }
  if (!res.ok) {
    clearTimeout(timer);
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    console.error("planner: anthropic", res.status, detail);
    const msg = res.status === 401 ? "The Anthropic API key in Vercel isn't valid. Check ANTHROPIC_API_KEY."
      : res.status === 429 || res.status === 529 ? "Claude is busy right now. Try again in a minute."
      : /web search|web_search|web fetch|web_fetch/i.test(detail) ? "Web search is turned off for this Anthropic account. Turn it on in the Claude Console under Privacy settings."
      : "Claude couldn't answer that one. Try again.";
    send({ t: "error", v: msg });
    return;
  }

  const blocks = {};   // index -> { type, name, json }
  const dec = new TextDecoder();
  let buf = "", stop = "";
  const handle = (ev) => {
    if (ev.type === "content_block_start") {
      const b = ev.content_block || {};
      blocks[ev.index] = { type: b.type, name: b.name, json: "" };
      if (b.type === "server_tool_use") send({ t: "status", v: b.name === "web_fetch" ? "Reading a page" : "Searching the web" });
    } else if (ev.type === "content_block_delta") {
      const d = ev.delta || {}, b = blocks[ev.index];
      if (d.type === "text_delta" && d.text) send({ t: "text", v: d.text });
      else if (d.type === "citations_delta" && d.citation?.url) send({ t: "cite", url: d.citation.url, title: d.citation.title || "" });
      else if (d.type === "input_json_delta" && b) b.json += d.partial_json || "";
    } else if (ev.type === "content_block_stop") {
      const b = blocks[ev.index];
      if (b && b.type === "server_tool_use") {
        try {
          const input = JSON.parse(b.json || "{}");
          if (input.query) send({ t: "status", v: `Searching: ${input.query}` });
          else if (input.url) send({ t: "status", v: `Reading ${input.url.replace(/^https?:\/\//, "").slice(0, 70)}` });
        } catch {}
      }
    } else if (ev.type === "message_delta") {
      stop = ev.delta?.stop_reason || stop;
    } else if (ev.type === "error") {
      send({ t: "error", v: ev.error?.type === "overloaded_error" ? "Claude is busy right now. Try again in a minute." : "Claude stopped partway. Try again." });
    }
  };
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (!data) continue;
        try { handle(JSON.parse(data)); } catch {}
      }
    }
  } catch (e) {
    send({ t: "error", v: ctrl.signal.aborted ? "That took too long, so the answer stops here. Try a narrower question." : "The answer was cut off. Try again." });
  } finally {
    clearTimeout(timer);
  }
  if (stop === "max_tokens") send({ t: "status", v: "The answer hit its length limit." });
  if (stop === "pause_turn") send({ t: "status", v: "Claude ran out of searches before finishing." });
}
