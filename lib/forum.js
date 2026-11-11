// The forum: the categories, the rules for a thread and a reply, the database work, and the pages. Anyone can read;
// posting needs a name (a saved name or Google, the same as the rest of Fly AI). Everything a visitor writes is plain
// text: it is escaped on the way out, links get rel="nofollow ugc", and the posting form is a small script (public/forum.js)
// that the pages work without.
import { q } from "./db.js";
import { HttpError } from "./http.js";
import { newId, limit } from "./auth.js";
import { clean, oneLine, isAdmin } from "./shops.js";
import { CATEGORIES, catOf, threadPath } from "./forumkeys.js";
import { esc, layout, trim } from "./pages.js";

export { CATEGORIES, catOf, threadPath, idFromKey, threadSlug } from "./forumkeys.js";
export const LIMITS = { title: [6, 120], thread: [10, 6000], reply: [2, 4000], links: 3, perPage: 25, hideAt: 3 };
const LINK_G = /(?:https?:\/\/|www\.)\S+/gi, HAS_LINK = /(?:https?:\/\/|www\.)\S+/i;

/* ---------- what a visitor may send ---------- */
const lines = (v, n) => clean(String(v ?? "").replace(/\r\n?/g, "\n"), n).replace(/\n{3,}/g, "\n\n");
function checkLinks(body) {
  if ((body.match(LINK_G) || []).length > LIMITS.links) throw new HttpError(400, `A post can hold up to ${LIMITS.links} links.`);
}
export function threadInput(b) {
  const category = catOf(String(b && b.category || ""));
  if (!category) throw new HttpError(400, "Pick a category.");
  const title = oneLine(b.title, LIMITS.title[1]), body = lines(b.body, LIMITS.thread[1]);
  if (title.length < LIMITS.title[0]) throw new HttpError(400, "Give the thread a title of at least " + LIMITS.title[0] + " characters.");
  if (body.length < LIMITS.thread[0]) throw new HttpError(400, "Write a little more in the first post.");
  if (HAS_LINK.test(title)) throw new HttpError(400, "Leave links out of the title.");
  checkLinks(body);
  return { category: category.key, title, body };
}
export function replyInput(b) {
  const body = lines(b && b.body, LIMITS.reply[1]);
  if (body.length < LIMITS.reply[0]) throw new HttpError(400, "Write a reply first.");
  checkLinks(body);
  return { body };
}

/* ---------- database ---------- */
const pubThread = (r) => ({ id: r.id, category: r.category, title: r.title, body: r.body, author: r.author_name, at: r.at, lastAt: r.last_at, replies: r.replies, pinned: r.pinned, locked: r.locked });
const pubPost = (r) => ({ id: r.id, body: r.body, author: r.author_name, at: r.at });
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

export async function createThread(user, input) {
  await limit(`forum-thread-gap:${user.id}`, 1, 60e3, "Wait a minute before starting another thread.");
  await limit(`forum-thread:${user.id}`, 5, 24 * 3600e3, "That's the day's limit of new threads. It resets tomorrow.");
  const dup = await q("select 1 from forum_threads where author_id = $1 and at > $2 and regexp_replace(lower(body), '\\s+', ' ', 'g') = $3 limit 1", [user.id, Date.now() - 24 * 3600e3, norm(input.body)]);
  if (dup.length) throw new HttpError(409, "You already posted that.");
  const id = newId("ft", 6), now = Date.now();
  await q(`insert into forum_threads (id, category, title, body, author_id, author_name, at, last_at) values ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [id, input.category, input.title, input.body, user.id, user.name, now]);
  return { id, title: input.title };
}

export async function createReply(user, threadId, input) {
  const [t] = await q("select id, locked, hidden from forum_threads where id = $1", [threadId]);
  if (!t || t.hidden) throw new HttpError(404, "That thread isn't here anymore.");
  if (t.locked) throw new HttpError(403, "That thread is locked.");
  await limit(`forum-reply-gap:${user.id}`, 1, 10e3, "Give it a few seconds before replying again.");
  await limit(`forum-reply:${user.id}`, 40, 3600e3, "That's a lot of replies for one hour. Try again later.");
  const dup = await q("select 1 from forum_posts where author_id = $1 and thread_id = $2 and at > $3 and regexp_replace(lower(body), '\\s+', ' ', 'g') = $4 limit 1", [user.id, threadId, Date.now() - 24 * 3600e3, norm(input.body)]);
  if (dup.length) throw new HttpError(409, "You already posted that.");
  const id = newId("fp", 6), now = Date.now();
  await q(`insert into forum_posts (id, thread_id, body, author_id, author_name, at) values ($1, $2, $3, $4, $5, $6)`, [id, threadId, input.body, user.id, user.name, now]);
  await recount(threadId);
  return { id };
}

// The reply count and last activity of a thread, from its visible posts.
async function recount(threadId) {
  await q(`update forum_threads set replies = (select count(*) from forum_posts where thread_id = $1 and not hidden),
     last_at = greatest(at, coalesce((select max(at) from forum_posts where thread_id = $1 and not hidden), at)) where id = $1`, [threadId]);
}

export async function report(user, kind, id, reason) {
  if (kind !== "thread" && kind !== "post") throw new HttpError(400, "Report a thread or a reply.");
  await limit(`forum-report:${user.id}`, 20, 24 * 3600e3, "That's the day's limit of reports.");
  const tbl = kind === "thread" ? "forum_threads" : "forum_posts";
  const [row] = await q(`select id, author_id from ${tbl} where id = $1`, [id]);
  if (!row) throw new HttpError(404, "That isn't here anymore.");
  if (row.author_id === user.id) throw new HttpError(400, "You can remove your own post instead.");
  await q(`insert into forum_reports (kind, target_id, reporter_id, reason, at) values ($1, $2, $3, $4, $5) on conflict do nothing`, [kind, id, user.id, oneLine(reason, 200), Date.now()]);
  const [{ n }] = await q("select count(*)::int as n from forum_reports where kind = $1 and target_id = $2", [kind, id]);
  if (n >= LIMITS.hideAt) await setHidden(kind, id, true, "reports");
  return { reports: n, hidden: n >= LIMITS.hideAt };
}

async function setHidden(kind, id, hidden, by) {
  if (kind === "thread") await q("update forum_threads set hidden = $2, hidden_by = $3 where id = $1", [id, hidden, hidden ? by : ""]);
  else {
    const [p] = await q("update forum_posts set hidden = $2, hidden_by = $3 where id = $1 returning thread_id", [id, hidden, hidden ? by : ""]);
    if (p) await recount(p.thread_id);
  }
}

// A person removes their own post (it is hidden, not erased).
export async function removeOwn(user, kind, id) {
  const tbl = kind === "thread" ? "forum_threads" : kind === "post" ? "forum_posts" : null;
  if (!tbl) throw new HttpError(400, "Remove a thread or a reply.");
  const [row] = await q(`select author_id from ${tbl} where id = $1`, [id]);
  if (!row) throw new HttpError(404, "That isn't here anymore.");
  if (row.author_id !== user.id && !isAdmin(user)) throw new HttpError(403, "You can only remove your own posts.");
  await setHidden(kind, id, true, row.author_id === user.id ? "author" : "mod");
  return {};
}

// What the site admin can do: hide or restore, pin, lock, delete for good.
export async function moderate(user, b) {
  if (!isAdmin(user)) throw new HttpError(403, "Only the site admin can do that.");
  const kind = b.kind === "post" ? "post" : "thread", id = String(b.id || "").slice(0, 40), action = String(b.action || "");
  const tbl = kind === "thread" ? "forum_threads" : "forum_posts";
  const [row] = await q(`select id from ${tbl} where id = $1`, [id]);
  if (!row) throw new HttpError(404, "That isn't here anymore.");
  if (action === "hide" || action === "unhide") { await setHidden(kind, id, action === "hide", "mod"); if (action === "unhide") await q("delete from forum_reports where kind = $1 and target_id = $2", [kind, id]); }
  else if (action === "delete") {
    if (kind === "post") { const [p] = await q("delete from forum_posts where id = $1 returning thread_id", [id]); if (p) await recount(p.thread_id); }
    else await q("delete from forum_threads where id = $1", [id]);
    await q("delete from forum_reports where kind = $1 and target_id = $2", [kind, id]);
  } else if (kind === "thread" && (action === "pin" || action === "unpin")) await q("update forum_threads set pinned = $2 where id = $1", [id, action === "pin"]);
  else if (kind === "thread" && (action === "lock" || action === "unlock")) await q("update forum_threads set locked = $2 where id = $1", [id, action === "lock"]);
  else throw new HttpError(400, "That isn't an action.");
  return {};
}

// For the admin: everything hidden or reported, so it can be restored or deleted.
export async function reported() {
  const threads = await q(`select t.id, t.title, t.body, t.author_name, t.hidden, t.hidden_by, (select count(*)::int from forum_reports r where r.kind = 'thread' and r.target_id = t.id) as reports
    from forum_threads t where t.hidden or exists (select 1 from forum_reports r where r.kind = 'thread' and r.target_id = t.id) order by t.last_at desc limit 50`);
  const posts = await q(`select p.id, p.thread_id, p.body, p.author_name, p.hidden, p.hidden_by, (select count(*)::int from forum_reports r where r.kind = 'post' and r.target_id = p.id) as reports
    from forum_posts p where p.hidden or exists (select 1 from forum_reports r where r.kind = 'post' and r.target_id = p.id) order by p.at desc limit 50`);
  return {
    threads: threads.map((r) => ({ id: r.id, title: r.title, body: trim(r.body, 200), author: r.author_name, hidden: r.hidden, by: r.hidden_by, reports: r.reports })),
    posts: posts.map((r) => ({ id: r.id, thread: r.thread_id, body: trim(r.body, 200), author: r.author_name, hidden: r.hidden, by: r.hidden_by, reports: r.reports })),
  };
}

/* ---------- reading ---------- */
const COLS = "id, category, title, body, author_name, at, last_at, replies, pinned, locked";
export async function categoryCounts() {
  const rows = await q("select category, count(*)::int as n, max(last_at) as last from forum_threads where not hidden group by category");
  return Object.fromEntries(rows.map((r) => [r.category, { n: r.n, last: r.last }]));
}
export async function listThreads({ cat = "", page = 1 } = {}) {
  const per = LIMITS.perPage, off = (Math.max(1, page) - 1) * per;
  const where = cat ? "where not hidden and category = $1" : "where not hidden", args = cat ? [cat] : [];
  const [{ n }] = await q(`select count(*)::int as n from forum_threads ${where}`, args);
  const rows = await q(`select ${COLS} from forum_threads ${where} order by ${cat ? "pinned desc, " : ""}last_at desc limit ${per} offset ${off}`, args);
  return { threads: rows.map(pubThread), total: n, pages: Math.max(1, Math.ceil(n / per)) };
}
export async function getThread(id) {
  const [t] = await q(`select ${COLS} from forum_threads where id = $1 and not hidden`, [id]);
  if (!t) return null;
  const posts = await q("select id, body, author_name, at from forum_posts where thread_id = $1 and not hidden order by at limit 500", [id]);
  return { thread: pubThread(t), posts: posts.map(pubPost) };
}
// For the sitemap and llms.txt.
export async function recentThreads(n = 500) {
  const rows = await q(`select id, title, category, last_at from forum_threads where not hidden order by last_at desc limit ${Math.min(2000, n)}`);
  return rows.map((r) => ({ id: r.id, title: r.title, category: r.category, lastAt: r.last_at }));
}

/* ---------- the pages ---------- */
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (ms) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };

// Plain text to HTML: paragraphs and line breaks, and links (http and https only) that search engines are told not to trust.
export function renderBody(text) {
  const link = (s) => s.replace(/\b(?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"]/gi, (u) => {
    const href = /^www\./i.test(u) ? "https://" + u : u;
    return `<a href="${href}" rel="nofollow ugc noopener" target="_blank">${u.length > 60 ? u.slice(0, 57) + "…" : u}</a>`;
  });
  return String(text).split(/\n{2,}/).map((p) => `<p>${link(esc(p)).replace(/\n/g, "<br>")}</p>`).join("");
}

const FORUM_CSS = `.fx-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin:14px 0}
.fx-cat{display:block;border:1px solid var(--hair);background:var(--paper);border-radius:10px;padding:12px 14px;text-decoration:none;color:var(--ink)}
.fx-cat:hover{border-color:var(--green)}.fx-cat b{display:block;font-weight:600}.fx-cat span{display:block;color:var(--muted);font-size:.88rem;margin-top:2px}
.fx-list{list-style:none;padding:0;margin:10px 0}.fx-row{border-top:1px solid var(--hair);padding:12px 2px}.fx-row:last-child{border-bottom:1px solid var(--hair)}
.fx-row a.t{font-weight:600;color:var(--ink);text-decoration:none;font-size:1.02rem}.fx-row a.t:hover{color:var(--green)}
.fx-meta{color:var(--muted);font-size:.86rem;margin-top:2px}.fx-tag{display:inline-block;font:500 .64rem/1 var(--label);letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--hair);border-radius:4px;padding:3px 6px;margin-right:6px;color:var(--muted);background:var(--paper)}
.fx-post{border:1px solid var(--hair);background:var(--paper);border-radius:10px;padding:14px 16px;margin:12px 0}.fx-post .who{font-weight:600}.fx-post .when{color:var(--muted);font-size:.86rem;margin-left:8px}
.fx-post p{margin:8px 0;overflow-wrap:anywhere}.fx-act{display:flex;gap:14px;margin-top:6px;font-size:.84rem}.fx-act button{background:none;border:0;padding:0;color:var(--muted);cursor:pointer;font:inherit;text-decoration:underline}.fx-act button:hover{color:var(--ink)}
.fx-form{border:1px solid var(--hair);background:var(--paper);border-radius:10px;padding:14px 16px;margin:14px 0;display:grid;gap:10px}
.fx-form label{display:grid;gap:4px;font:500 .8rem/1.3 var(--sans);color:var(--muted)}.fx-form input,.fx-form textarea,.fx-form select{font:400 1rem/1.4 var(--sans);border:1px solid var(--hair);border-radius:8px;padding:9px 10px;background:#fff;color:var(--ink);width:100%}
.fx-form input:focus,.fx-form textarea:focus,.fx-form select:focus{outline:2px solid var(--green-wash);border-color:var(--green)}
.fx-form .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.fx-msg{color:#9a2d1f;font-size:.9rem;min-height:1.2em}
.fx-form button.cta{justify-self:start;cursor:pointer;border:0}.fx-form button[disabled]{opacity:.6}details.fx-new summary{list-style:none;cursor:pointer;display:inline-block}details.fx-new summary::-webkit-details-marker{display:none}
.fx-pager{display:flex;gap:14px;margin:14px 0;font-size:.92rem}.fx-mod{margin:16px 0;border:1px dashed var(--hair);border-radius:10px;padding:10px 14px}.fx-mod[hidden]{display:none}.fx-mod li{margin:6px 0}
.fx-who{font-size:.88rem;color:var(--muted);margin:12px 0 0}.fx-who button{background:none;border:0;padding:0;color:var(--green);cursor:pointer;font:inherit;text-decoration:underline}
.fx-crumb{font-size:.88rem;color:var(--muted);margin:16px 0 0}.fx-crumb a{color:var(--muted)}`;
const SCRIPT = `<script src="/forum.js" defer></script>`;
const NOTE = "Posts are written by Fly AI's visitors, not by Fly AI, and aren't checked. Check flows, closures and regulations with the agency before you go. Report anything that doesn't belong.";
const noscript = `<noscript><p class="muted">Posting needs JavaScript. Reading doesn't.</p></noscript>`;

function threadRow(t, withCat) {
  const c = catOf(t.category);
  return `<li class="fx-row"><a class="t" href="${esc(threadPath(t))}">${esc(t.title)}</a>
<div class="fx-meta">${t.pinned ? `<span class="fx-tag">Pinned</span>` : ""}${t.locked ? `<span class="fx-tag">Locked</span>` : ""}${withCat && c ? `<span class="fx-tag">${esc(c.name)}</span>` : ""}${esc(t.author)} · ${t.replies} ${t.replies === 1 ? "reply" : "replies"} · last activity ${esc(day(t.lastAt))}</div></li>`;
}
const CATS_ATTR = esc(JSON.stringify(CATEGORIES.map((c) => [c.key, c.name])));
const composeThread = (cat) => `<details class="fx-new"><summary class="cta">Start a thread</summary><div data-fx="thread" data-cat="${esc(cat)}" data-cats="${CATS_ATTR}"></div></details>`;
const modPanel = `<section class="fx-mod" id="fx-mod" hidden><h2>Reported and hidden</h2><div id="fx-mod-list"></div></section>`;

export function forumIndex({ base, counts, latest }) {
  const title = "Fly fishing and hunting forum | Fly AI", description = "Fly AI's forum: ask about rivers, hatches, flies, gear, hunting and trips, and start a thread. Open to read; add a name to post.";
  const body = `<h1>Forum</h1>
<p class="lede">Ask a question, share what you found on the water, or find someone to fish with. Anyone can read; you add a name to post.</p>
${composeThread("")}${noscript}
<h2>Categories</h2>
<div class="fx-cats">${CATEGORIES.map((c) => `<a class="fx-cat" href="/forum/c/${c.key}"><b>${esc(c.name)}</b><span>${esc(c.text)}</span><span>${(counts[c.key] || { n: 0 }).n} ${((counts[c.key] || { n: 0 }).n) === 1 ? "thread" : "threads"}</span></a>`).join("")}</div>
<h2>Latest threads</h2>
${latest.length ? `<ul class="fx-list">${latest.map((t) => threadRow(t, true)).join("")}</ul>` : `<p class="muted">No threads yet. Start the first one.</p>`}
${modPanel}`;
  const data = { "@context": "https://schema.org", "@type": "CollectionPage", name: "Fly AI forum", description, url: base + "/forum",
    mainEntity: { "@type": "ItemList", itemListElement: latest.map((t, i) => ({ "@type": "ListItem", position: i + 1, url: base + threadPath(t), name: t.title })) } };
  return layout({ base, path: "/forum", title, description, ld: data, body, head: `<style>${FORUM_CSS}</style>`, foot: SCRIPT, note: NOTE });
}

export function forumCategory({ base, cat, threads, page, pages, total }) {
  const path = `/forum/c/${cat.key}`;
  const title = `${cat.name} | Forum | Fly AI`, description = `${cat.text} ${total} ${total === 1 ? "thread" : "threads"} on Fly AI's forum.`;
  const pager = pages > 1 ? `<div class="fx-pager">${page > 1 ? `<a href="${path}${page > 2 ? "?page=" + (page - 1) : ""}">Newer</a>` : ""}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${path}?page=${page + 1}">Older</a>` : ""}</div>` : "";
  const body = `<p class="fx-crumb"><a href="/forum">Forum</a> › ${esc(cat.name)}</p>
<h1>${esc(cat.name)}</h1><p class="lede">${esc(cat.text)}</p>
${composeThread(cat.key)}${noscript}
${threads.length ? `<ul class="fx-list">${threads.map((t) => threadRow(t, false)).join("")}</ul>` : `<p class="muted">No threads here yet. Start the first one.</p>`}${pager}`;
  const data = { "@context": "https://schema.org", "@type": "CollectionPage", name: cat.name, description, url: base + path,
    mainEntity: { "@type": "ItemList", itemListElement: threads.map((t, i) => ({ "@type": "ListItem", position: i + 1, url: base + threadPath(t), name: t.title })) } };
  return layout({ base, path: page > 1 ? `${path}?page=${page}` : path, title, description, ld: data, body, head: `<style>${FORUM_CSS}</style>`, foot: SCRIPT, note: NOTE, noindex: page > 1 });
}

const postHtml = (p, kind) => `<article class="fx-post" id="${esc(p.id)}"><div><span class="who">${esc(p.author)}</span><span class="when">${esc(day(p.at))}</span></div>${renderBody(p.body)}
<div class="fx-act"><button type="button" data-report="${kind}" data-id="${esc(p.id)}">Report</button><button type="button" data-own="${kind}" data-id="${esc(p.id)}" hidden>Remove</button>
<span data-mod="${kind}" data-id="${esc(p.id)}" hidden>${kind === "thread" ? `<button type="button" data-act="pin">Pin</button> <button type="button" data-act="lock">Lock</button> ` : ""}<button type="button" data-act="hide">Hide</button> <button type="button" data-act="delete">Delete</button></span></div></article>`;

export function forumThread({ base, thread: t, posts }) {
  const c = catOf(t.category), path = threadPath(t), url = base + path;
  const title = `${t.title} | ${c ? c.name : "Forum"} | Fly AI`, description = trim(t.body, 155);
  const body = `<p class="fx-crumb"><a href="/forum">Forum</a> › <a href="/forum/c/${esc(t.category)}">${esc(c ? c.name : t.category)}</a></p>
<h1>${esc(t.title)}</h1>
<p class="fx-meta">${t.pinned ? `<span class="fx-tag">Pinned</span>` : ""}${t.locked ? `<span class="fx-tag">Locked</span>` : ""}${t.replies} ${t.replies === 1 ? "reply" : "replies"}</p>
${postHtml({ id: t.id, author: t.author, at: t.at, body: t.body }, "thread")}
${posts.length ? `<h2>${posts.length} ${posts.length === 1 ? "reply" : "replies"}</h2>${posts.map((p) => postHtml(p, "post")).join("")}` : ""}
${t.locked ? `<p class="muted">This thread is locked.</p>` : `<h2>Reply</h2><div data-fx="reply" data-thread="${esc(t.id)}"></div>${noscript}`}`;
  const person = (name) => ({ "@type": "Person", name });
  const data = { "@context": "https://schema.org", "@type": "DiscussionForumPosting", "@id": url, url, headline: t.title, text: trim(t.body, 2000), inLanguage: "en-US",
    author: person(t.author), datePublished: isoDay(t.at), dateModified: isoDay(t.lastAt), articleSection: c ? c.name : undefined,
    interactionStatistic: { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: t.replies },
    comment: posts.slice(0, 50).map((p) => ({ "@type": "Comment", text: trim(p.body, 1000), author: person(p.author), datePublished: isoDay(p.at), url: `${url}#${p.id}` })) };
  return layout({ base, path, title, description, ld: data, body, head: `<style>${FORUM_CSS}</style>`, foot: `<div id="fx-thread" data-id="${esc(t.id)}" hidden></div>` + SCRIPT, note: NOTE });
}

