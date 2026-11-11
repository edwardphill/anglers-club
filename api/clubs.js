// GET /api/clubs: every club (anyone can browse), plus which ones this device's name belongs to.
// POST /api/clubs: start a club. The named person who starts it becomes its organizer.
import crypto from "node:crypto";
import { route, readBody, str } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { currentUser, requireUser, newId, limit, cleanName } from "../lib/auth.js";
import { clubInput, clubOut, slug } from "../lib/clubs.js";

export default route(["GET", "POST"], async (req) => {
  await ensureSchema();

  if (req.method === "GET") {
    const user = await currentUser(req);
    // One statement at a time: the pooled connection is a single socket, and queued statements on it
    // gain nothing but a way to hang together.
    const rows = await q(`select c.*, (select count(*)::int from members m where m.club_id = c.id and m.role <> 'removed') as members
         from clubs c order by c.state, c.city, c.name limit 1000`);
    const mine = user ? await q("select club_id, id, role from members where user_id = $1", [user.id]) : [];
    return {
      clubs: rows.map(clubOut),
      mine: mine.filter((m) => m.role !== "removed").map((m) => ({ club: m.club_id, memberId: m.id, role: m.role })),
      removed: mine.filter((m) => m.role === "removed").map((m) => m.club_id),
    };
  }

  const user = await requireUser(req);
  const b = readBody(req);
  await limit(`create:${user.id}`, 6, 60 * 60e3, "That's a lot of new clubs in an hour. Try again later.");
  const data = clubInput(b);
  const base = `${slug(data.city)}-${data.state.toLowerCase()}`;
  const taken = await q("select 1 from clubs where id = $1", [base]);
  const id = taken.length ? `${base}-${crypto.randomBytes(2).toString("hex")}` : base;
  const memberId = newId("m");
  const now = Date.now();

  await q(
    `insert into clubs (id, name, city, state, kinds, waters, tz, lat, lon, region, owner_id, at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
    [id, data.name, data.city, data.state, data.kinds, JSON.stringify(data.waters), data.tz,
      data.lat, data.lon, data.region, memberId, now],
  );
  try {
    await q(
      `insert into members (id, club_id, handle, role, user_id, at) values ($1, $2, $3, 'owner', $4, $5)`,
      [memberId, id, cleanName(b.handle) || cleanName(user.name) || "Organizer", user.id, now],
    );
  } catch (e) {
    await q("delete from clubs where id = $1", [id]);
    throw e;
  }
  const [club] = await q("select * from clubs where id = $1", [id]);
  return { club: clubOut(club), memberId };
});
