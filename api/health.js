// GET /api/health: confirms the database is connected and the tables exist.
import { route } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";

export default route(["GET"], async () => {
  await ensureSchema();
  const [r] = await q("select count(*)::int as clubs from clubs");
  return { ok: true, clubs: r.clubs };
});
