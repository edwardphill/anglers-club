// The forum's API. Reading is open (the pages are server-rendered in api/page.js); posting needs a name.
//   GET  /api/forum?op=me                        what the caller may do (admin buttons, which posts are theirs)
//   GET  /api/forum?op=reported                  admin: hidden and reported posts
//   POST /api/forum { op: "thread", category, title, body, website }
//   POST /api/forum { op: "reply", thread, body, website }
//   POST /api/forum { op: "report", kind, id, reason }
//   POST /api/forum { op: "remove", kind, id }   the author hides their own post (an admin may too)
//   POST /api/forum { op: "mod", kind, id, action: hide|unhide|delete|pin|unpin|lock|unlock }   admin only
// "website" is a field people never see: anything written in it is a bot, and the post is dropped without an error.
import { route, readBody, str, clientIp, HttpError } from "../lib/http.js";
import { ensureSchema, q } from "../lib/db.js";
import { requireUser, currentUser, limit } from "../lib/auth.js";
import { isAdmin } from "../lib/shops.js";
import { threadInput, replyInput, createThread, createReply, report, removeOwn, moderate, reported, threadPath } from "../lib/forum.js";

export default route(["GET", "POST"], async (req) => {
  await ensureSchema();
  if (req.method === "GET") {
    const op = str(req.query && req.query.op, 20);
    const user = await currentUser(req);
    if (op === "me") {
      const own = user ? {
        threads: (await q("select id from forum_threads where author_id = $1 and not hidden order by at desc limit 200", [user.id])).map((r) => r.id),
        posts: (await q("select id from forum_posts where author_id = $1 and not hidden order by at desc limit 400", [user.id])).map((r) => r.id),
      } : { threads: [], posts: [] };
      return { user: user ? { name: user.name } : null, admin: isAdmin(user), own };
    }
    if (op === "reported") {
      if (!isAdmin(user)) throw new HttpError(403, "Only the site admin can see that.");
      return await reported();
    }
    throw new HttpError(400, "That isn't something the forum does.");
  }
  const b = readBody(req);
  const op = str(b.op, 20);
  const user = await requireUser(req);
  if (op === "thread" || op === "reply") {
    // A hidden field that only a script fills in.
    if (typeof b.website === "string" && b.website.trim()) return { ok: true, url: "/forum" };
    // New names are free, so the address is limited too.
    await limit(`forum-ip:${op}:${clientIp(req)}`, op === "thread" ? 10 : 80, 24 * 3600e3, "That's a lot of posts from this connection today. Try again tomorrow.");
    if (op === "thread") {
      const t = await createThread(user, threadInput(b));
      return { ok: true, url: threadPath(t) };
    }
    const id = str(b.thread, 40);
    const input = replyInput(b);
    const r = await createReply(user, id, input);
    const [t] = await q("select id, title from forum_threads where id = $1", [id]);
    return { ok: true, url: threadPath(t) + "#" + r.id };
  }
  if (op === "report") return await report(user, str(b.kind, 10), str(b.id, 40), b.reason);
  if (op === "remove") return await removeOwn(user, str(b.kind, 10), str(b.id, 40));
  if (op === "mod") return await moderate(user, b);
  throw new HttpError(400, "That isn't something the forum does.");
});
