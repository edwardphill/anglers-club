// Sessions (a saved name or Google), club membership and rate limits.
import crypto from "node:crypto";
import { q } from "./db.js";
import { HttpError, str } from "./http.js";

export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const newId = (prefix, bytes = 8) => prefix + crypto.randomBytes(bytes).toString("hex");

const bearer = (req) => String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0].slice(0, 30);
export const userOut = (u) => ({ id: u.id, email: u.email || "", name: u.name || "", picture: u.picture || "", google: !!u.g });
// A name someone types: one line, no control characters, 30 characters at most.
export const cleanName = (v) => String(typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);

// The signed-in user behind the request's bearer token, or null.
export async function currentUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const rows = await q(
    `select u.id, u.email, u.name, u.picture, (u.google_sub is not null) as g, s.seen
     from sessions s join users u on u.id = s.user_id where s.token_hash = $1`,
    [sha(token)],
  );
  if (!rows.length) return null;
  const now = Date.now();
  if (!(rows[0].seen > now - 6 * 3600e3)) await q("update sessions set seen = $2 where token_hash = $1", [sha(token), now]);
  return rows[0];
}

export async function requireUser(req) {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, "Add your name to continue.");
  return u;
}

// The caller's membership in this club, or null when they haven't taken part yet (or aren't named).
export async function findMember(req, clubId) {
  const user = await currentUser(req);
  if (!user) return null;
  const rows = await q(
    "select id, club_id, handle, role from members where club_id = $1 and user_id = $2",
    [str(clubId, 80), user.id],
  );
  return rows.length ? { ...rows[0], user } : null;
}

// The caller as a member of this club, for anything that writes. Clubs are open: a named person
// who posts, RSVPs or comments is added to the club on the spot. 401 when they haven't given a
// name yet; 403 when the organizer removed them.
export async function requireMember(req, clubId) {
  const user = await requireUser(req);
  const club = str(clubId, 80);
  const [c] = await q("select id from clubs where id = $1", [club]);
  if (!c) throw new HttpError(404, "That club isn't here anymore.");
  const [had] = await q("select id, club_id, handle, role from members where club_id = $1 and user_id = $2", [club, user.id]);
  if (had && had.role === "removed") throw new HttpError(403, "The organizer removed you from this club.");
  if (had) return { ...had, user };
  await limit(`join:${user.id}`, 30, 60 * 60e3, "That's a lot of clubs in an hour. Try again later.");
  const id = newId("m");
  await q(
    `insert into members (id, club_id, handle, role, user_id, at) values ($1, $2, $3, 'member', $4, $5)
     on conflict (club_id, user_id) where user_id is not null do nothing`,
    [id, club, cleanName(user.name) || "Angler", user.id, Date.now()],
  );
  const [m] = await q("select id, club_id, handle, role from members where club_id = $1 and user_id = $2", [club, user.id]);
  if (m.role === "removed") throw new HttpError(403, "The organizer removed you from this club.");
  return { ...m, user };
}

// Attaches memberships this device held in the password days (a per-club token) to a user,
// unless the user is already in that club. Returns the clubs that moved over.
export async function linkLegacy(userId, links) {
  const linked = [];
  for (const l of (Array.isArray(links) ? links : []).slice(0, 20)) {
    const club = str(l && l.club, 80), t = str(l && l.token, 200);
    if (!club || !t) continue;
    const rows = await q(
      `update members set user_id = $3 where club_id = $1 and token_hash = $2 and user_id is null
         and not exists (select 1 from members m2 where m2.club_id = $1 and m2.user_id = $3)
       returning club_id`,
      [club, sha(t), userId],
    );
    if (rows.length) linked.push(club);
  }
  return linked;
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
