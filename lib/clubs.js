// Input checks and the public shapes the page reads.
import { HttpError, str } from "./http.js";

const ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
];
const REGIONS = ["west", "northeast", "east", "south"];
const KINDS = ["fish", "hunt", "both"];

export function clubInput(b) {
  const city = str(b.city, 60);
  const state = str(b.state, 2).toUpperCase();
  if (!city) throw new HttpError(400, "Add your city.");
  if (!/^[A-Z]{2}$/.test(state)) throw new HttpError(400, "Pick a state.");
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new HttpError(400, "The club location needs a latitude and longitude.");
  }
  const waters = Array.isArray(b.waters)
    ? [...new Set(b.waters.filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 40)
    : [];
  return {
    city,
    state,
    name: str(b.name, 80) || `${city} Anglers Club`,
    kinds: KINDS.includes(b.kinds) ? b.kinds : "both",
    tz: ZONES.includes(b.tz) ? b.tz : "America/Chicago",
    region: REGIONS.includes(b.region) ? b.region : "south",
    lat,
    lon,
    waters,
  };
}

export function tripInput(p) {
  const water = str(p.water, 80);
  if (!water) throw new HttpError(400, "Add where you're going.");
  const date = str(p.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Pick a date.");
  const time = str(p.time, 5);
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new HttpError(400, "Pick a start time, or leave it blank.");
  const raw = p.seats;
  const seats = raw === null || raw === undefined || raw === "" ? null : Math.max(0, Math.min(30, parseInt(raw, 10) || 0));
  return {
    kind: p.kind === "hunt" ? "hunt" : "fish",
    water,
    title: str(p.title, 80),
    date,
    time,
    meet: str(p.meet, 120),
    seats,
    cond: str(p.cond, 120),
    notes: str(p.notes, 1500),
  };
}

export function slug(s) {
  return (
    String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "club"
  );
}

export const clubOut = (r) => ({
  id: r.id,
  name: r.name,
  city: r.city,
  state: r.state,
  kinds: r.kinds,
  waters: Array.isArray(r.waters) ? r.waters : [],
  tz: r.tz,
  lat: r.lat,
  lon: r.lon,
  region: r.region,
  hasPassword: !!r.pw_hash,
  ownerId: r.owner_id || "",
  members: typeof r.members === "number" ? r.members : undefined,
  at: r.at,
});
