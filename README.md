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
| **Pathway** | 7 stages × 215 tasks with teaching copy, proof submission, coach verification, plus the 30-day curriculum | 🛣️ Success Pathway Stages, 🏆 Success Task Library, 📆 30-Day Curriculum |
| **Numbers** | Weekly stat tiles with deltas, 12-week bar chart, consistency calendar, top posts | 📊 Daily Activity Log, #️⃣ KPIs |
| **Rewards** | Points, 9 tiers (Artisan → Olympian), prize ladder, spendable rewards, weekly leaderboard, ledger | 🏅 Community Tiers, 🎁 Prize Ladder, 🎁 Pass Rewards, 📒 Points Ledger |
| **Coach** | Client roster with today's status, streak, tier, pathway progress; verify queue; who needs a nudge; Elite / Community Pass toggle | 🎓 Client Success Path, 🛣️ Success Pathway |
| **Webinars** | 7-step wizard: foundation → 3 belief breaks → 20-section script (5 acts) with story/analogy/objection banks → offer mapping → deck outline → 11-point readiness review → run + debrief numbers. Ships with "The Leaky Webinar" as a worked example. | 🖥️ WebinarOS: 🎭 Acts, 📑 Webinar Sections, 🪜 Wizard Stages, 📖 Story Bank, 🎨 Analogies, 🗣️ Objections, 💡 Beliefs, ✅ Readiness Reviews, 🖼️ Slide Blueprints |
| **Offers** | Offer wizard (avatar, promise, mechanism, 3–5 step path, container, price, guarantee, fit, top 5 objections) + stack builder with belief-break tags + a live optimizer score with fixes + one-pager export | 🎁 OffersOS, 🎁 Offer Components |
| **Repurpose** | One post → 10 channel-native drafts (FB personal / page / your group / other groups / stories / Instagram / Threads / LinkedIn / email / Skool), per-channel posted tracking and numbers; optional Claude polish | 📮 Content Distribution |
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

Set `ANTHROPIC_API_KEY` and two buttons light up: "Draft this section for me" in the Webinar Wizard and "Generate with Claude" on the
repurpose page. Both run through `src/lib/ai.ts` (official SDK, `claude-opus-5`, streaming). Without a key everything still works:
webinar sections start from the worked example and repurposing uses deterministic channel rules in `src/lib/engine/repurpose.ts`.

## Run it

```bash
cp .env.example .env        # set SESSION_SECRET
npm install
npm run db:seed             # creates data/helixos.db, loads the library, and a demo workspace
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
