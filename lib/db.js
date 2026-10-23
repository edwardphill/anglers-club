// Postgres access through postgres.js. In production this is Supabase: connecting Supabase
// to the project under Vercel Storage sets POSTGRES_URL, its pooled (transaction mode)
// connection, which suits serverless functions. Any other Postgres works through
// POSTGRES_URL or DATABASE_URL. Tests swap in a local Postgres through globalThis.__nacQuery.
import { HttpError } from "./http.js";

let sqlPromise = null;

async function getSql() {
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!raw) {
    throw new HttpError(503, "The database isn't connected yet. In Vercel, add Supabase under Storage, then redeploy.");
  }
  if (!sqlPromise) {
    sqlPromise = import("postgres").then(({ default: postgres }) => {
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
        connect_timeout: 10,
      });
    });
    sqlPromise.catch(() => { sqlPromise = null; });
  }
  return sqlPromise;
}

// Runs one parameterized statement ($1, $2, ...) and returns its rows.
export async function q(text, params = []) {
  if (globalThis.__nacQuery) return globalThis.__nacQuery(text, params);
  const sql = await getSql();
  return sql.unsafe(text, params);
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
  // Created last: its presence means every table above exists.
  `create table if not exists attempts (
    key text primary key,
    n integer not null,
    since double precision not null
  )`,
  `alter table attempts enable row level security`,
];

let ready = null;

// Creates the tables on first use, once per server instance.
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const r = await q(
        "select coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.attempts')), false) as ok",
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
