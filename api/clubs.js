// GET /api/clubs: the public directory (names and places only).
// POST /api/clubs: start a club. The caller becomes its organizer and gets a sign-in token.
import crypto from "node:crypto";
import { route, readBody, clientIp, str, HttpError } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { hashPassword, newId, newToken, sha, limit } from "../lib/auth.js";
import { clubInput, clubOut, slug } from "../lib/clubs.js";

export default route(["GET", "POST"], async (req) => {
  await ensureSchema();

  if (req.method === "GET") {
    const rows = await q(
      `select c.*, (select count(*)::int from members m where m.club_id = c.id) as members
       from clubs c order by c.state, c.city, c.name limit 1000`,
    );
    return { clubs: rows.map(clubOut) };
  }

  const b = readBody(req);
  await limit(`create:${clientIp(req)}`, 6, 60 * 60e3, "That's a lot of new clubs from one place. Try again in an hour.");
  const data = clubInput(b);
  const password = typeof b.password === "string" ? b.password : "";
  if (password.trim().length < 3) throw new HttpError(400, "Pick a club password of at least 3 characters.");

  const base = `${slug(data.city)}-${data.state.toLowerCase()}`;
  const taken = await q("select 1 from clubs where id = $1", [base]);
  const id = taken.length ? `${base}-${crypto.randomBytes(2).toString("hex")}` : base;
  const memberId = newId("m");
  const token = newToken();
  const now = Date.now();

  await q(
    `insert into clubs (id, name, city, state, kinds, waters, tz, lat, lon, region, pw_hash, owner_id, at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)`,
    [id, data.name, data.city, data.state, data.kinds, JSON.stringify(data.waters), data.tz,
      data.lat, data.lon, data.region, hashPassword(password), memberId, now],
  );
  try {
    await q(
      `insert into members (id, club_id, handle, role, token_hash, at) values ($1, $2, $3, 'owner', $4, $5)`,
      [memberId, id, str(b.handle, 30), sha(token), now],
    );
  } catch (e) {
    await q("delete from clubs where id = $1", [id]);
    throw e;
  }

  const [club] = await q("select * from clubs where id = $1", [id]);
  return { club: clubOut(club), session: { clubId: id, memberId, token } };
});
