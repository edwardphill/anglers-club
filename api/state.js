// GET /api/state?club=ID: everything a signed-in member sees for one club.
import { route, str } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { requireMember } from "../lib/auth.js";
import { clubOut } from "../lib/clubs.js";

export default route(["GET"], async (req) => {
  await ensureSchema();
  const clubId = str(req.query?.club, 80);
  const me = await requireMember(req, clubId);

  const [clubs, members, trips, rsvps, comments, reports] = await Promise.all([
    q("select * from clubs where id = $1", [clubId]),
    q("select id, handle, role, at from members where club_id = $1 order by at", [clubId]),
    q(
      `select id, kind, water, title, date, time, meet, seats, cond, notes, host_id, canceled, at
       from trips where club_id = $1 order by date, time limit 3000`,
      [clubId],
    ),
    q("select trip_id, member_id, status, at from rsvps where club_id = $1", [clubId]),
    q("select id, trip_id, member_id, text, at from comments where club_id = $1 order by at limit 6000", [clubId]),
    q("select trip_id, member_id, worked, count, cond, notes, at from reports where club_id = $1", [clubId]),
  ]);

  return {
    club: clubOut(clubs[0]),
    me: { id: me.id, role: me.role },
    members: members.map((m) => ({ id: m.id, handle: m.handle, role: m.role, at: m.at })),
    trips: trips.map((t) => ({
      id: t.id, kind: t.kind, water: t.water, title: t.title, date: t.date, time: t.time, meet: t.meet,
      seats: t.seats, cond: t.cond, notes: t.notes, hostId: t.host_id, canceled: t.canceled, at: t.at,
    })),
    rsvps: rsvps.map((r) => ({ id: `${r.trip_id}~${r.member_id}`, tripId: r.trip_id, uid: r.member_id, status: r.status, at: r.at })),
    comments: comments.map((c) => ({ id: c.id, tripId: c.trip_id, uid: c.member_id, text: c.text, at: c.at })),
    reports: reports.map((r) => ({
      id: `${r.trip_id}~${r.member_id}`, tripId: r.trip_id, uid: r.member_id,
      worked: r.worked, count: r.count === null ? "" : r.count, cond: r.cond, notes: r.notes, at: r.at,
    })),
  };
});
