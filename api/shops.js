// The fly shop side of the site: shops, their weekly river reports, and messages between anglers and shops.
// One function, so the site stays inside Vercel's function limit. Modeled on Nina's vendors, listings and inquiries.
//
// GET  /api/shops                      active shops, each with its newest report date
// GET  /api/shops?op=shop&slug=        one shop with its reports (live first, then the dated archive)
// GET  /api/shops?op=reports&river=    live reports for a river (the Fly Picker's results card)
// GET  /api/shops?op=latest            the newest live report for each river
// GET  /api/shops?op=mine              the signed-in person's shops, invites accepted on sight; {admin}
// GET  /api/shops?op=threads|thread|unread   conversations (anglers asking shops, and the shops' inbox)
// GET  /api/shops?photo=<id>           a published report's photo (JPEG); public at /photos/<id>.jpg (vercel.json rewrite)
// GET  /api/shops?op=guides[&river=]   active guides; ?op=guide&slug= one guide; ?op=myguide the signed-in person's own profile
// POST /api/shops {op, ...}            shop_create (admin), shop_update, invite, report_photo, report_save,
//                                      shop_status (admin), report_remove, guide_save, guide_status, guide_delete,
//                                      thread_start (a shop or a guide), thread_send, thread_read, thread_status
//
// Photos are read by Claude to draft the report; the shop edits and publishes. A shop's words never act as
// instructions. Public pages and results only ever show published reports from active shops.
import { route, readBody, clientIp, str, HttpError } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { requireUser, newId, limit } from "../lib/auth.js";
import { stripJpeg } from "../lib/jpeg.js";
import {
  RIVERS, LIVE_DAYS, DAY, ymd, ageDays, isLive, slugify, isAdmin, clean, oneLine,
  reportFields, checkReport, draftFromPhoto, drafting, DRAFT_MODEL, shopOut, reportOut, REPORT_COLS,
} from "../lib/shops.js";
import { guideFields, guideSlug, guideOut, resolveShops } from "../lib/guides.js";

const MAX_B64 = 2400000;
const DAILY_DRAFTS_PER_SHOP = 20;

// ---------- who may do what ----------

// "owner" or "staff" for members; "admin" for a site admin on a shop still managed by Nina (not yet claimed).
async function roleIn(user, shopId) {
  const [m] = await q("select role from shop_members where shop_id = $1 and user_id = $2", [shopId, user.id]);
  if (m) return m.role;
  if (isAdmin(user)) {
    const [s] = await q("select managed from fly_shops where id = $1", [shopId]);
    if (s && s.managed) return "admin";
  }
  return "";
}

async function shopFor(ref) {
  const id = str(ref, 80);
  const [s] = await q("select * from fly_shops where id = $1 or slug = $1", [id]);
  if (!s) throw new HttpError(404, "That shop isn't here.");
  return s;
}

async function memberShop(user, ref) {
  const s = await shopFor(ref);
  const role = await roleIn(user, s.id);
  if (!role) throw new HttpError(403, "You're not part of that shop.");
  return { shop: s, role };
}

// A shop's pending invites for this person's verified Google address become memberships.
async function claimInvites(user) {
  if (!user.g || !user.email) return;
  const rows = await q("select id, shop_id, role from shop_invites where lower(email) = lower($1) and accepted_at is null", [user.email]);
  const now = Date.now();
  for (const i of rows) {
    await q(
      `insert into shop_members (shop_id, user_id, role, at) values ($1, $2, $3, $4) on conflict (shop_id, user_id) do nothing`,
      [i.shop_id, user.id, i.role, now],
    );
    await q("update shop_invites set accepted_at = $2 where id = $1", [i.id, now]);
    await q("update fly_shops set managed = false where id = $1", [i.shop_id]);
  }
}

function shopFields(b) {
  const website = str(b.website, 200);
  if (website && !/^https:\/\/[^\s]+$/.test(website)) throw new HttpError(400, "A website starts with https://");
  const instagram = str(b.instagram, 31).replace(/^@/, "");
  if (instagram && !/^[A-Za-z0-9._]{1,30}$/.test(instagram)) throw new HttpError(400, "An Instagram name is letters, numbers, dots and underscores.");
  const num = (v, lo, hi) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : undefined);
  const lat = num(b.lat, -90, 90), lon = num(b.lon, -180, 180);
  if (lat === undefined || lon === undefined) throw new HttpError(400, "That location isn't on the map.");
  const rivers = [...new Set((Array.isArray(b.rivers) ? b.rivers : []).filter((k) => typeof k === "string" && RIVERS[k]))].slice(0, 12);
  const state = str(b.state, 2).toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) throw new HttpError(400, "Use the two-letter state.");
  return {
    name: oneLine(b.name, 80), city: oneLine(b.city, 60), state, lat, lon, website, instagram,
    about: clean(b.about, 400), rivers,
  };
}

// ---------- photos ----------

async function servePhoto(req, res) {
  await ensureSchema();
  const id = str(req.query.photo, 80).replace(/\.jpe?g$/i, "");
  const [p] = id
    ? await q(
      `select p.b64 from shop_photos p
        where p.id = $1 and exists (select 1 from shop_reports r join fly_shops s on s.id = r.shop_id
                                     where r.photo_id = p.id and r.status = 'live' and s.status = 'active')`,
      [id],
    )
    : [];
  if (!p) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Not found");
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(Buffer.from(p.b64, "base64"));
}

// ---------- reads ----------

// Conversations the person can see: the ones they started as an angler, their shops' inboxes (a site admin also sees
// shops still managed by Nina) and their own guide profile's inbox. shop_side says which side of the thread this person
// is on. A thread belongs to a shop or to a guide; for a guide thread the "shop" fields carry the guide's name and slug.
async function threadRows(user, extra = "", params = []) {
  const side = `(t.shop_id in (select shop_id from shop_members where user_id = $1) or ($2::boolean and coalesce(s.managed, false))
     or t.guide_id in (select id from guides where user_id = $1))`;
  return q(
    `select t.id, t.shop_id, t.guide_id, t.report_id, t.from_user, t.from_name, t.subject, t.status, t.last_at, t.buyer_read_at, t.shop_read_at,
            coalesce(s.name, g.name) as shop_name, coalesce(s.slug, g.slug) as shop_slug, (t.from_user <> $1 and ${side}) as shop_side
       from shop_threads t left join fly_shops s on s.id = t.shop_id left join guides g on g.id = t.guide_id
      where (t.from_user = $1 or ${side}) ${extra} order by t.last_at desc limit 60`,
    [user.id, isAdmin(user), ...params],
  );
}

const threadOut = (t) => ({
  id: t.id, kind: t.guide_id ? "guide" : "shop", shop: { id: t.shop_id || t.guide_id, slug: t.shop_slug, name: t.shop_name }, reportId: t.report_id || "",
  side: t.shop_side ? "shop" : "angler", from: t.from_name || "An angler", subject: t.subject, status: t.status, last: Number(t.last_at),
  unread: t.shop_side ? Number(t.last_at) > Number(t.shop_read_at) : Number(t.last_at) > Number(t.buyer_read_at),
});

async function unreadCount(user) {
  return (await threadRows(user)).filter((t) => threadOut(t).unread).length;
}

// Guides as the API and pages show them: the shops they list resolved against the listed shops.
async function guidesOut(rows) {
  const listed = await q("select slug, name, instagram from fly_shops where status = 'active'");
  return rows.map((g) => guideOut({ ...g, shops: resolveShops(g.shops, listed) }));
}

async function read(req, op) {
  const now = Date.now();
  if (op === "shops") {
    const rows = await q(
      `select s.*, (select max(r.reported_on) from shop_reports r where r.shop_id = s.id and r.status = 'live') as last_report
         from fly_shops s where s.status = 'active' order by s.name limit 300`,
    );
    return { shops: rows.map(shopOut) };
  }
  if (op === "shop") {
    const [s] = await q("select * from fly_shops where slug = $1 and status = 'active'", [str(req.query.slug, 60)]);
    if (!s) throw new HttpError(404, "That shop isn't here.");
    const rows = await q(
      `select ${REPORT_COLS} from shop_reports r join fly_shops s on s.id = r.shop_id
        where r.shop_id = $1 and r.status = 'live' order by r.reported_on desc, r.at desc limit 60`,
      [s.id],
    );
    return { shop: shopOut(s), reports: rows.map(reportOut) };
  }
  if (op === "reports") {
    const river = str(req.query.river, 60);
    if (!RIVERS[river]) return { reports: [] };
    const rows = await q(
      `select ${REPORT_COLS} from shop_reports r join fly_shops s on s.id = r.shop_id
        where r.river = $1 and r.status = 'live' and s.status = 'active' and r.reported_on >= $2
        order by r.reported_on desc, r.at desc limit 6`,
      [river, ymd(now - LIVE_DAYS * DAY)],
    );
    return { reports: rows.map(reportOut) };
  }
  if (op === "latest") {
    const rows = await q(
      `select distinct on (r.river) ${REPORT_COLS} from shop_reports r join fly_shops s on s.id = r.shop_id
        where r.status = 'live' and s.status = 'active' and r.reported_on >= $1 order by r.river, r.reported_on desc, r.at desc`,
      [ymd(now - LIVE_DAYS * DAY)],
    );
    return { latest: Object.fromEntries(rows.map((r) => [r.river, reportOut(r)])) };
  }

  if (op === "guides") {
    const river = str(req.query.river, 60);
    const rows = RIVERS[river]
      ? await q("select * from guides where status = 'active' and rivers @> jsonb_build_array($1::text) order by name limit 300", [river])
      : await q("select * from guides where status = 'active' order by name limit 300");
    return { guides: await guidesOut(rows) };
  }
  if (op === "guide") {
    const [g] = await q("select * from guides where slug = $1 and status = 'active'", [str(req.query.slug, 60).toLowerCase()]);
    if (!g) throw new HttpError(404, "That guide isn't here.");
    return { guide: (await guidesOut([g]))[0] };
  }

  const user = await requireUser(req);
  if (op === "myguide") {
    const [g] = await q("select * from guides where user_id = $1", [user.id]);
    return { guide: g ? (await guidesOut([g]))[0] : null, google: !!user.g, admin: isAdmin(user), ...(isAdmin(user) ? { all: await guidesOut(await q("select * from guides order by name limit 300")) } : {}) };
  }
  if (op === "mine") {
    await claimInvites(user);
    const admin = isAdmin(user);
    const rows = await q(
      `select s.*, m.role from fly_shops s join shop_members m on m.shop_id = s.id where m.user_id = $1 order by s.name`,
      [user.id],
    );
    const shops = rows.map((s) => ({ ...shopOut(s), role: s.role }));
    if (admin) {
      for (const s of await q("select * from fly_shops where managed = true or status <> 'active' order by name")) {
        if (!shops.some((x) => x.id === s.id)) shops.push({ ...shopOut(s), role: "admin", status: s.status });
      }
    }
    for (const s of shops) {
      const reports = await q(
        `select ${REPORT_COLS} from shop_reports r join fly_shops s on s.id = r.shop_id
          where r.shop_id = $1 and r.status = 'live' order by r.reported_on desc, r.at desc limit 20`,
        [s.id],
      );
      s.reports = reports.map(reportOut);
    }
    const invites = user.g && user.email
      ? await q("select i.id, s.name from shop_invites i join fly_shops s on s.id = i.shop_id where lower(i.email) = lower($1) and i.accepted_at is null", [user.email])
      : [];
    return { admin, shops, invites, drafting: drafting() };
  }
  if (op === "unread") return { unread: await unreadCount(user) };
  if (op === "threads") return { threads: (await threadRows(user)).map(threadOut) };
  if (op === "thread") {
    const [t] = await threadRows(user, "and t.id = $3", [str(req.query.id, 80)]);
    if (!t) throw new HttpError(404, "That conversation isn't here.");
    const msgs = await q("select id, from_shop, body, at from shop_messages where thread_id = $1 order by id limit 500", [t.id]);
    return { thread: threadOut(t), messages: msgs.map((m) => ({ id: Number(m.id), fromShop: !!m.from_shop, body: m.body, at: Number(m.at) })) };
  }
  throw new HttpError(400, "That isn't something this page can ask for.");
}

// ---------- writes ----------

async function write(req, op) {
  const user = await requireUser(req);
  const b = readBody(req);
  const now = Date.now();
  const ip = clientIp(req);

  if (op === "shop_create") {
    if (!isAdmin(user)) throw new HttpError(403, "Only the site admin can list a shop.");
    const f = shopFields(b);
    if (f.name.length < 2) throw new HttpError(400, "Add the shop's name.");
    let slug = slugify(f.name) || "shop";
    if (slug.length < 3) slug += "-fly-shop";
    const [taken] = await q("select 1 as x from fly_shops where slug = $1", [slug]);
    if (taken) slug = `${slug.slice(0, 35)}-${newId("", 2)}`;
    const id = newId("shp");
    await q(
      `insert into fly_shops (id, slug, name, city, state, lat, lon, website, instagram, about, rivers, managed, created_by, at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, true, $12, $13)`,
      [id, slug, f.name, f.city, f.state, f.lat, f.lon, f.website, f.instagram, f.about, JSON.stringify(f.rivers), user.id, now],
    );
    const email = str(b.owner_email, 120).toLowerCase();
    if (email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "That email address doesn't look right.");
      await q("insert into shop_invites (id, shop_id, email, role, at) values ($1, $2, $3, 'owner', $4)", [newId("inv"), id, email, now]);
    }
    const [s] = await q("select * from fly_shops where id = $1", [id]);
    return { shop: shopOut(s) };
  }

  if (op === "shop_update") {
    const { shop, role } = await memberShop(user, b.shop);
    if (role === "staff") throw new HttpError(403, "Only a shop's owner can change its details.");
    const f = shopFields({ ...shop, ...b });
    if (f.name.length < 2) throw new HttpError(400, "Add the shop's name.");
    await q(
      `update fly_shops set name = $2, city = $3, state = $4, lat = $5, lon = $6, website = $7, instagram = $8, about = $9, rivers = $10::jsonb where id = $1`,
      [shop.id, f.name, f.city, f.state, f.lat, f.lon, f.website, f.instagram, f.about, JSON.stringify(f.rivers)],
    );
    const [s] = await q("select * from fly_shops where id = $1", [shop.id]);
    return { shop: shopOut(s) };
  }

  // Taking a shop off the site (and putting it back) is the admin's call, whoever runs the shop.
  if (op === "shop_status") {
    if (!isAdmin(user)) throw new HttpError(403, "Only the site admin can do that.");
    const s = await shopFor(b.shop);
    await q("update fly_shops set status = $2 where id = $1", [s.id, b.status === "hidden" ? "hidden" : "active"]);
    return { ok: true };
  }

  if (op === "invite") {
    const { shop, role } = await memberShop(user, b.shop);
    if (role === "staff") throw new HttpError(403, "Only a shop's owner can invite people.");
    const email = str(b.email, 120).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "That email address doesn't look right.");
    await limit(`shopinvite:${user.id}`, 20, DAY, "That's a lot of invites for one day.");
    await q("delete from shop_invites where shop_id = $1 and lower(email) = $2 and accepted_at is null", [shop.id, email]);
    await q("insert into shop_invites (id, shop_id, email, role, at) values ($1, $2, $3, $4, $5)", [newId("inv"), shop.id, email, b.role === "owner" ? "owner" : "staff", now]);
    return { ok: true };
  }

  if (op === "report_photo") {
    const { shop } = await memberShop(user, b.shop);
    const b64 = typeof b.image === "string" ? b.image : "";
    if (!b64 || b64.length > MAX_B64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new HttpError(413, "That photo is too large or isn't a JPEG. Try a smaller one.");
    let photo;
    try { photo = stripJpeg(Buffer.from(b64, "base64"), 2400); } catch { throw new HttpError(415, "That photo isn't a JPEG we can use."); }
    await limit(`shopphoto:${shop.id}`, DAILY_DRAFTS_PER_SHOP, DAY, "This shop has used today's photo uploads. Try again tomorrow.");
    await limit(`shopphotou:${user.id}`, 40, DAY, "That's a lot of uploads for one day. Try again tomorrow.");
    const photoId = newId("ph", 12);
    const clean64 = photo.buf.toString("base64");
    await q("insert into shop_photos (id, shop_id, b64, width, height, at) values ($1, $2, $3, $4, $5, $6)", [photoId, shop.id, clean64, photo.width, photo.height, now]);
    let result = { draft: null, usage: null, error: drafting() ? null : "drafting_off" };
    if (drafting()) result = await draftFromPhoto(clean64);
    const u = result.usage || {};
    await q(
      "insert into shop_drafts (shop_id, user_id, at, model, input_tokens, output_tokens, ok) values ($1, $2, $3, $4, $5, $6, $7)",
      [shop.id, user.id, now, DRAFT_MODEL(), u.input_tokens || 0, u.output_tokens || 0, !!result.draft],
    );
    return { photoId, width: photo.width, height: photo.height, draft: result.draft, draftError: result.draft ? null : result.error || "no_draft" };
  }

  if (op === "report_save") {
    const { shop } = await memberShop(user, b.shop);
    const f = checkReport(reportFields(b), now);
    await limit(`shopreport:${shop.id}`, 30, DAY, "That's a lot of reports for one day.");
    let photoId = null;
    if (b.photo_id) {
      const [p] = await q("select id from shop_photos where id = $1 and shop_id = $2", [str(b.photo_id, 80), shop.id]);
      if (!p) throw new HttpError(400, "That photo isn't in this shop anymore. Upload it again.");
      photoId = p.id;
    }
    const title = f.title || `${RIVERS[f.river].name} fishing report`;
    if (b.id) {
      const [r] = await q("select id from shop_reports where id = $1 and shop_id = $2 and status = 'live'", [str(b.id, 80), shop.id]);
      if (!r) throw new HttpError(404, "That report isn't here anymore.");
      await q(
        `update shop_reports set river = $2, reported_on = $3, title = $4, summary = $5, flow = $6, clarity = $7, temp_f = $8,
                hatches = $9::jsonb, flies = $10::jsonb, tactics = $11, transcript = $12, updated = $13,
                photo_id = coalesce($14, photo_id) where id = $1`,
        [r.id, f.river, f.reported_on, title, f.summary, f.flow, f.clarity, f.temp_f, JSON.stringify(f.hatches), JSON.stringify(f.flies), f.tactics, f.transcript, now, photoId],
      );
      return { id: r.id };
    }
    const id = newId("rep", 10);
    await q(
      `insert into shop_reports (id, shop_id, photo_id, river, reported_on, title, summary, flow, clarity, temp_f, hatches, flies, tactics, transcript, status, at, updated)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, 'live', $15, $15)`,
      [id, shop.id, photoId, f.river, f.reported_on, title, f.summary, f.flow, f.clarity, f.temp_f, JSON.stringify(f.hatches), JSON.stringify(f.flies), f.tactics, f.transcript, now],
    );
    return { id };
  }

  if (op === "report_remove") {
    const [r] = await q("select id, shop_id from shop_reports where id = $1", [str(b.id, 80)]);
    if (!r) throw new HttpError(404, "That report isn't here anymore.");
    await memberShop(user, r.shop_id);
    await q("update shop_reports set status = 'removed', updated = $2 where id = $1", [r.id, now]);
    return { ok: true };
  }

  // ---------- guides: they add themselves ----------
  if (op === "guide_save") {
    if (!user.g) throw new HttpError(403, "Sign in with Google to list yourself as a guide. It keeps a profile tied to a real account you can get back into.");
    const f = guideFields(b);
    if (f.name.length < 2) throw new HttpError(400, "Add your name or your outfit's name.");
    if (f.about.length < 20) throw new HttpError(400, "Add a few sentences about the trips you run.");
    if (!f.rivers.length && !f.waters) throw new HttpError(400, "Say where you guide: pick a river, or list your waters.");
    const [mine] = await q("select * from guides where user_id = $1", [user.id]);
    if (!mine) {
      await limit(`guidenew:${user.id}`, 3, DAY, "That's a lot of new profiles for one day.");
      await limit(`guidenewip:${ip}`, 10, DAY, "Too many new profiles from here today. Try again tomorrow.");
    }
    await limit(`guidesave:${user.id}`, 40, DAY, "That's a lot of changes for one day.");
    const shopsJson = JSON.stringify(f.shops);
    if (mine) {
      await q(
        `update guides set name = $2, city = $3, state = $4, lat = $5, lon = $6, website = $7, instagrams = $8::jsonb, about = $9,
                rivers = $10::jsonb, waters = $11, trips = $12::jsonb, years = $13, credentials = $14, shops = $15::jsonb, updated = $16 where id = $1`,
        [mine.id, f.name, f.city, f.state, f.lat, f.lon, f.website, JSON.stringify(f.instagrams), f.about, JSON.stringify(f.rivers), f.waters, JSON.stringify(f.trips), f.years, f.credentials, shopsJson, now],
      );
    } else {
      let slug = guideSlug(f.name);
      const [taken] = await q("select 1 as x from guides where slug = $1", [slug]);
      if (taken) slug = `${slug.slice(0, 35)}-${newId("", 2)}`;
      await q(
        `insert into guides (id, slug, user_id, name, city, state, lat, lon, website, instagrams, about, rivers, waters, trips, years, credentials, shops, status, at, updated)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14::jsonb, $15, $16, $17::jsonb, 'active', $18, $18)`,
        [newId("gd"), slug, user.id, f.name, f.city, f.state, f.lat, f.lon, f.website, JSON.stringify(f.instagrams), f.about, JSON.stringify(f.rivers), f.waters, JSON.stringify(f.trips), f.years, f.credentials, shopsJson, now],
      );
    }
    const [g] = await q("select * from guides where user_id = $1", [user.id]);
    return { guide: (await guidesOut([g]))[0] };
  }

  // A guide can pause their own profile and bring it back; the admin can hide any profile, and only the admin lifts that.
  if (op === "guide_status") {
    const admin = isAdmin(user);
    const [g] = admin && b.guide
      ? await q("select * from guides where id = $1 or slug = $1", [str(b.guide, 80)])
      : await q("select * from guides where user_id = $1", [user.id]);
    if (!g) throw new HttpError(404, "That guide isn't here.");
    const want = ["active", "paused", "hidden"].includes(b.status) ? b.status : "";
    if (!want) throw new HttpError(400, "That isn't a status.");
    if (!admin && (want === "hidden" || g.status === "hidden")) throw new HttpError(403, "Only the site admin can do that.");
    await q("update guides set status = $2, updated = $3 where id = $1", [g.id, want, now]);
    return { ok: true, status: want };
  }

  if (op === "guide_delete") {
    const [g] = await q("select id from guides where user_id = $1", [user.id]);
    if (!g) throw new HttpError(404, "You don't have a guide profile.");
    await q("delete from guides where id = $1", [g.id]);
    return { ok: true };
  }

  if (op === "thread_start") {
    let s = null, g = null;
    if (b.guide) {
      [g] = await q("select * from guides where id = $1 or slug = $1", [str(b.guide, 80)]);
      if (!g || g.status !== "active") throw new HttpError(404, "That guide isn't taking messages.");
      if (g.user_id === user.id) throw new HttpError(400, "That's your own profile.");
    } else {
      s = await shopFor(b.shop);
      if (s.status !== "active") throw new HttpError(404, "That shop isn't taking messages.");
      if (await roleIn(user, s.id)) throw new HttpError(400, "That's your own shop.");
    }
    const body = clean(b.message, 2000);
    if (!body) throw new HttpError(400, "Write a message first.");
    await limit(`shopmsg:${user.id}`, 10, 60 * 60e3, "You've started a lot of conversations in the last hour. Try again a little later.");
    await limit(`shopmsgip:${ip}`, 40, 60 * 60e3, "Too many messages from here. Try again a little later.");
    let report = null;
    if (s && b.report) {
      [report] = await q("select id, title from shop_reports where id = $1 and shop_id = $2 and status = 'live'", [str(b.report, 80), s.id]);
    }
    const [open] = g
      ? await q("select id from shop_threads where guide_id = $1 and from_user = $2 and status <> 'closed' order by last_at desc limit 1", [g.id, user.id])
      : await q("select id from shop_threads where shop_id = $1 and from_user = $2 and status <> 'closed' order by last_at desc limit 1", [s.id, user.id]);
    let id = open && open.id;
    if (!id) {
      id = newId("thr", 10);
      await q(
        `insert into shop_threads (id, shop_id, guide_id, report_id, from_user, from_name, subject, status, at, last_at, buyer_read_at, shop_read_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'new', $8, $8, $8, 0)`,
        [id, s ? s.id : null, g ? g.id : null, report ? report.id : null, user.id, oneLine(user.name, 40), report ? report.title : `Question for ${(g || s).name}`, now],
      );
    }
    await q("insert into shop_messages (thread_id, sender, from_shop, body, at) values ($1, $2, false, $3, $4)", [id, user.id, body, now]);
    await q("update shop_threads set last_at = $2, buyer_read_at = $2 where id = $1", [id, now]);
    return { id };
  }

  if (["thread_send", "thread_read", "thread_status"].includes(op)) {
    const [t] = await q("select * from shop_threads where id = $1", [str(b.id, 80)]);
    if (!t) throw new HttpError(404, "That conversation isn't here.");
    const buyer = t.from_user === user.id;
    let shopSide = false;
    if (!buyer) {
      if (t.guide_id) { const [own] = await q("select 1 as x from guides where id = $1 and user_id = $2", [t.guide_id, user.id]); shopSide = !!own; }
      else shopSide = !!(await roleIn(user, t.shop_id));
    }
    if (!buyer && !shopSide) throw new HttpError(404, "That conversation isn't here.");
    if (op === "thread_read") {
      await q(`update shop_threads set ${buyer ? "buyer_read_at" : "shop_read_at"} = $2 where id = $1`, [t.id, now]);
      return { ok: true };
    }
    if (op === "thread_status") {
      if (!shopSide) throw new HttpError(403, "Only the shop can close a conversation.");
      const status = b.status === "closed" ? "closed" : "replied";
      await q("update shop_threads set status = $2 where id = $1", [t.id, status]);
      return { ok: true };
    }
    if (t.status === "closed") throw new HttpError(400, "This conversation is closed.");
    const body = clean(b.body, 2000);
    if (!body) throw new HttpError(400, "Write a message first.");
    await limit(`shopsend:${user.id}`, 60, 60 * 60e3, "You're sending a lot of messages. Slow down a little.");
    await q("insert into shop_messages (thread_id, sender, from_shop, body, at) values ($1, $2, $3, $4, $5)", [t.id, user.id, shopSide, body, now]);
    await q(
      `update shop_threads set last_at = $2, status = $3, ${shopSide ? "shop_read_at" : "buyer_read_at"} = $2 where id = $1`,
      [t.id, now, shopSide ? "replied" : t.status],
    );
    return { ok: true };
  }

  throw new HttpError(400, "That isn't something this page can do.");
}

const handler = route(["GET", "POST"], async (req) => {
  await ensureSchema();
  const op = str(req.method === "GET" ? req.query && req.query.op : readBody(req).op, 30) || "shops";
  return req.method === "GET" ? read(req, op) : write(req, op);
});

export default async function (req, res) {
  if (req.method === "GET" && req.query && req.query.photo) {
    try { return await servePhoto(req, res); } catch (e) { console.error(e); res.statusCode = 500; return res.end("Something went wrong."); }
  }
  return handler(req, res);
}
