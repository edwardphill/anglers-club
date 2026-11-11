// POST /api/join { club, handle }: joins a club under this device's name. Posting or RSVPing joins
// automatically, so this is only for joining without doing either. Someone the organizer removed
// can't come back.
import { route, readBody, str, HttpError } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { requireUser, newId, limit, cleanName } from "../lib/auth.js";

export default route(["POST"], async (req) => {
  await ensureSchema();
  const user = await requireUser(req);
  const b = readBody(req);
  const clubId = str(b.club, 80);
  const [club] = await q("select id from clubs where id = $1", [clubId]);
  if (!club) throw new HttpError(404, "That club isn't here anymore.");
  const [had] = await q("select id, role from members where club_id = $1 and user_id = $2", [clubId, user.id]);
  if (had && had.role === "removed") throw new HttpError(403, "The organizer removed you from this club.");
  if (had) return { memberId: had.id };
  await limit(`join:${user.id}`, 30, 60 * 60e3, "That's a lot of clubs in an hour. Try again later.");
  const memberId = newId("m");
  await q(
    `insert into members (id, club_id, handle, role, user_id, at) values ($1, $2, $3, 'member', $4, $5)
     on conflict (club_id, user_id) where user_id is not null do nothing`,
    [memberId, clubId, cleanName(b.handle) || cleanName(user.name) || "Angler", user.id, Date.now()],
  );
  const [m] = await q("select id from members where club_id = $1 and user_id = $2", [clubId, user.id]);
  return { memberId: m.id };
});
