/**
 * Automation path for first-run setup (the normal path is /setup?token=… in the browser). Same shared function, no demo data.
 *
 *   npm run db:bootstrap -- --name "Evolve Omega Academy" --coach-email you@example.com --coach-name "Danno Hanfling" --password "choose-a-strong-one" [--slug evolve-omega] [--timezone America/Los_Angeles]
 *
 * Safe to re-run: it refuses to create a second workspace with the same slug and never touches existing data.
 */
import { ensureMigrated } from "@/db";
import { createWorkspace, slugify } from "@/lib/setup";

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

async function main() {
  const name = arg("name");
  const coachEmail = arg("coach-email").toLowerCase();
  const coachName = arg("coach-name");
  const password = arg("password");
  const slug = arg("slug", slugify(name));
  const timezone = arg("timezone", "America/Los_Angeles");
  await ensureMigrated();
  const r = await createWorkspace({ name, slug, timezone, coachEmail, coachName, password });
  if (!r.ok) {
    console.error(r.error);
    process.exit(1);
  }
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  console.log(`\nWorkspace "${name}" is ready.`);
  console.log(`Coach login: ${coachEmail}${r.data.existingUser ? " (existing user, password unchanged)" : ""}`);
  console.log(`Client invite link: ${appUrl}/join/${r.data.clientInviteCode}`);
  console.log(`Coach invite link:  ${appUrl}/join/${r.data.coachInviteCode}`);
  console.log(`\nNext: log in at ${appUrl}/login, open Integrations, and send a client their invite link.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
