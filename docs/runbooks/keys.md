# Rotating HelixOS's own secrets (H-349 §5)

Three secrets are HelixOS's to rotate. Members' keys (GoHighLevel, Community Loyalty, AI, Fathom, WHOOP, leaderboard feeds) are sealed under `ENCRYPTION_KEY` and never need pasting again when the steps below are followed. No value from this page ever goes in a post, a log line, the Forum or the inbox.

## Before anything: set ENCRYPTION_KEY on its own

`ENCRYPTION_KEY` falls back to `SESSION_SECRET` when it is unset. If production runs on the fallback today, rotating `SESSION_SECRET` would make every stored member key unreadable. So, once, before any rotation:

1. Vercel → helixos → Settings → Environment Variables. If `ENCRYPTION_KEY` is absent for Production, add it with the **same value** as `SESSION_SECRET` (that is the key the values are sealed under today). Tick Production and Preview. Redeploy.
2. From now on the two are independent; `SESSION_SECRET` may rotate freely.

## SESSION_SECRET (sign-in cookies)

1. Make a new value: 48+ random characters (`openssl rand -base64 48`).
2. Vercel → Environment Variables → `SESSION_SECRET` → Edit → paste → Save, for Production (and Preview if it has its own).
3. Redeploy. Everyone is signed out once and signs in again. Nothing else changes.

## The Turso database token

1. Turso dashboard → the database → Tokens → Create token (read-write, no expiry).
2. Vercel → `DATABASE_AUTH_TOKEN` → Edit → paste the new one → Save, for the environment that database serves (Production for the live database, Preview for staging).
3. Redeploy and open /api/health: `{ "ok": true }`.
4. Turso → Tokens → revoke the old one. If the health check fails after the revoke, the new token did not reach the right environment: check step 2.

## ENCRYPTION_KEY (members' sealed keys), with the re-seal script

The script decrypts every sealed value with the old key and seals it with the new one, so members never paste again.

1. Make a new value: 48+ random characters.
2. **Staging first.** From a laptop with the staging `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in the environment:
   ```
   OLD_ENCRYPTION_KEY=<current key> ENCRYPTION_KEY=<new key> npx tsx --tsconfig tsconfig.json scripts/reseal.ts --dry-run
   ```
   It prints one line per column: how many values are under the old key, already under the new, unreadable under either, and plain. Nothing is written. On staging the counts are the seed's (the demo workspace's few connections).
3. Run it without `--dry-run` against staging, then open a seeded connection in the preview (Settings → Connect) and see its last four still show.
4. **Production, in this order, inside one quiet window:**
   1. Run the dry run against production. Note the counts. "Unreadable" values were already unreadable (sealed under a key that is gone); they stay as they are and those members are asked to paste again, as today.
   2. Run the re-seal for real against production. It rewrites only the "under the old key" rows, in batches.
   3. Vercel → `ENCRYPTION_KEY` → Edit → paste the new value → Save → Redeploy.
   4. Run the dry run once more with the new key as `OLD_ENCRYPTION_KEY` and any other value as `ENCRYPTION_KEY`: every line should say the values are "under the old key" (that is, readable with the new one) and 0 unreadable beyond step 1's count.
5. Keep the old key somewhere safe for a week, then destroy it. A row written between the re-seal and the redeploy (a member connecting something in that minute) is sealed under the old key; the dry run in step 4.4 shows it as unreadable, and that member pastes once more.

## What the script covers

`src/lib/engine/reseal.ts` lists every sealed column; the unit test checks each exists on its table. Adding a sealed column means adding it there, so the rotation never misses one.
