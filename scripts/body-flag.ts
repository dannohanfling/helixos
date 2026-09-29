/**
 * Switches Body on or off for one member (handoff rev 195: Body ships dark, on per member, never from the UI). Dry run by default:
 * it names the account and each of its memberships with Body's current setting, and changes nothing. With --apply it sets it.
 *   DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npx tsx scripts/body-flag.ts <email> on|off [--apply]
 * Off hides Body again (a 404 on /body, /body/* and the Body export, no nav entry, no Today line, no coach card). The member's
 * Body rows stay until they delete them or the member is deleted; turning it back on shows them again.
 */
import { createClient } from "@libsql/client";

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const apply = process.argv.includes("--apply");
const [email, state] = args;
if (!email || !/^(on|off)$/.test(state ?? "")) {
  console.error("usage: npx tsx scripts/body-flag.ts <email> on|off [--apply]");
  process.exit(2);
}
const on = state === "on";
const url = process.env.DATABASE_URL ?? "file:./data/helixos.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

(async () => {
  console.log(`database: ${url.replace(/\/\/[^@/]*@/, "//…@")} (${apply ? "APPLY" : "dry run"})`);
  const users = await client.execute({ sql: "SELECT id, name FROM users WHERE lower(email) = lower(?)", args: [email.trim()] });
  if (users.rows.length !== 1) {
    console.error(`no account with the email ${email}`);
    process.exit(1);
  }
  const userId = String(users.rows[0].id);
  const rows = await client.execute({ sql: "SELECT m.id, m.role, m.body_enabled, m.removed_at, w.name AS workspace FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?", args: [userId] });
  if (!rows.rows.length) {
    console.error(`${email} has no membership in any workspace`);
    process.exit(1);
  }
  console.log(`${users.rows[0].name} <${email}>`);
  for (const r of rows.rows) console.log(`  ${r.workspace} (${r.role}${r.removed_at ? ", removed" : ""}): Body ${Number(r.body_enabled) ? "on" : "off"} → ${on ? "on" : "off"}`);
  if (!apply) {
    console.log("dry run: nothing changed. Add --apply to set it.");
    return;
  }
  const res = await client.execute({ sql: "UPDATE memberships SET body_enabled = ? WHERE user_id = ?", args: [on ? 1 : 0, userId] });
  console.log(`Body switched ${on ? "on" : "off"} on ${res.rowsAffected} membership${res.rowsAffected === 1 ? "" : "s"}.`);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
