// The TWRA public dove fields (data/dove-fields.json): loaded once, with helpers shared by the pages and the sitemap.
import { createRequire } from "node:module";

const raw = createRequire(import.meta.url)("../data/dove-fields.json");
export const DOVE = {
  season: raw.season,
  checked: raw.checked,
  general: raw.general,
  regions: Object.entries(raw.regions).map(([id, r]) => ({ id, ...r })),
  fields: raw.fields,
};
export const doveField = (slug) => DOVE.fields.find((f) => f.slug === String(slug || "").toLowerCase()) || null;
export const doveRegion = (id) => DOVE.regions.find((r) => r.id === id);

// Straight-line miles between two points (good enough to say which fields are nearby).
export function miles(a, b) {
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function nearby(f, n = 4) {
  return DOVE.fields.filter((x) => x.slug !== f.slug).map((x) => ({ field: x, mi: miles(f, x) })).sort((a, b) => a.mi - b.mi).slice(0, n);
}
