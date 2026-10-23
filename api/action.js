// POST /api/action { club, type, data }: every change a signed-in member makes.
import { route, readBody, str, HttpError } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { requireMember, hashPassword, newId, limit } from "../lib/auth.js";
import { clubInput, tripInput } from "../lib/clubs.js";

const NOT_ALLOWED = "Only the trip's host or the club organizer can do that.";

export default route(["POST"], async (req) => {
  await ensureSchema();
  const b = readBody(req);
  const clubId = str(b.club, 80);
  const me = await requireMember(req, clubId);
  const owner = me.role === "owner";
  const p = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : {};
  const now = Date.now();

  const getTrip = async (id) => {
    const [t] = await q("select * from trips where id = $1 and club_id = $2", [str(id, 40), clubId]);
    if (!t) throw new HttpError(404, "That trip isn't on the calendar anymore.");
    return t;
  };
  const mayEdit = (t) => owner || t.host_id === me.id;
  const ownerOnly = () => {
    if (!owner) throw new HttpError(403, "Only the club organizer can do that.");
  };

  switch (b.type) {
    case "trip.save": {
      const d = tripInput(p);
      if (p.id) {
        const t = await getTrip(p.id);
        if (!mayEdit(t)) throw new HttpError(403, NOT_ALLOWED);
        await q(
          `update trips set kind = $3, water = $4, title = $5, date = $6, time = $7, meet = $8, seats = $9, cond = $10, notes = $11
           where id = $1 and club_id = $2`,
          [t.id, clubId, d.kind, d.water, d.title, d.date, d.time, d.meet, d.seats, d.cond, d.notes],
        );
        return { id: t.id };
      }
      await limit(`trip:${me.id}`, 30, 60 * 60e3, "That's a lot of trips in an hour. Try again later.");
      const id = newId("t", 6);
      await q(
        `insert into trips (id, club_id, host_id, kind, water, title, date, time, meet, seats, cond, notes, canceled, at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13)`,
        [id, clubId, me.id, d.kind, d.water, d.title, d.date, d.time, d.meet, d.seats, d.cond, d.notes, now],
      );
      return { id };
    }

    case "trip.cancel": {
      const t = await getTrip(p.id);
      if (!mayEdit(t)) throw new HttpError(403, NOT_ALLOWED);
      await q("update trips set canceled = $2 where id = $1", [t.id, p.canceled === true]);
      return {};
    }

    case "trip.delete": {
      const t = await getTrip(p.id);
      if (!mayEdit(t)) throw new HttpError(403, NOT_ALLOWED);
      await q("delete from trips where id = $1", [t.id]);
      return {};
    }

    case "rsvp.set": {
      const t = await getTrip(p.tripId);
      if (p.status === "out") {
        await q("delete from rsvps where trip_id = $1 and member_id = $2", [t.id, me.id]);
        return {};
      }
      if (p.status !== "in" && p.status !== "maybe") throw new HttpError(400, "Pick I'm in, Maybe or Can't go.");
      if (t.host_id === me.id) throw new HttpError(400, "You're hosting this trip.");
      if (t.canceled) throw new HttpError(400, "This trip is canceled.");
      // Takes a seat only while one is open; the host doesn't count against the seats.
      const rows = await q(
        `insert into rsvps (trip_id, member_id, club_id, status, at)
         select $1::text, $2::text, $3::text, $4::text, $5::double precision
         where $4::text <> 'in' or $6::int is null
           or (select count(*) from rsvps r where r.trip_id = $1 and r.status = 'in'
               and r.member_id <> $2 and r.member_id <> $7) < $6::int
         on conflict (trip_id, member_id) do update set
           status = excluded.status,
           at = case when rsvps.status = excluded.status then rsvps.at else excluded.at end
         returning status`,
        [t.id, me.id, clubId, p.status, now, t.seats, t.host_id],
      );
      if (!rows.length) throw new HttpError(409, "The seats are taken. Mark Maybe instead.");
      return {};
    }

    case "comment.add": {
      const t = await getTrip(p.tripId);
      const text = str(p.text, 2000);
      if (!text) throw new HttpError(400, "Write something first.");
      await limit(`comment:${me.id}`, 120, 60 * 60e3, "That's a lot of messages in an hour. Try again later.");
      const id = newId("c", 6);
      await q(
        "insert into comments (id, trip_id, club_id, member_id, text, at) values ($1, $2, $3, $4, $5, $6)",
        [id, t.id, clubId, me.id, text, now],
      );
      return { id };
    }

    case "comment.delete": {
      const [c] = await q("select id, member_id from comments where id = $1 and club_id = $2", [str(p.id, 40), clubId]);
      if (!c) return {};
      if (c.member_id !== me.id && !owner) throw new HttpError(403, "You can only delete your own messages.");
      await q("delete from comments where id = $1", [c.id]);
      return {};
    }

    case "report.save": {
      const t = await getTrip(p.tripId);
      const raw = p.count;
      const count = raw === null || raw === undefined || raw === "" ? null : Math.max(0, Math.min(9999, parseInt(raw, 10) || 0));
      const r = { worked: str(p.worked, 200), cond: str(p.cond, 120), notes: str(p.notes, 1500) };
      if (!r.worked && count === null && !r.cond && !r.notes) throw new HttpError(400, "Add at least one detail to the report.");
      await q(
        `insert into reports (trip_id, member_id, club_id, worked, count, cond, notes, at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (trip_id, member_id) do update set
           worked = excluded.worked, count = excluded.count, cond = excluded.cond, notes = excluded.notes, at = excluded.at`,
        [t.id, me.id, clubId, r.worked, count, r.cond, r.notes, now],
      );
      return {};
    }

    case "me.update": {
      await q("update members set handle = $2 where id = $1", [me.id, str(p.handle, 30)]);
      return {};
    }

    case "member.leave": {
      if (owner) throw new HttpError(400, "The organizer can't leave their own club.");
      await q("delete from members where id = $1", [me.id]);
      return {};
    }

    case "member.remove": {
      ownerOnly();
      const id = str(p.id, 40);
      if (id === me.id) throw new HttpError(400, "You can't remove yourself.");
      await q("delete from members where id = $1 and club_id = $2", [id, clubId]);
      return {};
    }

    case "club.update": {
      ownerOnly();
      const d = clubInput(p);
      await q(
        `update clubs set name = $2, city = $3, state = $4, kinds = $5, waters = $6::jsonb, tz = $7, lat = $8, lon = $9, region = $10
         where id = $1`,
        [clubId, d.name, d.city, d.state, d.kinds, JSON.stringify(d.waters), d.tz, d.lat, d.lon, d.region],
      );
      return {};
    }

    case "club.password": {
      ownerOnly();
      const pw = typeof p.password === "string" ? p.password : "";
      if (pw.trim().length < 3) throw new HttpError(400, "Use at least 3 characters.");
      await q("update clubs set pw_hash = $2 where id = $1", [clubId, hashPassword(pw)]);
      return {};
    }

    case "catch.add": {
      const speciesId = str(p.speciesId, 40);
      if (!/^[a-z0-9-]{2,40}$/.test(speciesId)) throw new HttpError(400, "Pick a species from the list.");
      const caughtOn = str(p.caughtOn, 10);
      if (caughtOn && !/^\d{4}-\d{2}-\d{2}$/.test(caughtOn)) throw new HttpError(400, "Use a real date.");
      await limit(`catch:${me.id}`, 200, 60 * 60e3, "That's a lot of catches in an hour. Try again later.");
      const id = newId("k", 6);
      await q(
        "insert into catches (id, member_id, club_id, species_id, caught_on, water, note, at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [id, me.id, clubId, speciesId, caughtOn, str(p.water, 80), str(p.note, 500), now],
      );
      return { id };
    }

    case "catch.delete": {
      await q("delete from catches where id = $1 and member_id = $2", [str(p.id, 40), me.id]);
      return {};
    }

    default:
      throw new HttpError(400, "That action isn't recognized.");
  }
});
