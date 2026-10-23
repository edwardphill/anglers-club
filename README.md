# Anglers Club

Fishing and hunting trip calendars for clubs in any city. Anyone can start a club for their town and set a club password. Friends join with that password and then:

- post a trip with the water, time, meetup spot and open seats
- RSVP (I'm in, Maybe, Can't go), with seat limits enforced
- plan in one thread per trip instead of side texts
- leave trip reports that feed a "flies that worked" list
- add trips to Google Calendar or copy a ready-made group text

Each club also has a built-in Fly Picker tab and a link to the Trout Species Map.

## How it's built

- `public/index.html`: the whole site, one page. It is generated; edit `src/` and run `npm run build`.
- `src/club.html`: the page source. `src/flypicker/` holds the embedded Fly Picker, built from the main branch of [edwardphill/fly-picker](https://github.com/edwardphill/fly-picker). To pull in Fly Picker changes, run `python3 scripts/sync_flypicker.py ../fly-picker`, then `npm run build`.
- `api/`: Vercel serverless functions.
  - `GET /api/clubs` lists clubs. `POST /api/clubs` starts one.
  - `POST /api/join` checks a club password.
  - `GET /api/state` returns a club's data. `POST /api/action` makes every change.
  - `GET /api/health` checks the database.
- `lib/`: database access, passwords and input checks.
- Database: Postgres on Supabase, through its pooled connection (any Postgres works). Tables are created automatically on the first request, with row-level security on so Supabase's public data API can't reach them; only the site's server can.

Security: club passwords are hashed with scrypt on the server. Joining gives each device a random sign-in token, and only a hash of it is stored. Password guesses are rate limited. Only a trip's host or the club organizer can edit or delete a trip, and only the organizer can change club details, change the password or remove members.

## Deploy on Vercel

1. Import this repo in Vercel. Framework preset: Other. There's no build command; the output directory is `public`.
2. In the project, open Storage, create a Supabase database, and connect it to the project. This sets `POSTGRES_URL`. With a Supabase project you already have, add its transaction pooler connection string as `POSTGRES_URL` under Environment Variables instead.
3. Redeploy, then open `/api/health`. It should return `{"ok":true,"clubs":0}`.

## Run the tests

The tests run every API route against a local Postgres:

```bash
PGTEST="-h localhost -p 5432 -U postgres -d anglers_test" npm test
```

`tests/dev-server.mjs` serves the site and the API locally against the same database. Use it for clicking through the page.
