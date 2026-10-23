# Anglers Club

Fishing and hunting trip calendars for clubs in any city. Anyone can start a club for their town and set a club password. Friends join with that password and then:

- post a trip with the water, time, meetup spot and open seats
- RSVP (I'm in, Maybe, Can't go), with seat limits enforced
- plan in one thread per trip instead of side texts
- leave trip reports that feed a "flies that worked" list
- add trips to Google Calendar or copy a ready-made group text
- send an invite (link plus password) from the Invite button at the top of the club

Each club also has two tools built in:

- **Fly Picker**: what's hatching on a given water and date.
- **Trout Map**: a clickable world chart of all 115 entries on the Trout Species Map checklist (README v2, Appendix A). Each member logs catches (date, optional water name, private note) and the range fills in. Progress shows overall (81 countable species), by tier and by regional board, and the chart saves as a PNG. A member's life list is private to them, and no coordinates are stored.

## How it's built

- `public/index.html`: the whole site, one page. It is generated; edit `src/` and run `npm run build`.
- `src/club.html`: the page source. `src/trout-species.js` is the Trout Map checklist with approximate range circles; `src/trout-land.js` is the chart's coastlines and borders, already projected (Natural Earth 1:110m, public domain), and loads only when the tab opens. `scripts/make_trout_land.mjs` regenerates it. `src/flypicker/` holds the embedded Fly Picker, built from the main branch of [edwardphill/fly-picker](https://github.com/edwardphill/fly-picker). To pull in Fly Picker changes, run `python3 scripts/sync_flypicker.py ../fly-picker`, then `npm run build`.
- `api/`: Vercel serverless functions.
  - `GET /api/clubs` lists clubs. `POST /api/clubs` starts one.
  - `POST /api/join` checks a club password.
  - `GET /api/state` returns a club's data. `POST /api/action` makes every change.
  - `GET /api/health` checks the database.
- `lib/`: database access, passwords and input checks.
- Database: Postgres on Supabase, through its pooled connection (any Postgres works). Tables are created automatically on the first request (new ones, like `catches`, are added to an existing database the same way), with row-level security on so Supabase's public data API can't reach them; only the site's server can.

Security: club passwords are hashed with scrypt on the server. Joining gives each device a random sign-in token, and only a hash of it is stored. Password guesses are rate limited. Only a trip's host or the club organizer can edit or delete a trip, and only the organizer can change club details, change the password or remove members.

## Deploy on Vercel

1. Import this repo in Vercel. `vercel.json` sets the build (`npm run build`) and the output directory (`public`).
2. In the project, open Storage, create a Supabase database, and connect it to the project. This sets `POSTGRES_URL`. With a Supabase project you already have, add its transaction pooler connection string as `POSTGRES_URL` under Environment Variables instead.
3. Redeploy, then open `/api/health`. It should return `{"ok":true,"clubs":0}`.

## Run the tests

The tests run every API route against a local Postgres:

```bash
PGTEST="-h localhost -p 5432 -U postgres -d anglers_test" npm test
```

`tests/dev-server.mjs` serves the site and the API locally against the same database. Use it for clicking through the page.
