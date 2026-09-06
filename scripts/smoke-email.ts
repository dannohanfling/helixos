/**
 * SendGrid adapter and the reminder run, against scripts/mock-sendgrid.ts on a scratch database:
 * a 202 is success with the right payload shape, a 401 surfaces SendGrid's own message, and one failing recipient in the
 * middle of runReminders never stops the remaining sends. Runs the code directly (no browser, no server).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const mockPort = 4030;
const scratch = process.env.SMOKE_SCRATCH ?? "/tmp/helixos-smoke-email";
const dbFile = `${scratch}/db.db`;

async function main() {
  // Fresh demo database, so the run has real members (Maya and Jordan) to remind.
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const env = { ...process.env, DATABASE_URL: `file:${dbFile}`, SESSION_SECRET: "smoke-session-secret-smoke-session-secret" };
  for (const script of ["scripts/migrate.ts", "src/db/seed.ts"]) {
    const r = spawnSync("npx", ["tsx", "--tsconfig", "tsconfig.json", script], { env, stdio: "ignore" });
    if (r.status !== 0) throw new Error(`${script} failed`);
  }
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.EMAIL_API_URL = `http://localhost:${mockPort}`;
  process.env.EMAIL_FROM = "HelixOS <helixos@evolveomega.com>";
  process.env.APP_URL = "https://helixos.example.test";

  const mock = spawn("npx", ["tsx", "scripts/mock-sendgrid.ts", String(mockPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  try {
    // Imported after the env is set: the db module reads DATABASE_URL on first use.
    const { sendEmail } = await import("@/lib/email");
    const { runReminders } = await import("@/lib/reminders");
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    // 202 is success, and the payload is SendGrid's shape, not Resend's
    process.env.SENDGRID_API_KEY = "SG.good";
    if ((await sendEmail("maya@example.com", "Hello", "Body text")) !== "sent") throw new Error("202 should be 'sent'");
    const recorded = (await (await fetch(`http://localhost:${mockPort}/_sent`)).json()) as { personalizations: { to: { email: string }[] }[]; from: { email: string; name?: string }; subject: string; content: { type: string; value: string }[] }[];
    const last = recorded.at(-1)!;
    if (last.personalizations[0].to[0].email !== "maya@example.com" || last.from.email !== "helixos@evolveomega.com" || last.from.name !== "HelixOS" || last.content[0].type !== "text/plain" || last.content[0].value !== "Body text" || last.subject !== "Hello") throw new Error(`payload shape wrong: ${JSON.stringify(last)}`);
    console.log("✓ 202 accepted; personalizations / from {email,name} / content payload");

    // 401 surfaces SendGrid's own message
    process.env.SENDGRID_API_KEY = "SG.bad";
    let msg = "";
    try {
      await sendEmail("maya@example.com", "Hello", "Body");
    } catch (e) {
      msg = (e as Error).message;
    }
    if (!/SendGrid failed: 401 The provided authorization grant is invalid/.test(msg)) throw new Error(`401 not surfaced: ${msg}`);
    console.log("✓ 401 surfaces the provider's own error text");

    // No key: logged, not sent, no throw
    delete process.env.SENDGRID_API_KEY;
    if ((await sendEmail("x@example.com", "Hi", "b")) !== "logged") throw new Error("no key should log");
    console.log("✓ no key logs to console");

    // Mid-loop failure: whichever client the run processes first is rejected by the provider; the one after must still go out.
    // Today's morning lock-ins are cleared so both qualify. The order is learned from a keyless (logged) dry run.
    const { todayInTz } = await import("@/lib/dates");
    await db.update(schema.dailyLogs).set({ morningDoneAt: null }).where(eq(schema.dailyLogs.date, todayInTz("America/Los_Angeles")));
    const dry = await runReminders(new Date(), "morning");
    if (dry.length < 2 || dry.some((r) => r.delivery !== "logged")) throw new Error(`dry run should log two morning reminders, got ${JSON.stringify(dry)}`);
    const first = dry[0];
    const second = dry[1];
    await db.update(schema.users).set({ email: "first@reject.example.com" }).where(eq(schema.users.id, first.userId));
    process.env.SENDGRID_API_KEY = "SG.good";
    const results = await runReminders(new Date(), "morning");
    const failedAt = results.findIndex((r) => r.delivery === "failed");
    const survivorAt = results.findIndex((r) => r.userId === second.userId && r.delivery === "sent");
    if (failedAt !== 0 || results[0].userId !== first.userId || !/verified Sender Identity.*\(field: from\)/.test(results[0].error ?? "")) throw new Error(`expected the first member's send to fail with SendGrid's reason, got ${JSON.stringify(results)}`);
    if (survivorAt < 0) throw new Error(`the next member's reminder should still send after the first failed: ${JSON.stringify(results)}`);
    if (results.filter((r) => r.delivery === "failed").length !== 1) throw new Error("exactly one failure expected");
    console.log(`✓ runReminders: member 1 failed (${results[0].email}), member ${survivorAt + 1} still sent; the loop carried on`);
  } finally {
    try {
      if (mock.pid) process.kill(-mock.pid, "SIGTERM");
    } catch {
      mock.kill();
    }
  }
  console.log("Email smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
