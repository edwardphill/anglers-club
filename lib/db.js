// Postgres access through postgres.js. In production this is Supabase: connecting Supabase
// to the project under Vercel Storage sets POSTGRES_URL, its pooled (transaction mode)
// connection, which suits serverless functions. Any other Postgres works through
// POSTGRES_URL or DATABASE_URL. Tests swap in a local Postgres through globalThis.__nacQuery.
import { HttpError } from "./http.js";

let sqlPromise = null;

async function getSql() {
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!raw && !globalThis.__nacSqlFactory) {
    throw new HttpError(503, "The database isn't connected yet. In Vercel, add Supabase under Storage, then redeploy.");
  }
  if (!sqlPromise) {
    sqlPromise = (globalThis.__nacSqlFactory ? Promise.resolve(globalThis.__nacSqlFactory()) : import("postgres").then(({ default: postgres }) => {
      // Provider URLs can carry extra query settings (sslmode, pooler hints) that postgres.js
      // would pass to the server as startup parameters; TLS is set explicitly instead.
      const url = new URL(raw);
      const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
      for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key);
      return postgres(url.toString(), {
        ssl: local ? false : "require",
        prepare: false, // required by Supabase's transaction-mode pooler
        max: 1,
        idle_timeout: 20,
        connect_timeout: 5,
      });
    }));
    sqlPromise.catch(() => { sqlPromise = null; });
  }
  return sqlPromise;
}

// A serverless instance can sit frozen between requests while the database (or its pooler)
// closes the idle connection; the next query then waits on a dead socket until Vercel cuts the
// whole request off with a 504. Every statement gets a short limit instead. When one stalls, the
// connection is thrown away; reads are tried once more on a fresh connection, writes are not
// (the first try may have gone through).
const QUERY_MS = () => globalThis.__nacQueryMs || 4000;

function dropSql() {
  const old = sqlPromise;
  sqlPromise = null;
  if (old) old.then((sql) => sql.end({ timeout: 0 })).catch(() => {});
}

function stalled(sql, text, params) {
  let timer;
  const stall = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("database stalled"), { stalled: true })), QUERY_MS());
  });
  const run = sql.unsafe(text, params);
  run.catch(() => {}); // a late failure after the limit has passed is not news
  return Promise.race([run, stall]).finally(() => clearTimeout(timer));
}

// Closes the current connection so the next statement opens a new one (tests use this between cases).
export function resetConnection() {
  dropSql();
}

// Errors that mean the connection itself is unusable (as opposed to a bad statement).
const DEAD = new Set(["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNRESET", "EPIPE", "ETIMEDOUT"]);

// Runs one parameterized statement ($1, $2, ...) and returns its rows.
export async function q(text, params = []) {
  if (globalThis.__nacQuery) return globalThis.__nacQuery(text, params);
  const read = /^\s*select\b/i.test(text);
  for (let attempt = 0; ; attempt++) {
    const sql = await getSql();
    try {
      return await stalled(sql, text, params);
    } catch (e) {
      if (!(e && (e.stalled || DEAD.has(e.code)))) throw e;
      dropSql();
      if (read && attempt === 0) continue;
      throw new HttpError(503, "The database is slow to answer right now. Try again in a moment.");
    }
  }
}

// Timestamps are stored as epoch milliseconds in double precision columns so every
// driver hands them back as plain numbers.
export const SCHEMA = [
  `create table if not exists clubs (
    id text primary key,
    name text not null,
    city text not null,
    state text not null,
    kinds text not null default 'both',
    waters jsonb not null default '[]'::jsonb,
    tz text not null,
    lat double precision not null,
    lon double precision not null,
    region text not null,
    pw_hash text not null default '',
    owner_id text,
    at double precision not null
  )`,
  `create table if not exists members (
    id text primary key,
    club_id text not null references clubs(id) on delete cascade,
    handle text not null default '',
    role text not null default 'member',
    token_hash text not null unique,
    at double precision not null
  )`,
  `create index if not exists members_club_idx on members (club_id)`,
  `create table if not exists trips (
    id text primary key,
    club_id text not null references clubs(id) on delete cascade,
    host_id text not null,
    kind text not null,
    water text not null,
    title text not null default '',
    date text not null,
    time text not null default '',
    meet text not null default '',
    seats integer,
    cond text not null default '',
    notes text not null default '',
    canceled boolean not null default false,
    at double precision not null
  )`,
  `create index if not exists trips_club_idx on trips (club_id, date)`,
  `create table if not exists rsvps (
    trip_id text not null references trips(id) on delete cascade,
    member_id text not null references members(id) on delete cascade,
    club_id text not null,
    status text not null,
    at double precision not null,
    primary key (trip_id, member_id)
  )`,
  `create index if not exists rsvps_club_idx on rsvps (club_id)`,
  `create table if not exists comments (
    id text primary key,
    trip_id text not null references trips(id) on delete cascade,
    club_id text not null,
    member_id text not null,
    text text not null,
    at double precision not null
  )`,
  `create index if not exists comments_club_idx on comments (club_id)`,
  `create table if not exists reports (
    trip_id text not null references trips(id) on delete cascade,
    member_id text not null,
    club_id text not null,
    worked text not null default '',
    count integer,
    cond text not null default '',
    notes text not null default '',
    at double precision not null,
    primary key (trip_id, member_id)
  )`,
  `create index if not exists reports_club_idx on reports (club_id)`,
  // Supabase publishes tables in the public schema through its data API. Row-level security
  // with no policies closes that door; the site's own server connects as the table owner,
  // which isn't subject to it.
  `alter table clubs enable row level security`,
  `alter table members enable row level security`,
  `alter table trips enable row level security`,
  `alter table rsvps enable row level security`,
  `alter table comments enable row level security`,
  `alter table reports enable row level security`,
  `create table if not exists attempts (
    key text primary key,
    n integer not null,
    since double precision not null
  )`,
  `alter table attempts enable row level security`,
  // Each member's trout life list (the Trout Map tab). Private to the member.
  `create table if not exists catches (
    id text primary key,
    member_id text not null references members(id) on delete cascade,
    club_id text not null,
    species_id text not null,
    caught_on text not null default '',
    water text not null default '',
    note text not null default '',
    at double precision not null
  )`,
  `create index if not exists catches_member_idx on catches (member_id)`,
  `alter table catches enable row level security`,
  // People: one user per device name (a guest) or per Google account, a session per device, and
  // memberships tied to the user. google_sub stays empty for guests. Older memberships have a
  // per-device token instead; they're linked to a user the first time that device opens the site.
  `create table if not exists users (
    id text primary key,
    google_sub text unique,
    email text not null default '',
    name text not null default '',
    picture text not null default '',
    at double precision not null,
    seen double precision not null default 0
  )`,
  `create table if not exists sessions (
    token_hash text primary key,
    user_id text not null references users(id) on delete cascade,
    at double precision not null,
    seen double precision not null default 0
  )`,
  `create index if not exists sessions_user_idx on sessions (user_id)`,
  `alter table members add column if not exists user_id text references users(id) on delete cascade`,
  `alter table members alter column token_hash drop not null`,
  `create unique index if not exists members_club_user_idx on members (club_id, user_id) where user_id is not null`,
  `alter table users enable row level security`,
  // Guests have no Google account. Databases made before guests existed need the column loosened.
  `alter table users alter column google_sub drop not null`,
  // The river waitlist (the Fly Picker's "Request a river"): one row per person per river, so the
  // number of rows with the same key is how many people asked for it.
  `create table if not exists river_requests (
    id text primary key,
    key text not null,
    name text not null,
    state text not null,
    stretch text not null default '',
    water text not null default '',
    gauge text not null default '',
    notes text not null default '',
    user_id text not null references users(id) on delete cascade,
    at double precision not null
  )`,
  `create unique index if not exists river_requests_key_user_idx on river_requests (key, user_id)`,
  `alter table river_requests enable row level security`,
  // Fly shops: a shop posts the past week's river report as a photo, Fly AI transcribes it into text, anglers
  // can message the shop. Modeled on Nina's vendors, vendor items and inquiries.
  `create table if not exists fly_shops (
    id text primary key,
    slug text not null unique,
    name text not null,
    city text not null default '',
    state text not null default '',
    lat double precision,
    lon double precision,
    website text not null default '',
    instagram text not null default '',
    about text not null default '',
    rivers jsonb not null default '[]'::jsonb,
    status text not null default 'active',
    managed boolean not null default false,
    created_by text references users(id) on delete set null,
    at double precision not null
  )`,
  `create table if not exists shop_members (
    shop_id text not null references fly_shops(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    role text not null default 'staff',
    at double precision not null,
    primary key (shop_id, user_id)
  )`,
  `create index if not exists shop_members_user_idx on shop_members (user_id)`,
  `create table if not exists shop_invites (
    id text primary key,
    shop_id text not null references fly_shops(id) on delete cascade,
    email text not null,
    role text not null default 'owner',
    at double precision not null,
    accepted_at double precision
  )`,
  `create index if not exists shop_invites_email_idx on shop_invites (email) where accepted_at is null`,
  // Photos are re-encoded in the browser, stripped of metadata on the server and kept here as base64
  // text (small JPEGs, so no storage service or extra keys). Served at /photos/<id>.jpg (a rewrite to /api/shops?photo=<id>).
  `create table if not exists shop_photos (
    id text primary key,
    shop_id text not null references fly_shops(id) on delete cascade,
    b64 text not null,
    width int not null default 0,
    height int not null default 0,
    at double precision not null
  )`,
  // What a photo shows, in words: its alt text on the public pages (an image alone can't be read).
  `alter table shop_photos add column if not exists alt text not null default ''`,
  `create table if not exists shop_reports (
    id text primary key,
    shop_id text not null references fly_shops(id) on delete cascade,
    photo_id text references shop_photos(id) on delete set null,
    river text not null,
    reported_on text not null,
    title text not null default '',
    summary text not null default '',
    flow text not null default '',
    clarity text not null default '',
    temp_f int,
    hatches jsonb not null default '[]'::jsonb,
    flies jsonb not null default '[]'::jsonb,
    tactics text not null default '',
    transcript text not null default '',
    status text not null default 'live',
    at double precision not null,
    updated double precision not null
  )`,
  `create index if not exists shop_reports_river_idx on shop_reports (river, reported_on desc) where status = 'live'`,
  `create index if not exists shop_reports_shop_idx on shop_reports (shop_id, reported_on desc)`,
  `create table if not exists shop_drafts (
    id bigserial primary key,
    shop_id text not null references fly_shops(id) on delete cascade,
    user_id text references users(id) on delete set null,
    at double precision not null,
    model text not null default '',
    input_tokens int not null default 0,
    output_tokens int not null default 0,
    ok boolean not null default false
  )`,
  `create table if not exists shop_threads (
    id text primary key,
    shop_id text not null references fly_shops(id) on delete cascade,
    report_id text references shop_reports(id) on delete set null,
    from_user text not null references users(id) on delete cascade,
    from_name text not null default '',
    subject text not null default '',
    status text not null default 'new',
    at double precision not null,
    last_at double precision not null,
    buyer_read_at double precision not null,
    shop_read_at double precision not null default 0
  )`,
  `create index if not exists shop_threads_shop_idx on shop_threads (shop_id, last_at desc)`,
  `create index if not exists shop_threads_user_idx on shop_threads (from_user, last_at desc)`,
  `create table if not exists shop_messages (
    id bigserial primary key,
    thread_id text not null references shop_threads(id) on delete cascade,
    sender text not null references users(id) on delete cascade,
    from_shop boolean not null default false,
    body text not null,
    at double precision not null
  )`,
  `create index if not exists shop_messages_thread_idx on shop_messages (thread_id, id)`,
  // Guides add themselves (a signed-in Google account, one profile each): where they guide, Instagram, the shops
  // they work with, and messages from anglers. Their messages share shop_threads: a thread belongs to a shop
  // (shop_id) or to a guide (guide_id), never both.
  `create table if not exists guides (
    id text primary key,
    slug text not null unique,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    city text not null default '',
    state text not null default '',
    lat double precision,
    lon double precision,
    website text not null default '',
    instagrams jsonb not null default '[]'::jsonb,
    about text not null default '',
    rivers jsonb not null default '[]'::jsonb,
    waters text not null default '',
    trips jsonb not null default '[]'::jsonb,
    years int,
    credentials text not null default '',
    shops jsonb not null default '[]'::jsonb,
    status text not null default 'active',
    at double precision not null,
    updated double precision not null
  )`,
  `create unique index if not exists guides_user_idx on guides (user_id)`,
  `alter table shop_threads alter column shop_id drop not null`,
  `alter table shop_threads add column if not exists guide_id text references guides(id) on delete cascade`,
  `create index if not exists shop_threads_guide_idx on shop_threads (guide_id, last_at desc)`,
  `alter table guides enable row level security`,
  `alter table fly_shops enable row level security`,
  `alter table shop_members enable row level security`,
  `alter table shop_invites enable row level security`,
  `alter table shop_photos enable row level security`,
  `alter table shop_reports enable row level security`,
  `alter table shop_drafts enable row level security`,
  `alter table shop_threads enable row level security`,
  `alter table shop_messages enable row level security`,
  // The forum: threads and replies by named users (a saved name or Google), reports, and nothing else. Hidden rows are
  // never served; hidden_by says who hid them ('mod', 'author' or 'reports').
  `create table if not exists forum_threads (
    id text primary key,
    category text not null,
    title text not null,
    body text not null,
    author_id text not null references users(id) on delete cascade,
    author_name text not null,
    at double precision not null,
    last_at double precision not null,
    replies int not null default 0,
    pinned boolean not null default false,
    locked boolean not null default false,
    hidden boolean not null default false,
    hidden_by text not null default ''
  )`,
  `create index if not exists forum_threads_cat_idx on forum_threads (category, pinned desc, last_at desc)`,
  `create index if not exists forum_threads_last_idx on forum_threads (last_at desc)`,
  `create table if not exists forum_posts (
    id text primary key,
    thread_id text not null references forum_threads(id) on delete cascade,
    body text not null,
    author_id text not null references users(id) on delete cascade,
    author_name text not null,
    at double precision not null,
    hidden boolean not null default false,
    hidden_by text not null default ''
  )`,
  `create index if not exists forum_posts_thread_idx on forum_posts (thread_id, at)`,
  `create table if not exists forum_reports (
    kind text not null,
    target_id text not null,
    reporter_id text not null references users(id) on delete cascade,
    reason text not null default '',
    at double precision not null,
    primary key (kind, target_id, reporter_id)
  )`,
  `alter table forum_threads enable row level security`,
  `alter table forum_posts enable row level security`,
  `alter table forum_reports enable row level security`,
  // Georgia's weekly trout stocking report, read once a day: one row per stocking as the state printed it, and one row
  // saying when the report was last read. Public data; nothing in it belongs to a person.
  `create table if not exists ga_stockings (
    day text not null,
    county text not null,
    water text not null,
    week_from text not null default '',
    week_to text not null default '',
    seen double precision not null,
    primary key (day, county, water)
  )`,
  `create table if not exists ga_stocking_runs (
    id int primary key,
    at double precision not null default 0,
    ok boolean not null default false,
    ok_at double precision,
    week text not null default '',
    rows int not null default 0,
    skipped int not null default 0,
    error text not null default ''
  )`,
  `alter table ga_stockings enable row level security`,
  `alter table ga_stocking_runs enable row level security`,
  // Last: once sessions has row-level security on, every statement above has run.
  // Anything added later goes above this line, and the check in ensureSchema covers it.
  `alter table sessions enable row level security`,
];

let ready = null;

// Creates the tables on first use, once per server instance.
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      // Done when sessions has row-level security (the last statement), guests are allowed and the
      // newest table exists with its security on. Add each new table's check here.
      const r = await q(
        `select coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.sessions')), false)
            and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.river_requests')), false)
            and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.shop_messages')), false)
            and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.guides')), false)
            and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.forum_reports')), false)
            and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.ga_stocking_runs')), false)
            and coalesce((select is_nullable = 'YES' from information_schema.columns
                          where table_schema = 'public' and table_name = 'users' and column_name = 'google_sub'), false) as ok`,
      );
      if (r[0] && r[0].ok) return;
      for (const stmt of SCHEMA) await q(stmt);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}
