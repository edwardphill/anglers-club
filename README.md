# Anglers Club

Fishing and hunting trip calendars for clubs in any city. Anyone signed in with Google can start a club for their town. Friends open the club's link, sign in with Google, tap Join, and then:

- post a trip with the water, time, meetup spot and open seats
- RSVP (I'm in, Maybe, Can't go), with seat limits enforced
- plan in one thread per trip instead of side texts
- leave trip reports that feed a "flies that worked" list
- add trips to Google Calendar or copy a ready-made group text
- send an invite link from the Invite button at the top of the club

Each club also has these tabs:

- **Calendar**: every trip by day, with the next trip shown when a day is empty.
- **Trip Planner**: ask "I have tomorrow off, Elk or Caney?" and get a pick with what's eating, stockings, water and weather, and flies, with links to the sources. The server (`api/plan.js`, `lib/planner.js`) hands Claude the Fly Picker's hatch model and the reports behind it, the stocking schedule, and the club's recent trip reports and planned trips; Claude searches the web for generation schedules, flows, weather and fresh reports. Answers stream in. Each member gets 25 questions a day and the club 150. `/plan` opens this tab.
- **Stocking** (Tennessee clubs): TWRA's trout stocking schedule on a map of the state, filterable by window, region and water type, sorted by the next stocking or by distance from the club. Each water opens its dates and a "Post a trip here" button. The schedule is `src/stocking-tn.js`; refresh it when TWRA posts a new season. `/stocking` opens this tab.
- **Fly Picker**: what's hatching on a given water and date.
- **Trout Map**: a clickable world chart of all 115 entries on the Trout Species Map checklist (README v2, Appendix A). Each member logs catches (date, optional water name, private note) and the range fills in. Progress shows overall (81 countable species), by tier and by regional board, and the chart saves as a PNG. A member's life list is private to them, and no coordinates are stored. Every species shows a generic trout until its illustration is added to `trout-art/` (see the README there). `/trout` opens this tab.

## How it's built

- `public/index.html`: the whole site, one page. It is generated; edit `src/` and run `npm run build`.
- `src/club.html`: the page source. `src/trout-species.js` is the Trout Map checklist with approximate range circles; `src/trout-land.js` is the chart's coastlines and borders, already projected (Natural Earth 1:110m, public domain), and loads only when the tab opens. `scripts/make_trout_land.mjs` regenerates it. `src/flypicker/` holds the embedded Fly Picker, built from the main branch of [edwardphill/fly-picker](https://github.com/edwardphill/fly-picker). To pull in Fly Picker changes, run `python3 scripts/sync_flypicker.py ../fly-picker`, then `npm run build`.
- `api/`: Vercel serverless functions.
  - `GET /api/auth` returns the Google client ID. `POST /api/auth` exchanges a Google ID token for a session (or signs out).
  - `GET /api/clubs` lists clubs and the ones you belong to. `POST /api/clubs` starts one.
  - `POST /api/join` joins a club as the signed-in person.
  - `GET /api/state` returns a club's data. `POST /api/action` makes every change.
  - `GET /api/health` checks the database.
- `lib/`: database access, Google token checks, sessions and input checks.
- Database: Postgres on Supabase, through its pooled connection (any Postgres works). Tables are created automatically on the first request (new ones, like `catches`, are added to an existing database the same way), with row-level security on so Supabase's public data API can't reach them; only the site's server can.

Security: there are no club passwords. The site never sees a Google password: the browser gets a signed ID token from Google, and the server verifies its signature (Google's published keys), audience and expiry before opening a session. A session is a random token, and only a hash of it is stored. Sign-ins and joins are rate limited. Anyone signed in can join any club, but trips, threads and reports are visible to members only. Only a trip's host or the club organizer can edit or delete a trip, and only the organizer can change club details or remove members (a removed person can't rejoin). Members from before Google sign-in are attached to their Google account the first time they sign in on the device they used.

## Deploy on Vercel

1. Import this repo in Vercel. `vercel.json` sets the build (`npm run build`) and the output directory (`public`).
2. In the project, open Storage, create a Supabase database, and connect it to the project. This sets `POSTGRES_URL`. With a Supabase project you already have, add its transaction pooler connection string as `POSTGRES_URL` under Environment Variables instead.
3. Sign-in with Google: in Google Cloud Console, open APIs & Services, set up the OAuth consent screen (External), then Credentials, Create credentials, OAuth client ID, type Web application. Under Authorized JavaScript origins add the site's URL (for example `https://angler-club.vercel.app`; add `http://localhost:3999` to try it locally). Copy the Client ID into `GOOGLE_CLIENT_ID` under Environment Variables. No client secret is needed. While the consent screen is in Testing, only listed test users can sign in; publish it to open it to anyone.
4. For the Trip Planner, add `ANTHROPIC_API_KEY` (from the Claude Console) under Environment Variables. `PLANNER_MODEL` optionally overrides the model (default `claude-sonnet-5-5`).
5. Redeploy, then open `/api/health`. It should return `{"ok":true,"clubs":0}`.

Supabase pauses free projects after a week without traffic, and the site then fails with "tenant/user ... not found". `vercel.json` runs a daily cron against `/api/health` to keep it awake. If it does pause, restore the project in the Supabase dashboard.

## Run the tests

The tests run every API route against a local Postgres:

```bash
PGTEST="-h localhost -p 5432 -U postgres -d anglers_test" npm test
```

`tests/dev-server.mjs` serves the site and the API locally (with `TEST_GOOGLE=1` it also stands in for Google: `tests/google-test.mjs` makes the signing key and `/test/google-token` hands out test ID tokens) against the same database. Use it for clicking through the page. To try the Trip Planner without an API key, run `tests/mock-anthropic.mjs` and start the dev server with `ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4999`.

`data/flypicker.json` and `lib/fp-engine.cjs` are generated by `npm run build` from the embedded Fly Picker; `data/stocking-tn.json` is the stocking schedule both the Stocking tab and the Trip Planner read.
