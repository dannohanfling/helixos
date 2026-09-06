/**
 * One-time production setup: creates your real workspace, the coach login and the invite codes, and loads the library. No demo data.
 *
 *   npm run db:bootstrap -- --name "Evolve Omega Academy" --coach-email you@example.com --coach-name "Danno Hanfling" --password "choose-a-strong-one" [--slug evolve-omega] [--timezone America/Los_Angeles]
 *
 * Safe to re-run: it refuses to create a second workspace with the same slug and never touches existing data.
 */
import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { seedLibrary } from "@/db/seed";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/password";
import { todayInTz } from "@/lib/dates";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v === undefined || v.startsWith("--")) {
    if (fallback !== undefined) return fallback;
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return v;
}

function code(len = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function main() {
  const name = arg("name");
  const coachEmail = arg("coach-email").toLowerCase();
  const coachName = arg("coach-name");
  const password = arg("password");
  const slug = arg("slug", name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
  const timezone = arg("timezone", "America/Los_Angeles");
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  await ensureMigrated();
  await seedLibrary();
  const existing = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.slug, slug) });
  if (existing) {
    console.error(`A workspace with slug "${slug}" already exists. Nothing changed.`);
    process.exit(1);
  }
  const existingUser = await db.query.users.findFirst({ where: eq(schema.users.email, coachEmail) });
  const wsId = newId();
  const clientInviteCode = code();
  const coachInviteCode = code();
  await db.insert(schema.workspaces).values({ id: wsId, name, slug, timezone, clientInviteCode, coachInviteCode, brandVoice: "Direct. Clear. Punchy. Heart-led, not fluffy. 4th-grade reading level. Short sentences." });
  const coachId = existingUser?.id ?? newId();
  if (!existingUser) await db.insert(schema.users).values({ id: coachId, email: coachEmail, name: coachName, passwordHash: await hashPassword(password), avatarEmoji: "🔱" });
  await db.insert(schema.memberships).values({ id: newId(), workspaceId: wsId, userId: coachId, role: "coach", startedAt: todayInTz(timezone) });
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  console.log(`\nWorkspace "${name}" is ready.`);
  console.log(`Coach login: ${coachEmail}${existingUser ? " (existing user, password unchanged)" : ""}`);
  console.log(`Client invite link: ${appUrl}/join/${clientInviteCode}`);
  console.log(`Coach invite link:  ${appUrl}/join/${coachInviteCode}`);
  console.log(`\nNext: log in at ${appUrl}/login, open Integrations, and send a client their invite link.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
