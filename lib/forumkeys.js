// The forum's categories and addresses, apart from the database and the pages so both can use them.
import { slugify } from "./shops.js";

export const CATEGORIES = [
  { key: "general", name: "General fly fishing", text: "Anything about fly fishing that doesn't fit below: technique, stories, questions." },
  { key: "rivers", name: "Rivers and water reports", text: "Flows, conditions, access and what you found on the water." },
  { key: "flies", name: "Flies and hatches", text: "What's hatching, what to tie, what worked." },
  { key: "gear", name: "Gear", text: "Rods, reels, lines, waders and the rest." },
  { key: "hunting", name: "Hunting", text: "Public land, seasons, dogs and field reports." },
  { key: "clubs", name: "Clubs, trips and meetups", text: "Find people to fish with, organize a trip, start a club." },
  { key: "shops", name: "Fly shops and guides", text: "Shops, guides, and what you'd tell the next person." },
];
export const catOf = (key) => CATEGORIES.find((c) => c.key === key) || null;

// A thread's address is /forum/t/<title words>-<id>; only the id matters, the words are for people and search.
export const threadSlug = (title) => slugify(title).slice(0, 60).replace(/-+$/, "") || "thread";
export const threadPath = (t) => `/forum/t/${threadSlug(t.title)}-${t.id}`;
export const idFromKey = (key) => String(key || "").split("-").pop();
