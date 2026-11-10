// POST /api/plan { club, question, history: [{ q, a }] }: the Trip Planner. Members only.
// Errors before the answer starts come back as JSON; the answer itself streams as
// newline-delimited JSON events (see lib/planner.js).
import { readBody, str, HttpError } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { requireMember, limit } from "../lib/auth.js";
import { buildContext, systemPrompt, streamAnswer, todayIn } from "../lib/planner.js";

const NO_KEY = "The Trip Planner isn't switched on yet. The club organizer adds an Anthropic API key in Vercel (Settings, Environment Variables, ANTHROPIC_API_KEY) and redeploys.";

export default async function handler(req, res) {
  const started = Date.now();
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") throw new HttpError(405, "That request method isn't supported here.");
    await ensureSchema();
    const b = readBody(req);
    const clubId = str(b.club, 80);
    const me = await requireMember(req, clubId);
    const question = str(b.question, 600);
    if (question.length < 3) throw new HttpError(400, "Ask a question first.");
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, NO_KEY);
    await limit(`plan:${me.id}`, 25, 24 * 3600e3, "That's the day's limit of Trip Planner questions for you. It resets tomorrow.");
    await limit(`plan-club:${clubId}`, 150, 24 * 3600e3, "The club has used its Trip Planner questions for today. They reset tomorrow.");

    const [row] = await q("select * from clubs where id = $1", [clubId]);
    if (!row) throw new HttpError(404, "That club isn't here anymore.");
    const club = { ...row, waters: Array.isArray(row.waters) ? row.waters : [] };
    const t0 = todayIn(club.tz);
    const context = await buildContext(club, t0);

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
    send({ t: "status", v: "Checking the hatch chart, the stocking schedule and the club's reports" });
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
