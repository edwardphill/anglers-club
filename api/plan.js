// POST /api/plan { club, place, question, history: [{ q, a }] }: the trip planner (the trip planner).
// In a club it needs a saved name and answers from the club's data. With no club it is open to anyone: { place: { state,
// city? } } stands in for the club, and an anonymous caller is limited by a hash of their address instead of a name.
// Errors before the answer starts come back as JSON; the answer itself streams as
// newline-delimited JSON events (see lib/planner.js).
import { readBody, str, HttpError, siteBase, clientKey } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { requireUser, currentUser, limit } from "../lib/auth.js";
import { publicPlace } from "../lib/places.js";
import { buildContext, systemPrompt, streamAnswer, todayIn } from "../lib/planner.js";

const NO_KEY = "The trip planner isn't switched on yet. The club organizer adds an Anthropic API key in Vercel (Settings, Environment Variables, ANTHROPIC_API_KEY) and redeploys.";

export default async function handler(req, res) {
  const started = Date.now();
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") throw new HttpError(405, "That request method isn't supported here.");
    await ensureSchema();
    const b = readBody(req);
    const clubId = str(b.club, 80);
    const question = str(b.question, 600);
    if (question.length < 3) throw new HttpError(400, "Ask a question first.");
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, NO_KEY);
    let club;
    if (clubId) {
      const user = await requireUser(req);
      const [row] = await q("select * from clubs where id = $1", [clubId]);
      if (!row) throw new HttpError(404, "That club isn't here anymore.");
      await limit(`plan:${user.id}`, 25, 24 * 3600e3, "That's the day's limit of trip planner questions for you. It resets tomorrow.");
      await limit(`plan-club:${clubId}`, 150, 24 * 3600e3, "The club has used its trip planner questions for today. They reset tomorrow.");
      club = { ...row, waters: Array.isArray(row.waters) ? row.waters : [] };
    } else {
      // Open to anyone: a state stands in for the club. A named user gets the same daily allowance as in a club;
      // anyone else is limited by a hash of their address, and everyone in the open shares one daily ceiling.
      club = publicPlace(b.place);
      if (!club) throw new HttpError(400, "Pick the state you fish in first.");
      const user = await currentUser(req);
      if (user) await limit(`plan:${user.id}`, 25, 24 * 3600e3, "That's the day's limit of trip planner questions for you. It resets tomorrow.");
      else await limit(`plan-anon:${clientKey(req)}`, 8, 24 * 3600e3, "That's the day's limit of trip planner questions from this device. It resets tomorrow. Add a name to ask more.");
      await limit("plan-open", 300, 24 * 3600e3, "The trip planner has hit its limit for today. It resets tomorrow.");
    }
    await limit("plan-all", 600, 24 * 3600e3, "The trip planner has hit its limit for today. It resets tomorrow.");

    const t0 = todayIn(club.tz);
    const context = await buildContext(club, t0, { base: siteBase(req) });

    // Earlier questions in this conversation, so follow-ups ("what about Saturday?") make sense.
    const history = (Array.isArray(b.history) ? b.history : []).slice(-2)
      .map((h) => ({ q: str(h && h.q, 600), a: str(h && h.a, 2500) })).filter((h) => h.q && h.a);
    const messages = [];
    history.forEach((h) => { messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a }); });
    messages.push({ role: "user", content: `<club_data>\n${context}\n</club_data>\n\n${question}` });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("X-Accel-Buffering", "no");
    const send = (o) => { try { res.write(JSON.stringify(o) + "\n"); } catch {} };
    send({ t: "status", v: club.id ? "Checking the hatch chart, the stocking schedule and the club's reports" : "Checking the hatch chart, the stocking schedule and recent reports" });
    await streamAnswer({ system: systemPrompt(club, t0), messages, club, send, deadline: started + 56000 });
    send({ t: "done" });
    res.end();
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    const message = status === 500 ? "Something went wrong on the server. Try again in a moment." : e.message;
    if (!res.headersSent) {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: message }));
    } else {
      try { res.write(JSON.stringify({ t: "error", v: message }) + "\n"); res.end(); } catch {}
    }
  }
}
