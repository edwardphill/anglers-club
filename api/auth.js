// GET /api/auth: the Google client ID (empty when Google is off) and who this device is.
// POST /api/auth { type: "guest", name, link }: gives this device a saved name and a session.
//   `link` carries club tokens from the password days, which are attached to the new name.
// POST /api/auth { type: "rename", name }: changes the name this device posts under.
// POST /api/auth { type: "google", credential, link }: optional Google sign-in. Signed in from a
//   device that already has a name, it keeps that name and its clubs.
// POST /api/auth { type: "signout" }: ends this device's session.
import { route, readBody, clientIp, str, HttpError } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { currentUser, newId, newToken, sha, limit, userOut, cleanName, linkLegacy } from "../lib/auth.js";
import { verifyGoogleIdToken } from "../lib/google.js";

const bearer = (req) => String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();

async function startSession(userId, now) {
  const token = newToken();
  await q("insert into sessions (token_hash, user_id, at, seen) values ($1, $2, $3, $3)", [sha(token), userId, now]);
  return token;
}

export default route(["GET", "POST"], async (req) => {
  await ensureSchema();
  if (req.method === "GET") {
    const u = await currentUser(req);
    return { googleClientId: process.env.GOOGLE_CLIENT_ID || "", user: u ? userOut(u) : null };
  }

  const b = readBody(req);
  const now = Date.now();

  if (b.type === "signout") {
    const token = bearer(req);
    if (token) await q("delete from sessions where token_hash = $1", [sha(token)]);
    return {};
  }

  if (b.type === "rename") {
    const u = await currentUser(req);
    if (!u) throw new HttpError(401, "Add your name to continue.");
    const name = cleanName(b.name);
    if (!name) throw new HttpError(400, "Enter a name.");
    await limit(`rename:${u.id}`, 30, 60 * 60e3, "That's a lot of name changes. Try again later.");
    await q("update users set name = $2 where id = $1", [u.id, name]);
    await q("update members set handle = $2 where user_id = $1", [u.id, name]);
    return { user: userOut({ ...u, name }) };
  }

  if (b.type === "guest") {
    await limit(`guest:${clientIp(req)}`, 40, 15 * 60e3, "Too many new names from here. Wait a few minutes and try again.");
    const links = (Array.isArray(b.link) ? b.link : []).slice(0, 20);
    let name = cleanName(b.name);
    // An older device that never typed a name here: reuse the name it went by in its club.
    if (!name) {
      for (const l of links) {
        const [m] = await q(
          "select handle from members where club_id = $1 and token_hash = $2 and user_id is null",
          [str(l && l.club, 80), sha(str(l && l.token, 200))],
        );
        if (m && cleanName(m.handle)) { name = cleanName(m.handle); break; }
      }
    }
    if (!name) throw new HttpError(400, "Enter a name to continue.");
    const [user] = await q(
      `insert into users (id, google_sub, email, name, picture, at, seen) values ($1, null, '', $2, '', $3, $3)
       returning id, email, name, picture`,
      [newId("u"), name, now],
    );
    const token = await startSession(user.id, now);
    const linked = await linkLegacy(user.id, links);
    return { token, user: userOut(user), linked };
  }

  if (b.type !== "google") throw new HttpError(400, "That sign-in type isn't supported.");

  await limit(`signin:${clientIp(req)}`, 40, 15 * 60e3, "Too many sign-ins from here. Wait a few minutes and try again.");
  const c = await verifyGoogleIdToken(b.credential);
  const email = str(c.email, 200), gname = cleanName(c.name || c.given_name || email.split("@")[0]), picture = str(c.picture, 500);
  const sub = String(c.sub);
  const current = await currentUser(req);
  const guest = current && !current.g ? current : null;
  const [known] = await q("select id from users where google_sub = $1", [sub]);
  let userId;
  if (known) {
    userId = known.id;
    await q("update users set email = $2, picture = $3, seen = $4, name = coalesce(nullif(name, ''), $5) where id = $1", [userId, email, picture, now, gname]);
    // A device with a saved name keeps what it already joined when it signs in to an older account.
    if (guest) {
      await q(
        `update members set user_id = $2 where user_id = $1
           and not exists (select 1 from members m2 where m2.club_id = members.club_id and m2.user_id = $2)`,
        [guest.id, userId],
      );
    }
  } else if (guest) {
    // First Google sign-in from a named device: the same person, now with an account behind the name.
    userId = guest.id;
    await q("update users set google_sub = $2, email = $3, picture = $4, seen = $5 where id = $1", [userId, sub, email, picture, now]);
  } else {
    const [u] = await q(
      `insert into users (id, google_sub, email, name, picture, at, seen) values ($1, $2, $3, $4, $5, $6, $6) returning id`,
      [newId("u"), sub, email, gname, picture, now],
    );
    userId = u.id;
  }
  if (guest && guest.id !== userId) await q("delete from sessions where user_id = $1", [guest.id]);
  const token = await startSession(userId, now);
  const linked = await linkLegacy(userId, b.link);
  const [user] = await q("select id, email, name, picture, true as g from users where id = $1", [userId]);
  return { token, user: userOut(user), linked };
});
