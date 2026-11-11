// US states as a place for the public AI fly guide: no club, just the state a visitor fishes in. lat/lon is a large
// city in the state (used for "near you" distances and the weather search); region is the Fly Picker's region.
// Kept in step with the ST table in src/club.html.
export const STATES = {
  AL: { name: "Alabama", lat: 33.52, lon: -86.81, tz: "America/Chicago", region: "south" },
  AK: { name: "Alaska", lat: 61.22, lon: -149.9, tz: "America/Anchorage", region: "west" },
  AZ: { name: "Arizona", lat: 33.45, lon: -112.07, tz: "America/Phoenix", region: "west" },
  AR: { name: "Arkansas", lat: 34.75, lon: -92.29, tz: "America/Chicago", region: "south" },
  CA: { name: "California", lat: 34.05, lon: -118.24, tz: "America/Los_Angeles", region: "west" },
  CO: { name: "Colorado", lat: 39.74, lon: -104.99, tz: "America/Denver", region: "west" },
  CT: { name: "Connecticut", lat: 41.76, lon: -72.67, tz: "America/New_York", region: "east" },
  DE: { name: "Delaware", lat: 39.74, lon: -75.55, tz: "America/New_York", region: "east" },
  DC: { name: "District of Columbia", lat: 38.9, lon: -77.04, tz: "America/New_York", region: "east" },
  FL: { name: "Florida", lat: 28.54, lon: -81.38, tz: "America/New_York", region: "south" },
  GA: { name: "Georgia", lat: 33.75, lon: -84.39, tz: "America/New_York", region: "south" },
  HI: { name: "Hawaii", lat: 21.31, lon: -157.86, tz: "Pacific/Honolulu", region: "west" },
  ID: { name: "Idaho", lat: 43.62, lon: -116.2, tz: "America/Denver", region: "west" },
  IL: { name: "Illinois", lat: 41.88, lon: -87.63, tz: "America/Chicago", region: "east" },
  IN: { name: "Indiana", lat: 39.77, lon: -86.16, tz: "America/New_York", region: "east" },
  IA: { name: "Iowa", lat: 41.59, lon: -93.62, tz: "America/Chicago", region: "east" },
  KS: { name: "Kansas", lat: 37.69, lon: -97.34, tz: "America/Chicago", region: "east" },
  KY: { name: "Kentucky", lat: 38.25, lon: -85.76, tz: "America/New_York", region: "south" },
  LA: { name: "Louisiana", lat: 29.95, lon: -90.07, tz: "America/Chicago", region: "south" },
  ME: { name: "Maine", lat: 43.66, lon: -70.26, tz: "America/New_York", region: "northeast" },
  MD: { name: "Maryland", lat: 39.29, lon: -76.61, tz: "America/New_York", region: "east" },
  MA: { name: "Massachusetts", lat: 42.36, lon: -71.06, tz: "America/New_York", region: "east" },
  MI: { name: "Michigan", lat: 42.33, lon: -83.05, tz: "America/New_York", region: "east" },
  MN: { name: "Minnesota", lat: 44.98, lon: -93.27, tz: "America/Chicago", region: "east" },
  MS: { name: "Mississippi", lat: 32.3, lon: -90.18, tz: "America/Chicago", region: "south" },
  MO: { name: "Missouri", lat: 38.63, lon: -90.2, tz: "America/Chicago", region: "east" },
  MT: { name: "Montana", lat: 45.68, lon: -111.04, tz: "America/Denver", region: "west" },
  NE: { name: "Nebraska", lat: 41.26, lon: -95.93, tz: "America/Chicago", region: "east" },
  NV: { name: "Nevada", lat: 39.53, lon: -119.81, tz: "America/Los_Angeles", region: "west" },
  NH: { name: "New Hampshire", lat: 42.99, lon: -71.46, tz: "America/New_York", region: "northeast" },
  NJ: { name: "New Jersey", lat: 40.74, lon: -74.17, tz: "America/New_York", region: "east" },
  NM: { name: "New Mexico", lat: 35.08, lon: -106.65, tz: "America/Denver", region: "west" },
  NY: { name: "New York", lat: 40.71, lon: -74.01, tz: "America/New_York", region: "east" },
  NC: { name: "North Carolina", lat: 35.23, lon: -80.84, tz: "America/New_York", region: "south" },
  ND: { name: "North Dakota", lat: 46.88, lon: -96.79, tz: "America/Chicago", region: "east" },
  OH: { name: "Ohio", lat: 39.96, lon: -83, tz: "America/New_York", region: "east" },
  OK: { name: "Oklahoma", lat: 35.47, lon: -97.52, tz: "America/Chicago", region: "south" },
  OR: { name: "Oregon", lat: 45.52, lon: -122.68, tz: "America/Los_Angeles", region: "west" },
  PA: { name: "Pennsylvania", lat: 40.27, lon: -76.88, tz: "America/New_York", region: "east" },
  RI: { name: "Rhode Island", lat: 41.82, lon: -71.41, tz: "America/New_York", region: "east" },
  SC: { name: "South Carolina", lat: 34, lon: -81.03, tz: "America/New_York", region: "south" },
  SD: { name: "South Dakota", lat: 43.54, lon: -96.73, tz: "America/Chicago", region: "east" },
  TN: { name: "Tennessee", lat: 36.16, lon: -86.78, tz: "America/Chicago", region: "south" },
  TX: { name: "Texas", lat: 30.27, lon: -97.74, tz: "America/Chicago", region: "south" },
  UT: { name: "Utah", lat: 40.76, lon: -111.89, tz: "America/Denver", region: "west" },
  VT: { name: "Vermont", lat: 44.48, lon: -73.21, tz: "America/New_York", region: "northeast" },
  VA: { name: "Virginia", lat: 37.54, lon: -77.44, tz: "America/New_York", region: "east" },
  WA: { name: "Washington", lat: 47.61, lon: -122.33, tz: "America/Los_Angeles", region: "west" },
  WV: { name: "West Virginia", lat: 38.35, lon: -81.63, tz: "America/New_York", region: "east" },
  WI: { name: "Wisconsin", lat: 43.04, lon: -87.91, tz: "America/Chicago", region: "east" },
  WY: { name: "Wyoming", lat: 42.87, lon: -106.31, tz: "America/Denver", region: "west" },
};

const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// A place the guide can answer for, shaped like a club so the planner's helpers work on it. null when the state is unknown.
export function publicPlace(p) {
  const code = clean(p && p.state, 2).toUpperCase();
  const s = STATES[code];
  if (!s) return null;
  const city = clean(p && p.city, 60);
  return { id: null, public: true, name: "an angler", city: city || s.name, state: code, stateName: s.name, lat: s.lat, lon: s.lon, tz: s.tz, region: s.region, kinds: "fish", waters: [], from: "a central point in " + s.name };
}
