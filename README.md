# Fly AI

AI tools for fly fishing: a trip planner, an AI fly fishing picker (the Fly Picker, a rules engine over hatch charts and dated reports, not a chatbot), and a way for fly shops to publish weekly river reports that search engines and AI tools can read. It also runs fishing and hunting trip calendars for clubs in any city. There is no sign-in and no club password: anyone can look around, and the first time someone posts a trip, RSVPs, comments or asks the trip planner they type a name, which is saved on that device. Anyone can start a club for their town and text the link to the crew, who can then:

- post a trip with the water, time, meetup spot and open seats
- RSVP (I'm in, Maybe, Can't go), with seat limits enforced
- plan in one thread per trip instead of side texts
- leave trip reports that feed a "flies that worked" list
- add trips to Google Calendar or copy a ready-made group text
- send an invite link from the Invite button at the top of the club

Each club also has these tabs:

- **Calendar**: every trip by day, with the next trip shown when a day is empty.
- **Trip planner**: a chat. Ask "I have tomorrow off, Elk or Caney?" (your question on the right, the answer on the left with its sources, Enter to send) and get a pick with what's eating, stockings, water and weather, and flies, with links to the sources. The server (`api/plan.js`, `lib/planner.js`) hands Claude the Fly Picker's hatch model and the reports behind it, the stocking schedule, and the club's recent trip reports and planned trips; Claude searches the web for generation schedules, flows, weather and fresh reports. Answers stream in. Each member gets 25 questions a day and the club 150. `/plan` opens this tab.
- **Stocking** (Tennessee clubs): TWRA's trout stocking schedule on a map of the state, filterable by window, region and water type, sorted by the next stocking or by distance from the club. Each water opens its dates and a "Post a trip here" button. The schedule is `src/stocking-tn.js`; refresh it when TWRA posts a new season. `/stocking` opens this tab.
- **Fly Picker**: what's hatching on a given water and date, and the two or three flies worth tying on, with a plain "leave the dries home" when nothing is rising. It covers the Caney Fork, Elk, Tellico, Hiwassee, South Holston and Watauga in depth (month-by-month picks, regulations, generation and access, each tied to a named source) and falls back to the hatch model for other waters. Those six are curated in `data/fp-local.json` and applied at build time by `scripts/fp-local.mjs`, so a resync from the fly-picker repo doesn't drop them.
- **Trout Map**: a clickable world chart of all 115 entries on the Trout Species Map checklist (README v2, Appendix A). Each member logs catches (date, optional water name, private note) and the range fills in. Progress shows overall (81 countable species), by tier and by regional board, and the chart saves as a PNG. A member's life list is private to them, and no coordinates are stored. Every species shows a generic trout until its illustration is added to `trout-art/` (see the README there). `/trout` opens this tab.

## How it's built

- `public/index.html`: the whole site, one page. It is generated; edit `src/` and run `npm run build`.
- `src/club.html`: the page source. `src/trout-species.js` is the Trout Map checklist with approximate range circles; `src/trout-land.js` is the chart's coastlines and borders, already projected (Natural Earth 1:110m, public domain), and loads only when the tab opens. `scripts/make_trout_land.mjs` regenerates it. `src/flypicker/` holds the embedded Fly Picker, built from the main branch of [edwardphill/fly-picker](https://github.com/edwardphill/fly-picker). To pull in Fly Picker changes, run `python3 scripts/sync_flypicker.py ../fly-picker`, then `npm run build`.
- `api/`: Vercel serverless functions.
  - `GET /api/auth` returns who this device is (and the Google client ID when Google is on). `POST /api/auth` gives the device a saved name (`guest`), renames it, signs in with Google (optional) or signs out.
  - `GET /api/clubs` lists clubs (open to everyone) and the ones this device has joined. `POST /api/clubs` starts one; it needs a name.
  - `POST /api/join` joins a club under the saved name. Posting, RSVPing or commenting does this automatically.
  - `GET /api/state` returns a club's calendar, threads and reports (open to everyone). `POST /api/action` makes every change and needs a name.
  - `GET /api/health` checks the database.
- `lib/`: database access, sessions and names, optional Google token checks, and input checks.
- Database: Postgres on Supabase, through its pooled connection (any Postgres works). Tables are created automatically on the first request (new ones, like `catches`, are added to an existing database the same way), with row-level security on so Supabase's public data API can't reach them; only the site's server can.

Security and privacy: there are no passwords anywhere. A name becomes a session, a random token kept on the device; only its hash is stored, and the club knows you by that device. Names are self-declared, so anyone can type any name; a name is not proof of who someone is. Anyone with a club's link can read its calendar, threads, reports and member names (emails and Google profile details are never sent to the page), so keep anything private out of trips. A life list stays private to its owner. Only a trip's host or the club organizer can edit or delete a trip, and only the organizer can change club details or remove members (a removed device can't post again under that name, though a person can still start over with a new one). New names, new clubs, planner questions and posts are rate limited, and the trip planner has a daily cap overall. Clearing a browser's site data means a new identity, unless the person added Google, which carries the name and clubs to other devices. Members from the password days are attached to a name the first time that device opens the site.

## River report tool

A fly shop's whole job is a photo of its weekly whiteboard (`report_photo` in `api/shops.js`). Claude (`draftFromPhoto` in `lib/shops.js`) transcribes it into one written report for each river on the board (up to six) and describes the photo in a line, because an image alone can't be read by search engines or AI tools. The shop checks the text in the app and publishes; the description is stored on the photo (`shop_photos.alt`) and becomes its alt text and `ImageObject` description, and each report's transcript is shown as visible text. Nothing goes live until the shop publishes, and words written on the board are data, never instructions.

## Forum

`/forum` is open to read, with seven categories (`lib/forumkeys.js`), a thread page at `/forum/t/<title-words>-<id>` and a category page at `/forum/c/<key>` (25 threads a page; page 2 and later are `noindex`). Pages are server-rendered by `api/page.js` from `lib/forum.js`, so crawlers and AI tools see the text, with `DiscussionForumPosting` data, and the threads are in `sitemap.xml` and `llms.txt`. Posting is `api/forum.js`, driven by the small script `public/forum.js` (the pages read fine without it). A name is saved on the device the same way as in the app, so there is nothing new to sign in to.

- Rules: a title of 6 to 120 characters with no link, a first post of 10 to 6000, a reply of 2 to 4000, and at most three links in a post. Text is plain: it is escaped on the way out and links get `rel="nofollow ugc noopener"`.
- Spam: 5 new threads a day and one a minute for each name, a reply every 10 seconds and 40 an hour, 10 threads and 80 replies a day for each address (new names are free, so the address is limited too), the same post twice is refused, and a hidden form field that only bots fill gets a quiet success and nothing is posted.
- Reports: each signed-in name can report a post once; three different reporters hide it everywhere (pages, sitemap, `llms.txt`). A person can remove their own post (it is hidden, not erased).
- Admin: a Google sign-in whose email is in `ADMIN_EMAILS` (the same list as for shops) gets Pin, Lock, Hide and Delete on every post, and a "Reported and hidden" panel on the forum home page to restore or delete. Names are self-declared, so a guest who types "Admin" is not one.
- Tables `forum_threads`, `forum_posts` and `forum_reports` have row-level security on like the rest. Forum pages are cached for 10 seconds so a new post shows quickly.

## Look

Off-white ground, thin lines, Inter. Dark green (`--deep`, `--green`) is the accent for buttons, links and kickers; mint is a small highlight. The home page lists the tools in three sections, Fishing, Hunting, and Forums and clubs (the forum and the club calendar), and each tool has its own color (`TOOLS` in `src/club.html`) that fills the card when it is selected.

## Discoverability (SEO and GEO)

- `lib/brand.js` holds the product name, home title and description, and the product list. Change words there, not in five places.
- Crawlable pages, served as HTML by `api/page.js`: `/fly-picker`, `/trip-planner`, `/river-report-tool`, `/for-shops` (`lib/landing.js`), plus `/rivers`, `/shops`, `/guides`, `/forum`, `/dove-fields` and `/grouse`. Each has a canonical link, Open Graph and Twitter cards, and schema.org data; the product pages carry a FAQ that is also in the JSON-LD. The numbers on the picker page come from `data/flypicker.json`, so they can't drift.
- The home page (`public/index.html`) gets its metadata, JSON-LD and a crawlable copy of the product list at build time (`scripts/build.mjs`); the app removes the copy once it has drawn. Crawlers that don't run JavaScript see only that copy.
- The header links go straight to the tools (`/picker`, `/plan`); the explainer pages are in the footer, the sitemap and `llms.txt`, and each opens with a launch card that goes to its tool. The River report tool's card goes to `/my-shop`, which opens the shop panel (a name first, then Google for a shop owner).
- `/sitemap.xml`, `/robots.txt` (names the search and AI crawlers; remove a name to opt it out) and `/llms.txt` are generated. Bump `LANDING_UPDATED` in `lib/brand.js` when a product page changes.
- Set `SITE_URL` in Vercel to the real address (a custom domain, once there is one). It sets every canonical link, the sitemap and the JSON-LD. Without it the build falls back to Vercel's production address, then to `https://angler-club.vercel.app`.
- `public/og.png` (share image) and `public/apple-touch-icon.png` come from `python3 scripts/make_brand_images.py`.
- After deploying, submit `/sitemap.xml` in Google Search Console and Bing Webmaster Tools.

## Deploy on Vercel

1. Import this repo in Vercel. `vercel.json` sets the build (`npm run build`) and the output directory (`public`).
2. In the project, open Storage, create a Supabase database, and connect it to the project. This sets `POSTGRES_URL`. With a Supabase project you already have, add its transaction pooler connection string as `POSTGRES_URL` under Environment Variables instead.
3. Optional Google sign-in, so a name can follow someone across devices. Skip this and the site works with saved names alone. In Google Cloud Console, open APIs & Services, set up the OAuth consent screen (External), then Credentials, Create credentials, OAuth client ID, type Web application. Under Authorized JavaScript origins add the site's URL (for example `https://angler-club.vercel.app`; add `http://localhost:3999` to try it locally). Copy the Client ID into `GOOGLE_CLIENT_ID` under Environment Variables. No client secret is needed. While the consent screen is in Testing, only listed test users can sign in; publish it to open it to anyone. Without it, the Google button simply doesn't appear.
4. For the trip planner, add `ANTHROPIC_API_KEY` (from the Claude Console) under Environment Variables. `PLANNER_MODEL` optionally overrides the model (default `claude-sonnet-5-5`).
5. Redeploy, then open `/api/health`. It should return `{"ok":true,"clubs":0}`.

Supabase pauses free projects after a week without traffic, and the site then fails with "tenant/user ... not found". `vercel.json` runs a daily cron against `/api/health` to keep it awake. If it does pause, restore the project in the Supabase dashboard.

## Run the tests

The tests run every API route against a local Postgres:

```bash
PGTEST="-h localhost -p 5432 -U postgres -d anglers_test" npm test
```

`tests/dev-server.mjs` serves the site and the API locally (with `TEST_GOOGLE=1` it also stands in for Google: `tests/google-test.mjs` makes the signing key and `/test/google-token` hands out test ID tokens) against the same database. Use it for clicking through the page. To try the trip planner without an API key, run `tests/mock-anthropic.mjs` and start the dev server with `ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4999`.

`data/flypicker.json` and `lib/fp-engine.cjs` are generated by `npm run build` from the embedded Fly Picker; `data/stocking-tn.json` is the stocking schedule both the Stocking tab and the trip planner read.
