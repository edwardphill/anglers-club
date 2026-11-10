// Sign-in sessions (Google), club membership checks and rate limits.
import crypto from "node:crypto";
import { q } from "./db.js";
import { HttpError, str } from "./http.js";

export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const newId = (prefix, bytes = 8) => prefix + crypto.randomBytes(bytes).toString("hex");

const bearer = (req) => String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0].slice(0, 30);
export const userOut = (u) => ({ id: u.id, email: u.email, name: u.name, picture: u.picture });

// The signed-in user behind the request's bearer token, or null.
export async function currentUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const rows = await q(
    `select u.id, u.email, u.name, u.picture, s.seen from sessions s join users u on u.id = s.user_id where s.token_hash = $1`,
    [sha(token)],
  );
  if (!rows.length) return null;
  const now = Date.now();
  if (!(rows[0].seen > now - 6 * 3600e3)) await q("update sessions set seen = $2 where token_hash = $1", [sha(token), now]);
  return rows[0];
}

export async function requireUser(req) {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, "Sign in with Google to continue.");
  return u;
}

// The caller's membership in this club. 401 when signed out; 403 when not a member.
export async function requireMember(req, clubId) {
  const user = await requireUser(req);
  const club = str(clubId, 80);
  const rows = await q(
    "select id, club_id, handle, role from members where club_id = $1 and user_id = $2 and role <> 'removed'",
    [club, user.id],
  );
  if (!rows.length) throw new HttpError(403, "Join this club to see its trips.");
  return { ...rows[0], user };
}

// Counts attempts per key inside a rolling window and refuses past `max`.
export async function limit(key, max, windowMs, message) {
  const now = Date.now();
  const rows = await q(
    `insert into attempts (key, n, since) values ($1, 1, $2)
     on conflict (key) do update set
       n = case when attempts.since < $3 then 1 else attempts.n + 1 end,
       since = case when attempts.since < $3 then $2 else attempts.since end
     returning n`,
    [key, now, now - windowMs],
  );
  if (rows[0] && rows[0].n > max) {
    throw new HttpError(429, message || "Too many tries. Wait a few minutes and try again.");
  }
}
