// GET /api/auth: the Google client ID the page needs for its sign-in button, and who's signed in.
// POST /api/auth { type: "google", credential, link: [{ club, token }] }: signs in with a Google ID
//   token, starts a session for this device, and links the device's older club memberships.
// POST /api/auth { type: "signout" }: ends this device's session.
import { route, readBody, clientIp, str, HttpError } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { currentUser, newId, newToken, sha, limit, userOut } from "../lib/auth.js";
import { verifyGoogleIdToken } from "../lib/google.js";

export default route(["GET", "POST"], async (req) => {
  await ensureSchema();
  if (req.method === "GET") {
    const u = await currentUser(req);
    return { googleClientId: process.env.GOOGLE_CLIENT_ID || "", user: u ? userOut(u) : null };
  }

  const b = readBody(req);
  if (b.type === "signout") {
    const token = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (token) await q("delete from sessions where token_hash = $1", [sha(token)]);
    return {};
  }
  if (b.type !== "google") throw new HttpError(400, "That sign-in type isn't supported.");

  await limit(`signin:${clientIp(req)}`, 40, 15 * 60e3, "Too many sign-ins from here. Wait a few minutes and try again.");
  const c = await verifyGoogleIdToken(b.credential);
  const now = Date.now();
  const email = str(c.email, 200), name = str(c.name || c.given_name || "", 80), picture = str(c.picture, 500);
  const [user] = await q(
    `insert into users (id, google_sub, email, name, picture, at, seen) values ($1, $2, $3, $4, $5, $6, $6)
     on conflict (google_sub) do update set email = excluded.email, name = excluded.name, picture = excluded.picture, seen = excluded.seen
     returning id, email, name, picture`,
    [newId("u"), String(c.sub), email, name, picture, now],
  );
  const token = newToken();
  await q("insert into sessions (token_hash, user_id, at, seen) values ($1, $2, $3, $3)", [sha(token), user.id, now]);

  // Memberships this device had from the password days: attach them to this Google account,
  // unless the account already belongs to that club.
  const linked = [];
  for (const l of (Array.isArray(b.link) ? b.link : []).slice(0, 20)) {
    const club = str(l && l.club, 80), t = str(l && l.token, 200);
    if (!club || !t) continue;
    const rows = await q(
      `update members set user_id = $3 where club_id = $1 and token_hash = $2 and user_id is null
         and not exists (select 1 from members m2 where m2.club_id = $1 and m2.user_id = $3)
       returning club_id`,
      [club, sha(t), user.id],
    );
    if (rows.length) linked.push(club);
  }
  return { token, user: userOut(user), linked };
});
