// POST /api/join { club, password, handle }: checks the club password and signs the person in.
import { route, readBody, clientIp, str, HttpError } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { checkPassword, newId, newToken, sha, limit } from "../lib/auth.js";

export default route(["POST"], async (req) => {
  await ensureSchema();
  const b = readBody(req);
  const clubId = str(b.club, 80);
  const [club] = await q("select id, pw_hash from clubs where id = $1", [clubId]);
  if (!club) throw new HttpError(404, "That club isn't here anymore.");
  if (!club.pw_hash) throw new HttpError(403, "This club isn't taking new members yet. Ask the organizer to set a password.");

  await limit(`join:${clientIp(req)}:${clubId}`, 8, 15 * 60e3, "Too many password tries. Wait 15 minutes and try again.");
  if (!checkPassword(b.password, club.pw_hash)) {
    throw new HttpError(403, "That password doesn't match. Check the organizer's text, or ask them for it.");
  }

  const memberId = newId("m");
  const token = newToken();
  await q(
    `insert into members (id, club_id, handle, role, token_hash, at) values ($1, $2, $3, 'member', $4, $5)`,
    [memberId, clubId, str(b.handle, 30), sha(token), Date.now()],
  );
  return { session: { clubId, memberId, token } };
});
