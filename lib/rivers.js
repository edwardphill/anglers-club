// The river waitlist's idea of "the same river": "Kennebec River" and "kennebec" in ME are one request, and a
// request for a river already in the Fly Picker is turned away. The browser never recomputes this; the server
// answers with the key.
export function riverBase(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && w !== "river" && w !== "the")
    .join("-");
}

export function riverKey(name, state) {
  const base = riverBase(name);
  const st = String(state || "").toLowerCase().replace(/[^a-z]/g, "");
  return base ? `${base}-${st || "other"}` : "";
}

// The request form offers states by name; the list keeps the two-letter code (the Fly Picker's own rivers use codes too).
const STATES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CODES = new Set(Object.values(STATES));
// "Maine", "me", "ME" -> "ME"; "Other or outside the US" -> "Other"; anything else -> "".
export function stateCode(raw) {
  const s = String(raw || "").trim();
  if (/^other/i.test(s)) return "Other";
  if (/^[a-z]{2}$/i.test(s)) return CODES.has(s.toUpperCase()) ? s.toUpperCase() : "";
  return STATES[s.toLowerCase().replace(/\s+/g, " ")] || "";
}
