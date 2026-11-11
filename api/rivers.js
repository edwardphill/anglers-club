// The river waitlist: the Fly Picker's "Request a river" saves here instead of asking people to send a message.
// GET  /api/rivers: the waitlist, most-wanted first, with which ones this person asked for ({mine}).
//      ?detail=1 adds the stretch, water, gauge and notes people gave; only a site admin gets it (it's for whoever adds the river).
// POST /api/rivers { name, state, stretch?, water?, gauge?, notes? }: asks for a river, or "me too" when someone already has. Needs a saved name.
// POST /api/rivers { key, me: true }: "me too" on a river already on the list.
// POST /api/rivers { key, me: false }: takes this person's ask back.
// A river drops off the list on its own once it's in the Fly Picker; the rows stay for the record.
import { route, readBody, clientIp, str, HttpError } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { currentUser, requireUser, newId, limit } from "../lib/auth.js";
import { RIVERS, isAdmin, clean, oneLine } from "../lib/shops.js";
import { riverBase, riverKey, stateCode } from "../lib/rivers.js";

const WATERS = ["freestone", "tailwater", "spring_creek", "small_stream", "trout_lake", "warm_river", "warm_lake", "flats", "surf", "estuary"];
const HAVE = Object.values(RIVERS).map((r) => ({ base: riverBase(r.name), state: r.state, name: r.name }));
const inFlyPicker = (name, state) => HAVE.find((r) => r.base && r.base === riverBase(name) && (!r.state || r.state === state));

async function list(userId, detail) {
  const rows = await q(
    `select key,
            (array_agg(name order by at))[1] as name,
            (array_agg(state order by at))[1] as state,
            coalesce((array_agg(stretch order by at) filter (where stretch <> ''))[1], '') as stretch,
            coalesce((array_agg(water order by at) filter (where water <> ''))[1], '') as water,
            coalesce((array_agg(gauge order by at) filter (where gauge <> ''))[1], '') as gauge,
            coalesce((array_agg(notes order by at) filter (where notes <> ''))[1], '') as notes,
            count(*)::int as votes,
            coalesce(bool_or(user_id = $1), false) as mine,
            min(at) as first_at
       from river_requests group by key order by count(*) desc, min(at) limit 200`,
    [userId || ""],
  );
  return rows
    .filter((r) => !inFlyPicker(r.name, r.state))
    .map((r) => ({
      key: r.key, name: r.name, state: r.state, votes: r.votes, mine: !!r.mine, asked: r.first_at,
      ...(detail ? { stretch: r.stretch, water: r.water, gauge: r.gauge, notes: r.notes } : {}),
    }));
}

export default route(["GET", "POST"], async (req) => {
  await ensureSchema();

  if (req.method === "GET") {
    const user = await currentUser(req);
    return { waitlist: await list(user && user.id, !!(req.query && req.query.detail === "1" && isAdmin(user))), admin: isAdmin(user) };
  }

  const user = await requireUser(req);
  const b = readBody(req);
  await limit(`river:${user.id}`, 20, 60 * 60e3, "That's a lot of river requests in an hour. Try again later.");
  await limit(`riverip:${clientIp(req)}`, 60, 60 * 60e3, "Too many river requests from here. Try again later.");
  const now = Date.now();

  if (typeof b.key === "string") {
    const key = str(b.key, 120);
    if (b.me === false) {
      await q("delete from river_requests where key = $1 and user_id = $2", [key, user.id]);
      return { waitlist: await list(user.id), key };
    }
    const [first] = await q("select name, state from river_requests where key = $1 order by at limit 1", [key]);
    if (!first) throw new HttpError(404, "That river isn't on the list anymore.");
    await q(
      `insert into river_requests (id, key, name, state, user_id, at) values ($1, $2, $3, $4, $5, $6)
       on conflict (key, user_id) do nothing`,
      [newId("rr"), key, first.name, first.state, user.id, now],
    );
    return { waitlist: await list(user.id), key };
  }

  const name = oneLine(b.name, 80);
  if (name.length < 2 || !/[a-z]/i.test(name)) throw new HttpError(400, "Add the river's name.");
  const state = stateCode(str(b.state, 40));
  if (!state) throw new HttpError(400, "Pick a state.");
  const gauge = str(b.gauge, 20);
  if (gauge && !/^\d{8,15}$/.test(gauge)) throw new HttpError(400, "A USGS gauge number is 8 to 15 digits.");
  const water = WATERS.includes(str(b.water, 30)) ? str(b.water, 30) : "";
  const stretch = oneLine(b.stretch, 200);
  const notes = clean(b.notes, 500);
  const key = riverKey(name, state);
  if (!key) throw new HttpError(400, "Add the river's name.");
  const have = inFlyPicker(name, state);
  if (have) throw new HttpError(409, `The ${have.name} is already in the Fly Picker. Pick it from the River list.`);
  await q(
    `insert into river_requests (id, key, name, state, stretch, water, gauge, notes, user_id, at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (key, user_id) do nothing`,
    [newId("rr"), key, name, state, stretch, water, gauge, notes, user.id, now],
  );
  return { waitlist: await list(user.id), key };
});
