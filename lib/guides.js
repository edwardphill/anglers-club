// Guides: the rules and helpers behind the guide side of api/shops.js, the public /guides pages and the Trip Planner.
// A guide adds themself (a Google sign-in, one profile each): where they guide, their Instagram and the shops they work
// with, then anglers message them in the app. Instagram and shop ties are shown as credibility signals, never verified.
import { RIVERS, slugify, clean, oneLine } from "./shops.js";
import { HttpError } from "./http.js";

export const TRIPS = { wade: "Wade trips", float: "Float trips", beginner: "Beginner lessons", family: "Kids and families", multiday: "Multi-day trips" };
export const tripNames = (keys) => (keys || []).map((k) => TRIPS[k]).filter(Boolean);

export const igUrl = (h) => `https://www.instagram.com/${h}/`;
const IG = /^[A-Za-z0-9._]{1,30}$/;

// "@name", "name", or a pasted profile link all become "name". Returns "" for blank, null for something that isn't a handle.
export function igHandle(v) {
  let t = oneLine(typeof v === "string" ? v : "", 120);
  if (!t) return "";
  const m = t.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
  if (m) t = m[1];
  t = t.replace(/^@/, "");
  return IG.test(t) ? t : null;
}

// Midpoint of the rivers a guide covers: a rough "home water" used to say who is near a trip. null with no rivers.
export function centerOf(riverKeys) {
  const pts = riverKeys.map((k) => RIVERS[k]).filter((r) => r && Number.isFinite(r.lat) && Number.isFinite(r.lon));
  if (!pts.length) return { lat: null, lon: null };
  const avg = (f) => Math.round((pts.reduce((a, r) => a + r[f], 0) / pts.length) * 1e4) / 1e4;
  return { lat: avg("lat"), lon: avg("lon") };
}

// Clean profile fields from a form. Anything unusable is an error the guide can fix; nothing is guessed.
export function guideFields(b) {
  const website = oneLine(b.website, 200);
  if (website && !/^https:\/\/[^\s]+$/.test(website)) throw new HttpError(400, "A website starts with https://");
  const rawIg = (Array.isArray(b.instagrams) ? b.instagrams : [b.instagram]).filter((x) => typeof x === "string" && x.trim());
  const instagrams = [];
  for (const x of rawIg.slice(0, 3)) {
    const h = igHandle(x);
    if (h === null) throw new HttpError(400, "An Instagram name is letters, numbers, dots and underscores (or paste the profile link).");
    if (h && !instagrams.some((y) => y.toLowerCase() === h.toLowerCase())) instagrams.push(h);
  }
  const state = oneLine(b.state, 20).toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) throw new HttpError(400, "Use the two-letter state.");
  const rivers = [...new Set((Array.isArray(b.rivers) ? b.rivers : []).filter((k) => typeof k === "string" && RIVERS[k]))].slice(0, 12);
  const trips = [...new Set((Array.isArray(b.trips) ? b.trips : []).filter((k) => typeof k === "string" && Object.hasOwn(TRIPS, k)))];
  let years = null;
  if (b.years !== undefined && b.years !== null && b.years !== "") {
    years = Number(b.years);
    if (!Number.isInteger(years) || years < 0 || years > 70) throw new HttpError(400, "Years guiding is a whole number from 0 to 70.");
  }
  const shops = [];
  for (const s of (Array.isArray(b.shops) ? b.shops : []).slice(0, 6)) {
    if (!s || typeof s !== "object") continue;
    const slug = oneLine(s.slug, 60).toLowerCase(), name = oneLine(s.name, 80);
    const ig = igHandle(typeof s.instagram === "string" ? s.instagram : "");
    if (ig === null) throw new HttpError(400, "A shop's Instagram name is letters, numbers, dots and underscores.");
    if (!slug && !name) continue;
    shops.push({ ...(slug ? { slug } : {}), ...(name ? { name } : {}), ...(ig ? { instagram: ig } : {}) });
  }
  return {
    name: oneLine(b.name, 80), city: oneLine(b.city, 60), state, website, instagrams,
    about: clean(b.about, 700), rivers, waters: oneLine(b.waters, 160), trips, years,
    credentials: oneLine(b.credentials, 140), shops, ...centerOf(rivers),
  };
}

export const guideSlug = (name) => { let s = slugify(name) || "guide"; if (s.length < 3) s += "-guide"; return s; };

// What the API and the pages see. `shops` is already resolved (see resolveShops); user ids never leave the server.
export const guideOut = (g) => ({
  id: g.id, slug: g.slug, name: g.name, city: g.city, state: g.state, website: g.website,
  instagrams: g.instagrams || [], about: g.about, rivers: g.rivers || [], waters: g.waters, trips: g.trips || [],
  years: g.years == null ? null : Number(g.years), credentials: g.credentials, shops: g.shops || [],
  ...(g.status ? { status: g.status } : {}),
});

// A guide's shop entries: a listed shop is looked up by slug (name and Instagram come from the shop, so they can't be
// misstated); anything else stays as the guide wrote it and is shown as "not on Fly AI".
export function resolveShops(entries, listed) {
  const by = new Map((listed || []).map((s) => [s.slug, s]));
  const out = [];
  for (const e of entries || []) {
    const s = e.slug && by.get(e.slug);
    if (s) out.push({ slug: s.slug, name: s.name, ...(s.instagram ? { instagram: s.instagram } : {}), listed: true });
    else if (e.name) out.push({ name: e.name, ...(e.instagram ? { instagram: e.instagram } : {}), listed: false });
  }
  return out;
}

// The credibility signals a profile can show, in plain words, with what each rests on. Self-reported unless a
// listed shop is named; none of this is verified by Fly AI.
export function signals(g) {
  const out = [];
  if ((g.instagrams || []).length) out.push(`Instagram: ${g.instagrams.map((h) => "@" + h).join(", ")}`);
  const listed = (g.shops || []).filter((s) => s.listed);
  if (listed.length) out.push(`Works with ${listed.map((s) => s.name).join(", ")}`);
  if (g.years != null && g.years > 0) out.push(`${g.years} year${g.years === 1 ? "" : "s"} guiding (self-reported)`);
  if (g.credentials) out.push(`${g.credentials} (self-reported)`);
  return out;
}

export function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180, p1 = a.lat * rad, p2 = b.lat * rad;
  const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}
