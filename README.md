# HelixOS — the client app

A daily operating system for coaching clients, redesigned from the Evolve Omega **HelixOS** Airtable base.
Clients log in every day, lock in their top 3, ship content, work their DM conversations, move through the
Success Pathway, and close the day with their numbers. Points, streaks, and tiers make it sticky. Coaches
see who's on track, verify pathway work, and nudge who's gone quiet.

## What's inside

| Area | What the client does | Where it came from in Airtable |
|---|---|---|
| **Today** | Morning lock-in (energy + top 3), next best action, evening close (numbers, start/stop/keep, win), streak | ⭐️ DailyOS, ⭐️ WeeklyOS, 📌 TasksOS |
| **Tasks** | Top 3, overdue, due today, upcoming, repeating habits, points per task | 📌 TasksOS |
| **Content** | Idea → Creating → Ready → Scheduled → Posted board, calendar, posted performance | ✍️ ContentOS (statuses, types, platforms) |
| **DMs** | Contact pipeline (reached out → replied → conversation → call booked → client), thread log, follow-up dates, template picker with token fill | 📣 DM Conversations, 💌 DM Library, 🆕 LeadsOS |
| **Pathway** | Simple by design: one stage at a time, at most 3 must-do steps open, extras folded away, "waiting on coach" shown separately; whole map one click away. Plus the 30-day curriculum, courses and the certification track | 🛣️ Success Pathway Stages, 🏆 Success Task Library, 📆 30-Day Curriculum |
| **Numbers** | Monthly targets with pace (ahead / on / behind), weekly stat tiles with deltas, 12-week bar chart, consistency calendar, top posts; optional close groups roll up (webinar funnel, content mix, revenue by source) | 📊 Daily Activity Log, #️⃣ KPIs, 🎯 Monthly Targets |
| **Rewards** | Points, 9 tiers (Artisan → Olympian), prize ladder, spendable rewards, weekly leaderboard, ledger | 🏅 Community Tiers, 🎁 Prize Ladder, 🎁 Pass Rewards, 📒 Points Ledger |
| **Coach** | Client roster with today's status, streak, tier, pathway progress; verify queue; who needs a nudge; Elite / Community Pass toggle | 🎓 Client Success Path, 🛣️ Success Pathway |
| **Webinars** | 7-step wizard: foundation → 3 belief breaks → 20-section script (5 acts) with story/analogy/objection banks → offer mapping → deck outline → 11-point readiness review → run + debrief numbers. Ships with "The Leaky Webinar" as a worked example. | 🖥️ WebinarOS: 🎭 Acts, 📑 Webinar Sections, 🪜 Wizard Stages, 📖 Story Bank, 🎨 Analogies, 🗣️ Objections, 💡 Beliefs, ✅ Readiness Reviews, 🖼️ Slide Blueprints |
| **Offers** | Offer wizard (avatar, promise, mechanism, 3–5 step path, container, price, guarantee, fit, top 5 objections) + stack builder with belief-break tags + a live optimizer score with fixes + one-pager export | 🎁 OffersOS, 🎁 Offer Components |
| **Library** | The Content Library: proven posts, fill-in-the-blank patterns with worked examples, 17 hooks and 15 CTAs from the master base, plus every member's own saved posts with the numbers they earned. Search, "Use this" opens the composer prefilled, hook and CTA pickers inside the composer, coach publishes entries to every member | ✍️ Content, 🪝 Hooks Library, 🎯 CTAs Library, 🧙 Content Wizard |
| **Composer** | HighLevel-style post builder: pick channels and groups as chips, write once, toggle "customize for each channel" to edit any version, live preview of exactly how it renders on Facebook, Instagram, Threads, LinkedIn, email, Stories, Skool and each group; stagger schedule 45 min apart in a momentum order; Save for later / Post now / Schedule; optional Claude pass that shapes every version for comments and DMs | 📮 Content Distribution |
| **Distribute** | One post → your group first, then your top 3 prospecting groups (each draft shaped to that group's mission, admin values and rules, with an alignment checklist), then 8 more channels (FB personal / page / stories / Instagram / Threads / LinkedIn / email / Skool); per-channel posted tracking; optional Claude polish | 📮 Content Distribution, 👥 Facebook Groups |
| **Groups** | My group · groups I'm a member of · top 3 to prospect in (ranked slots + bench). Group profiles (mission, audience, admin, admin values, rules, norms, what works) with a readiness score; rules are read automatically (no links, no promo, ask admin first) | 👥 Facebook Groups |
| **Doctrine** | The Ω principles: doctrine, Greek/Stoic/business/public-figure stories, and a one-click post, reel script, or 10-minute training from each | 🏛️ Principles |
| **Proof Bank** | Results, testimonials, screenshots, stats, case studies with before / shift / after, the belief each breaks, a paste-ready one-liner and a slide version. Capture wins straight from client check-ins. Approved proofs show up in the webinar script step and the offer objections | 🏆 Proof / Wins |
| **Courses** | Launch Pad mini-courses, the Accelerator 6-week build (one course per week, tied to pathway stages), Academy exercises; lesson completion earns points | 📚 Curriculum, 🧩 Exercises |
| **Certification** | 6 modules × 12 deliverables, each with its own pass threshold; submit evidence, coach scores it, pass or revise. Unlocked per client by the coach | 🎓 Certification |
| **Integrations** (coach) | Community Loyalty (API key, program) and the Omnichannel Marketing System (GoHighLevel: on/off and API base only, no agency credential), inbound webhook URL + secret, sync log, per-client connection status. Points earned in HelixOS push to each member's Evolve Omega pass; inbound rewards and bookings flow back | ⚙️ Integrations |
| **Publishing** (per client) | Each client connects their own GoHighLevel sub-account on Settings → Publishing with a location-level Private Integration token (six `socialplanner/*` scopes; the steps are on the page) plus their location ID. Saving validates the token against the sub-account and shows the real reason on failure (401 bad token, 403 missing scopes, wrong location). HelixOS lists the connected pages and profiles, auto-maps channels, sends every scheduled channel post to that client's Social Planner, and syncs status back ("Check status"). Booked calls and new clients become contacts in the same sub-account when the token also has `contacts.write`. Verified against HighLevel's OpenAPI: `/social-media-posting/{locationId}/accounts`, `…/posts`, `…/posts/{id}`, `/contacts/upsert` | 📡 Social Planner |
| **My Evolve Omega pass** | Every member's own wallet pass: add-to-wallet link, install status, test push; coach broadcasts to the whole cohort | 🎟️ Passes |
| **Clients** | The client's own clients: 90-day goal, fear, roadblock, cadence, check-ins (wins, blockers, support, next step, 1–10 scores, cash, NPS), trend sparklines, next call; convert from DM conversations | 🧔 ClientsOS, 📲 Check-Ins, ⚡ Progress, 🔢 NPS |
| **Community Pass** (Elite) | The client's own loyalty engine: pass settings, member leaderboard on the same 9 tiers, award points (pushes to their Community Loyalty webhook), daily hashtag post, 30-day curriculum to send | ⚙️ HelixOS Config, 📒 Points Ledger, 🏅 Community Tiers, 📆 30-Day Curriculum |

### Stickiness mechanics (all from the base's own rules)

- **Streaks**: weekdays only, weekends never break them. Escalating close bonus resets each Monday: 10 → 20 → 40 → 80 → 160.
- **Points** for every input: lock-in +10, close +20, DM started +5, reply +2, call booked +25, post +15 (+25 with a CTA), task +5 (+15 for a top 3), pathway tasks at their library value once the coach verifies.
- **Tiers** at the base's thresholds (100 / 500 / 1,500 / 3,000 / 7,500 / 15,000 / 30,000 / 60,000) with the member-facing copy.
- **Next best action** ranks what to do right now: unanswered replies > coach revisions > overdue > follow-ups > content due > top 3 > curriculum > pathway > close the day.
- **Reminders**: hourly cron sends a morning "lock in" and evening "close" email, and a comeback note after 3 quiet days.
- **Next best action** also surfaces clients due for a check-in and the next step of an in-progress webinar build.

### Optional: Claude drafting

Set `ANTHROPIC_API_KEY` and the "✨ With Claude" buttons light up: "Draft this section for me" in the Webinar Wizard, channel and
group-aligned drafts on the Distribute page, and post / reel / training drafts from any principle. Both run through `src/lib/ai.ts` (official SDK, `claude-opus-5`, streaming). Without a key everything still works:
webinar sections start from the worked example and repurposing uses deterministic channel rules in `src/lib/engine/repurpose.ts`.

## Run it

```bash
cp .env.example .env        # set SESSION_SECRET
npm install
npm run db:seed             # creates data/helixos.db, loads the library, and a demo workspace (refuses on production / remote databases, or once a real workspace exists)
npm run dev                 # http://localhost:3000
```

Demo logins (or use the buttons on the login page):

- Client: `client@demo.helixos.app` / `demo1234`
- Coach: `coach@demo.helixos.app` / `demo1234`
- Client invite link: `/join/ACADEMY1`

## Checks

```bash
npm run typecheck
npm run lint
npm test                    # engine unit tests (streaks, tiers, points, next best action)
npx tsx scripts/smoke.ts          # Playwright walkthrough of the daily loop; writes ./screenshots
npx tsx scripts/smoke-wizards.ts  # Webinar + offer wizards, repurposing, clients, community pass
npx tsx scripts/smoke-wave3.ts    # Doctrine, proof, groups, distribution, simple pathway, targets, courses, certification, integrations, webhooks (header + Ed25519 signature), data export
npx tsx scripts/smoke-composer.ts  # Composer, per-channel previews, one-click schedule everywhere, collapsible nav
npx tsx scripts/smoke-library.ts   # Library browse, search, use in composer, save to library, coach share
npx tsx scripts/smoke-auth.ts     # /setup token gate + 404s, forgot → reset with session invalidation, change password (needs a current `next build`)
npx tsx scripts/smoke-ghl.ts       # Client's own Private Integration token → 401 / 403 / wrong-location reasons → accounts → channel map → schedule → status sync, against scripts/mock-ghl.ts
npx tsx scripts/smoke-headers.ts     # Every page as client and coach under the Content Security Policy: no violations, no page errors
npx tsx scripts/snapshot-preview.ts out.html   # Crawls the running app into one read-only, clickable HTML file for sharing a preview
```

## Stack

Next.js 16 (App Router, server actions), React 19, Tailwind 4, Drizzle ORM on SQLite/libsql, `jose` sessions,
`bcryptjs` passwords. No client-side data library, no external services required to run.

- `src/db/schema.ts` — the data model. `drizzle/` holds generated migrations; they apply automatically on first request.
- `src/lib/engine/` — pure rules: `streak.ts`, `points.ts`, `tiers.ts`, `nba.ts`, `webinar.ts` (acts, sections, readiness, deck outline), `offer-score.ts`, `repurpose.ts`. Tested in `__tests__`.
- `src/lib/actions/` — server actions (all writes). `src/lib/queries/` — reads.
- `src/app/(app)/` — the signed-in app. `src/app/(auth)/` — login and invite join.
- `src/data/seed/*.json` — template content pulled from the HelixOS base (stages, task library, curriculum, DM library, tiers, prizes, rewards).
- `src/data/seed/webinar/*.json` — WebinarOS content: acts, the 20-section Leaky Webinar example, wizard stages, and the story / analogy / objection / belief banks.

## Keeping it in sync with Airtable

The app owns client activity (tasks, content, DMs, daily logs, points). The Airtable base stays the source of
the **template content**. To refresh it from a base:

```bash
AIRTABLE_API_KEY=pat… AIRTABLE_BASE_ID=appz2UoSLKvSr4OWQ npm run import:airtable
npm run db:seed -- --library-only
```

`scripts/import-airtable.ts` maps the base's field names; adjust there if a client base renamed fields.
Per-client HelixOS bases can be pointed at from **Settings → Workspace → Airtable base ID**.

## Going live (Vercel + Turso)

1. Create a Turso database and copy its URL and auth token. Create a Vercel project from this repo.
2. Vercel → Environment Variables: `SESSION_SECRET`, `DATABASE_URL` (libsql://…), `DATABASE_AUTH_TOKEN`, `APP_URL`, `CRON_SECRET`, and optionally `RESEND_API_KEY` + `EMAIL_FROM`, `ANTHROPIC_API_KEY`. Leave `DEMO_LOGIN` unset so the demo buttons stay hidden.
3. Deploy. The `vercel-build` script runs `npm run db:migrate` against `DATABASE_URL` and then builds; migrations never run from a request, and the build never opens the database. `vercel.json` schedules the hourly reminder cron.
4. Create your real workspace once, in the browser. Set `SETUP_TOKEN` in Vercel to a long random string, redeploy, then open `https://your-app/setup?token=THAT_STRING` and fill in the form: workspace name, your name, email, password, timezone. It creates the workspace and your coach login, loads the library (no demo data), signs you in, and shows the client and coach invite links once. The page is a 404 whenever `SETUP_TOKEN` is unset, the token is wrong, or a workspace already exists. Remove `SETUP_TOKEN` afterwards.

   For automation the same thing is available as a script: `npm run db:bootstrap -- --name … --coach-email … --coach-name … --password …` (both call the one shared function in `src/lib/setup.ts`).

5. Log in as coach → Integrations: turn GoHighLevel on (no credential needed), enter the Community Loyalty key. Send a client their invite link. Each client connects their own GoHighLevel sub-account from Settings → Publishing.

Accounts: `/forgot` emails a single-use reset link (60 minutes, token stored as a sha256 hash, Resend required in production); `/reset/[token]` sets the new password and signs every other session out; Settings has change-password with the current password required. Both routes are rate-limited per IP and per email.

Security notes: `SESSION_SECRET` is required in production (the app refuses to start sessions without it). Per-client GoHighLevel Private Integration tokens and the Community Loyalty key are encrypted at rest with AES-256-GCM under `ENCRYPTION_KEY` (falls back to `SESSION_SECRET`). There is no agency-level GoHighLevel credential anywhere: a client's token can only reach their own sub-account, so no member can publish or read as another. Integrations may only call approved HTTPS hosts (`services.leadconnectorhq.com`, `api.communityloyalty.app`, plus `INTEGRATION_URL_ALLOWLIST`). The cron endpoint refuses every call when `CRON_SECRET` is unset. Login is limited to 8 attempts per email and 30 per IP per 15 minutes; join to 20 per IP. Every export from `src/lib/actions` must be a `*Action` (ESLint enforces it) because "use server" exports are public endpoints. Inbound webhooks authenticate with the per-workspace secret in the `x-helix-secret` header (never the query string, which lands in hosting and CDN logs); only the secret's sha256 is stored and it is shown once when created. GoHighLevel marketplace-app webhooks are instead verified by their Ed25519 `x-ghl-signature` against `GHL_WEBHOOK_PUBLIC_KEY`, with the sub-account matched by `locationId`. Every response carries a Content Security Policy, HSTS, `Referrer-Policy` and `nosniff` (no frame-ancestors / X-Frame-Options, so the app can be embedded in GoHighLevel). Points, streaks, daily logs and coach roll-ups are scoped by workspace as well as user, so a user in two workspaces never sees data cross over. Library entries chosen in a form are re-checked against the member's scope before they are read.

Data export: every member can download everything they own from Settings → Your data (`/api/export?format=json`, or `format=csv&table=leads|content|client_records|…`); a coach can export a client from the Coach page for offboarding. Passwords, tokens and secret hashes are never included.

## Deploying

- **Database**: keep `DATABASE_URL=file:./data/helixos.db` on a persistent disk (Fly, Railway, a VPS), or point it at
  Turso (`libsql://…` + `DATABASE_AUTH_TOKEN`) for serverless hosts like Vercel.
- **Reminders**: schedule `GET /api/cron/reminders` hourly with `Authorization: Bearer $CRON_SECRET`.
  Add `RESEND_API_KEY` and `EMAIL_FROM` to actually send; without them, emails are logged.
- **Sessions**: set a long random `SESSION_SECRET`. Set `APP_URL` so invite links and emails point at the right host.

## Onboarding a new client

1. Coach opens **Settings** and copies the client invite link. When a client moves up to Elite, flip their **Community Pass** on from the Coach view.
2. Client signs up at `/join/CODE`. They land on Day 1 with the full pathway seeded, a primary goal, and four starter tasks.
3. Every day: lock in → work the list → close. Points and streaks do the rest.
