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
| **Ladders** | Comment ladders ("skins") per client: a sparse post body plus 9–11 numbered author comments posted over the first hour. 13 formats (Loss/Rebuild, Method/Resource, Milestone, Authority Anchor, Tool Stack, Mistakes, Screenshot, Objection, Numbers Teardown, Bait-and-Correct, Community, Origin Story, Roadmap). Written by Claude from the client's own facts (product, price, keywords, permitted scarcity, verified stats, origin story) and their approved Proof Bank, or scaffolded with every blank marked when Claude isn't configured. A pre-publish checklist enforces the spec: body ends in an open question and never says "comment KEYWORD", keyword + fallback line only in the final rung, no revenue guarantees, no fake scarcity, tools don't "generate", testimonials verbatim from approved proof, no placeholders, two-line headline with one gold phrase, Threads under 500 and Instagram under 2,200. Live posting hour ticks rungs off on a 3–6 minute rhythm; "Copy for Airtable" escapes rung numbers as `1\.`; one click sends body, caption and Threads chain to the composer. A channel post that is already scheduled or posted is never touched by a later send: the ladder page and the composer warn that it still carries the older text, and "Push the update to GoHighLevel" is the client's click (the planner's post is edited in place under the same id; hand-pasted ones just take the new text; dates and targets never change) | ✍️ Content (Supporting Comments, IG Carousel, IG Caption, Threads chain) |
| **Library** | The Content Library: proven posts, fill-in-the-blank patterns with worked examples, 17 hooks and 15 CTAs from the master base, plus every member's own saved posts with the numbers they earned. Search, "Use this" opens the composer prefilled, hook and CTA pickers inside the composer, coach publishes entries to every member | ✍️ Content, 🪝 Hooks Library, 🎯 CTAs Library, 🧙 Content Wizard |
| **Socrates Domain** | The sales method, as a section of its own: the seven Foundations lessons in order (lessons, not tasks: nothing ticked, scored or counted), the question library (45, tagged by CLARITY beat, NEPQ category and script type, filterable by beat and type; a client's own questions are theirs and survive every library update), the reframe library grouped by objection (Clarify → Discuss → Diffuse), and the script wizard: a name, a script type, seven beats, each a pick from the library filtered by that beat and type or the client's own words, `n of 7`, then the whole script read back in order and copied out. Objection scripts pull reframes by group. Conversations links here as CLARITY in short form. Danno's attribution line is the foot of every page in the section. Seed content in `src/data/seed/socrates/`; the question library is upserted on every migrate | Socrates OS |
| **Composer** | HighLevel-style post builder: pick channels and groups as chips, write once, toggle "customize for each channel" to edit any version, live preview of exactly how it renders on Facebook, Instagram, Threads, LinkedIn, email, Stories, Skool and each group; the call to action is its own field (a library pick replaces it) and every version places it once at render, so nothing is ever appended to the body; stagger schedule 45 min apart in a momentum order; Save for later / Post now / Schedule; optional Claude pass that shapes every version for comments and DMs | 📮 Content Distribution |
| **Distribute** | One post → your group first, then your top 3 prospecting groups (each draft shaped to that group's mission, admin values and rules, with an alignment checklist), then 8 more channels (FB personal / page / stories / Instagram / Threads / LinkedIn / email / Skool); per-channel posted tracking; optional Claude polish | 📮 Content Distribution, 👥 Facebook Groups |
| **Groups** | My group · groups I'm a member of · top 3 to prospect in (ranked slots + bench). Group profiles (mission, audience, admin, admin values, rules, norms, what works) with a readiness score; rules are read automatically (no links, no promo, ask admin first) | 👥 Facebook Groups |
| **Doctrine** | The Ω principles: doctrine, Greek/Stoic/business/public-figure stories, and a one-click post, reel script, or 10-minute training from each | 🏛️ Principles |
| **Proof Bank** | Results, testimonials, screenshots, stats, case studies with before / shift / after, the belief each breaks, a paste-ready one-liner and a slide version. Capture wins straight from client check-ins. Approved proofs show up in the webinar script step and the offer objections Harvest from Fathom (phase 1): the client pastes their own Fathom API key on Settings with tick one, picks one recording from a list of titles, and only that recording is read, on that click; the model proposes quotes and the app keeps only what the transcript confirms word for word, with the speaker, the timestamp link and a sentence either side. Every quote lands as a draft, invisible to every AI feature and picker; approval needs tick two per testimonial, recorded with the date; the short and long versions are trims of the quote (an ellipsis for the cut) and a rewrite is refused; the hook, punchline and frame (before, shift, after, belief) are the client's own words and are never attributed to the customer; the speaker's name comes from the transcript label, resolved through the calendar invitees, and may be corrected until approval; copy-out carries first name and last initial with the customer's words. The same tick gates a typed proof; rows approved before the tick existed stay approved and are counted on the Proof Bank. The webinar belief step and the composer read the same approved rows. | 🏆 Proof / Wins |
| **Courses** | Launch Pad mini-courses, the Accelerator 6-week build (one course per week, tied to pathway stages), Academy exercises; lesson completion earns points | 📚 Curriculum, 🧩 Exercises |
| **Certification** | 6 modules × 12 deliverables, each with its own pass threshold; submit evidence, coach scores it, pass or revise. Unlocked per client by the coach | 🎓 Certification |
| **Integrations** (coach) | Community Loyalty (API key, program) and the Omnichannel Marketing System (GoHighLevel: on/off and API base only, no agency credential), inbound webhook URL + secret, sync log, per-client connection status. Points earned in HelixOS push to each member's Evolve Omega pass; inbound rewards and bookings flow back | ⚙️ Integrations |
| **Publishing** (per client) | Each client connects their own GoHighLevel sub-account on Settings → Publishing with a location-level Private Integration token (six `socialplanner/*` scopes; the steps are on the page) plus their location ID. Saving validates the token against the sub-account and shows the real reason on failure (401 bad token, 403 missing scopes, wrong location). HelixOS lists the connected pages and profiles, auto-maps channels, sends every scheduled channel post to that client's Social Planner, edits a post the planner still holds as scheduled in place when it is re-scheduled or updated (same id, never a second copy), and syncs status back ("Check status"). Booked calls and new clients become contacts in the same sub-account when the token also has `contacts.write`. Verified against HighLevel's OpenAPI: `/social-media-posting/{locationId}/accounts`, `…/posts`, `…/posts/{id}` (GET and PUT), `…/posts/list` (read-only), `/contacts/upsert`. Integrations → Planner audit (coach only, read-only) lists planner posts HelixOS created and no longer tracks, from the sync log and the planner's scheduled list, and calls one a duplicate only when it is still scheduled with the same text and account as a tracked post; it never deletes | 📡 Social Planner |
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

Each member connects their **own** Anthropic or OpenAI API key on Settings → AI drafting (there is no house key and Evolve Omega pays for no client AI). Once connected, the ✨ buttons light up: "Draft this section for me" in the Webinar Wizard, channel and group polish in the composer, doctrine content, and comment ladders. Job size picks the model (long-form drafting on the strong tier, polish on the light tier), every call is logged with token counts and estimated cost (visible to the member on Settings and to the coach on /coach), and a per-member daily cap stops a runaway loop from spending a client's money. Keys are validated with one tiny real call on save, stored AES-256-GCM encrypted, and shown again only as provider + last four. Without a key every feature keeps working with rule-based drafts.
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
# The gate. Exits non-zero on the first failure; nothing is piped through tail/head, so a red check can never green-light a commit.
npm run verify              # tsc + eslint + vitest            (scripts/verify.sh; add --build for next build)
npm run dev:server start    # dev server on :3000 with every setting the walks need (scripts/dev-server.sh)
npm run smoke -- ladders ai # reseed + one or more Playwright walks (scripts/smoke.sh; "all" runs every walk)
npm run release             # verify --build, restart the server, every walk. Commit only after: scripts/release.sh && git commit …
# Never edit a scripts/*.sh file while it is running: bash reads a script incrementally, so a mid-run edit corrupts the tail of the
# run (it once turned the last line into "us,: command not found"). The scripts wrap their body in main() so the whole file is
# parsed before anything executes, which protects against it; not editing them mid-run protects against everything else.

# The walks, run one at a time by scripts/smoke.sh (each reseeds first):
npx tsx scripts/smoke.ts          # Playwright walkthrough of the daily loop; writes ./screenshots
npx tsx scripts/smoke-wizards.ts  # Webinar + offer wizards, repurposing, clients, community pass
npx tsx scripts/smoke-wave3.ts    # Doctrine, proof, groups, distribution, simple pathway, targets, courses, certification, integrations, webhooks (header + Ed25519 signature), data export
npx tsx scripts/smoke-composer.ts  # Composer: the CTA as its own field (desktop and phone), per-channel previews, one-click schedule everywhere, collapsible nav
npx tsx scripts/smoke-library.ts   # Library browse, search, use in composer, save to library, coach share
npx tsx scripts/smoke-auth.ts     # /setup token gate + 404s, forgot → reset with session invalidation, change password (needs a current `next build`)
npx tsx scripts/smoke-essence.ts   # Essence: empty says so at the point of use, sections save and count, the cap refuses, every AI system message leads with the Essence (cached) then the task, cache tokens on the usage row
npx tsx scripts/smoke-fathom.ts    # Fathom harvest: own key + tick one, recording list, one recording read only when picked, verbatim check, tick two, trims not rewrites, attribution on copy, proof into the webinar wizard and composer, against scripts/mock-fathom.ts + mock-ai.ts
npx tsx scripts/smoke-ghl.ts       # Client's own Private Integration token → 401 / 403 / wrong-location reasons → accounts → channel map → schedule → edit in place → status sync → coach's read-only planner audit, against scripts/mock-ghl.ts
npx tsx scripts/smoke-ai.ts          # Bring-your-own AI key: 401 / no-billing / wrong-provider reasons, a ✨ feature on the member's key, usage for member and coach, daily cap + override (needs AI_BASE_URL=http://localhost:4020 and scripts/mock-ai.ts)
npx tsx scripts/smoke-socrates.ts    # Socrates Domain: lessons in order, library filters + own question, grouped reframes with the restored credit, script wizard to a copied script, Conversations link
npx tsx scripts/smoke-ladders.ts     # Ladder facts, skeleton + checklist blocks, finished ladder clears, live hour, Airtable copy, composer hand-off, scheduled posts keep their text until "Push the update"
npx tsx scripts/smoke-headers.ts     # Every page as client and coach under the Content Security Policy: no violations, no page errors
npx tsx scripts/smoke-firstday.ts    # A new client's first five minutes on a phone: join, welcome card, no admin tasks, touch targets, 16px fields, installable (manifest + icons), no developer copy
npx tsx scripts/smoke-loop.ts        # The daily loop's edges: broken-streak notice + repair, close pre-filled from the day, editing a close scores the difference, member timezone, coach nudge
npx tsx scripts/smoke-rewards.ts     # Earn Your Way: whole catalogue visible, no link = "Opening soon", claim = points off + booking link, workspace caps with reopen date, server-side refusal, coach claims read-only (needs REWARDS_CONFIG_OVERRIDE; dev-server.sh sets it)
npx tsx scripts/smoke-coach.ts       # Coach opens a client: roster link → /coach/[clientId] (their words, pathway, claims, built, pillars), nudge, call note → tasks tagged "From your call" on the client's Today/Tasks, inbound GoHighLevel appointment books an open claim only when certain
npx tsx scripts/smoke-email.ts       # SendGrid adapter against scripts/mock-sendgrid.ts: 202 payload shape, 401 reason, reminder loop survives one failing recipient
npx tsx scripts/snapshot-preview.ts out.html   # Crawls the running app into one read-only, clickable HTML file for sharing a preview
```

## The Essence System: brand voice as config

Every ✨ action promises the client's voice, and the voice comes from one place: the client's Essence, fourteen sections of JSON they fill in at Build → Essence (Danno's production schema plus representative stories), capped at 20,000 characters so it stays portable to the bot. Every model call goes through `draft()` in `src/lib/ai.ts`, which builds the system message itself: the Essence first, marked for prompt caching, then the feature's task instruction. ESLint keeps the provider SDKs out of every other file, so no feature can compose its own system message and drift. With an empty Essence the task runs alone, no voice is invented, and the ✨ line at the point of use says the output will read generic with a link into the wizard. Usage rows carry cache write and read tokens and the cost estimate prices them (1.25× and 0.1× of the input price); the AI card on Settings says what the prefix adds per call.

## Three AI actions that share one prompt, on purpose

The composer's "shape for every channel", the repurpose page's channel drafts and its group drafts all send the same
shape of prompt: adapt this one post for a target, with the target's rules. The composer's version is the superset (it
takes channels and groups). They are kept separate because the persistence differs, and that difference is the point:
composer output is a draft still being worked on (overrides until scheduled); repurpose and group output is a saved
variant the client has decided to keep. Merging them would trade a real behavioural difference for tidier code. Revisit
only if clients ask why there are three ways to do one thing.

A group post lands on a channel like any other: the client's own group is `fb_group`, anyone else's is `other_groups`
(`groupChannel` in `src/lib/engine/groups.ts`). Its length and link rule come from that channel's spec, in the rule-based
draft, the counters, and the prompt alike; the group's own rules can only tighten them (a no-links rule wins).

Format belongs to the channel, not the feature. Each entry in `CHANNEL_SPECS` carries `tone` (the channel's posture) and
`format` (the container the words go in: reading level, sentence length, line breaks). Every prompt that targets a channel
(composer polish, repurpose, group drafts) appends the channel's format line beside its limit and link rule, and the ladder
attaches it to each output field by the channel that field lands on (the post body and rungs to Facebook, the caption to
Instagram, the chain to Threads). The Facebook personal and page lines are the ladder's, verbatim; the other eight are
Danno's signed-off lines, and a wrong one is a data edit. The test for which column a rule belongs in: it is format if it
would change when the channel changed for the same writer, tone if it would change when the writer changed on the same
channel. An empty tone is allowed and is never padded; the voice then comes entirely from the client's Essence. Neither
column restates the limit or the link rule the prompt already prints beside them, and neither carries a house practice: a
client's hashtag comes from their own settings. The rule of thumb: the more specific layer wins on tone (a group's own rules
over its channel's posture), format is bounded by the channel regardless.

A character count appears once per prompt and comes from `maxChars`, never from a literal in prose. That covers the ladder's
output contract (each channel field carries "Max N chars" from the spec; the post body, which goes to both Facebook
channels, carries the tighter limit and names both), the ladder's publish checklist and scaffold, and the composer's red
counter, which now says which limit and whose. A unit test refuses any character count written as a literal in the ladder
engine, which is the shape the 1800 bug took.

## Stack

Next.js 16 (App Router, server actions), React 19, Tailwind 4, Drizzle ORM on SQLite/libsql, `jose` sessions,
`bcryptjs` passwords. No client-side data library, no external services required to run.

- `src/db/schema.ts` — the data model. `drizzle/` holds generated migrations; they apply automatically on first request.
- `src/lib/engine/` — pure rules: `streak.ts`, `points.ts`, `tiers.ts`, `nba.ts`, `webinar.ts` (acts, sections, readiness, deck outline), `offer-score.ts`, `repurpose.ts`. Tested in `__tests__`.
- `src/lib/actions/` — server actions (all writes). `src/lib/queries/` — reads.
- `src/app/(app)/` — the signed-in app. `src/app/(auth)/` — login and invite join.
- `src/data/seed/*.json` — template content pulled from the HelixOS base (stages, task library, curriculum, DM library, tiers, prizes, rewards).
- `src/data/curriculum-links.json` — where each 30-day build day is done: an in-app path (the offer wizard, the composer, Groups, Conversations…) or a lesson URL. Empty means the card offers only "Done, log it".
- `src/data/lesson-links.json` — a link per course lesson that has nothing behind it, keyed by lesson name. Empty means the lesson shows "Your coach is adding this lesson" with no Done button; a link gives it an "Open the lesson" button and the Done button back.
- `src/data/rewards-config.json` — the booking link for each reward and prize (empty = "Opening soon", never claimable) and `perMonth`: `calendar` (a Per Month cap resets on the 1st; quarters on the quarter) or `rolling` (last 30 / 90 days). Kept apart from the seed so a re-import from Airtable never wipes it. Caps count every client in the workspace together. `calendarIds` maps a reward name to its GoHighLevel calendar id: with it, an inbound appointment webhook marks that exact claim booked; without it, only a member's single open claim is booked and two open claims are reported, never guessed.
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
2. Vercel → Environment Variables: `SESSION_SECRET`, `DATABASE_URL` (libsql://…), `DATABASE_AUTH_TOKEN`, `APP_URL`, `CRON_SECRET`, and `SENDGRID_API_KEY` + `EMAIL_FROM` (reminders and password resets; without them emails are logged, not sent). Leave `DEMO_LOGIN` unset so the demo buttons stay hidden.
3. Deploy. The `vercel-build` script runs `npm run db:migrate` against `DATABASE_URL` and then builds; migrations never run from a request, and the build never opens the database. `vercel.json` schedules the hourly reminder cron.
4. Create your real workspace once, in the browser. Set `SETUP_TOKEN` in Vercel to a long random string, redeploy, then open `https://your-app/setup?token=THAT_STRING` and fill in the form: workspace name, your name, email, password, timezone. It creates the workspace and your coach login, loads the library (no demo data), signs you in, and shows the client and coach invite links once. The page is a 404 whenever `SETUP_TOKEN` is unset, the token is wrong, or a workspace already exists. Remove `SETUP_TOKEN` afterwards.

   For automation the same thing is available as a script: `npm run db:bootstrap -- --name … --coach-email … --coach-name … --password …` (both call the one shared function in `src/lib/setup.ts`).

5. Log in as coach → Integrations: turn GoHighLevel on (no credential needed), enter the Community Loyalty key. Send a client their invite link. Each client connects their own GoHighLevel sub-account from Settings → Publishing.

Accounts: `/forgot` emails a single-use reset link (60 minutes, token stored as a sha256 hash, SendGrid required in production); `/reset/[token]` sets the new password and signs every other session out; Settings has change-password with the current password required. Both routes are rate-limited per IP and per email.

Security notes: `SESSION_SECRET` is required in production (the app refuses to start sessions without it). Per-client GoHighLevel Private Integration tokens and the Community Loyalty key are encrypted at rest with AES-256-GCM under `ENCRYPTION_KEY` (falls back to `SESSION_SECRET`). There is no agency-level GoHighLevel credential anywhere: a client's token can only reach their own sub-account, so no member can publish or read as another. Integrations may only call approved HTTPS hosts (`services.leadconnectorhq.com`, `api.communityloyalty.app`, plus `INTEGRATION_URL_ALLOWLIST`). The cron endpoint refuses every call when `CRON_SECRET` is unset. Login is limited to 8 attempts per email and 30 per IP per 15 minutes; join to 20 per IP. Every export from `src/lib/actions` must be a `*Action` (ESLint enforces it) because "use server" exports are public endpoints. Inbound webhooks authenticate with the per-workspace secret in the `x-helix-secret` header (never the query string, which lands in hosting and CDN logs); only the secret's sha256 is stored and it is shown once when created. GoHighLevel marketplace-app webhooks are instead verified by their Ed25519 `x-ghl-signature` against `GHL_WEBHOOK_PUBLIC_KEY`, with the sub-account matched by `locationId`. Every response carries a Content Security Policy, HSTS, `Referrer-Policy` and `nosniff` (no frame-ancestors / X-Frame-Options, so the app can be embedded in GoHighLevel). Points, streaks, daily logs and coach roll-ups are scoped by workspace as well as user, so a user in two workspaces never sees data cross over. Library entries chosen in a form are re-checked against the member's scope before they are read.

Data export: every member can download everything they own from Settings → Your data (`/api/export?format=json`, or `format=csv&table=leads|content|client_records|…`); a coach can export a client from the Coach page for offboarding. Passwords, tokens and secret hashes are never included.

## Deploying

- **Database**: keep `DATABASE_URL=file:./data/helixos.db` on a persistent disk (Fly, Railway, a VPS), or point it at
  Turso (`libsql://…` + `DATABASE_AUTH_TOKEN`) for serverless hosts like Vercel.
- **Reminders**: schedule `GET /api/cron/reminders` hourly with `Authorization: Bearer $CRON_SECRET`.
  Add `SENDGRID_API_KEY` and `EMAIL_FROM` (`HelixOS <helixos@evolveomega.com>`, on a domain verified in SendGrid) to actually send; without them, emails are logged. One bad recipient or provider error is logged per member and never stops the run.
- **Sessions**: set a long random `SESSION_SECRET`. Set `APP_URL` so invite links and emails point at the right host.

## Onboarding a new client

1. Coach opens **Settings** and copies the client invite link. When a client moves up to Elite, flip their **Community Pass** on from the Coach view.
2. Client signs up at `/join/CODE`. They land on Day 1 with the full pathway seeded, a primary goal, and four starter tasks.
3. Every day: lock in → work the list → close. Points and streaks do the rest.
