// Club passwords, member sign-in tokens and rate limits.
import crypto from "node:crypto";
import { q } from "./db.js";
import { HttpError, str } from "./http.js";

const SCRYPT = { N: 16384, r: 8, p: 1 };

export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const newId = (prefix, bytes = 8) => prefix + crypto.randomBytes(bytes).toString("hex");

// Club passwords aren't case-sensitive: friends type them on phones.
const norm = (pw) => String(pw ?? "").trim().toLowerCase();

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(norm(pw), salt, 32, SCRYPT);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function checkPassword(pw, stored) {
  if (typeof stored !== "string" || !stored.startsWith("scrypt:")) return false;
  const [, salt, hash] = stored.split(":");
  const want = Buffer.from(hash, "base64url");
  const got = crypto.scryptSync(norm(pw), Buffer.from(salt, "base64url"), want.length, SCRYPT);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// The member behind the request's bearer token, for this club.
export async function requireMember(req, clubId) {
  const auth = String(req.headers?.authorization || "");
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const club = str(clubId, 80);
  if (!token || !club) throw new HttpError(401, "Sign in to this club with its password.");
  const rows = await q(
    "select id, club_id, handle, role from members where token_hash = $1 and club_id = $2",
    [sha(token), club],
  );
  if (!rows.length) throw new HttpError(401, "Your sign-in for this club has ended. Enter the club password again.");
  return rows[0];
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
