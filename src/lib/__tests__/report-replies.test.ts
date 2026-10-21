import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Report statuses that tell the member (H-202), on a real database of its own: the receipt on the report, a reply sent once
 * with its edited words and logged, Done refused until its blank is filled, the email only while Emails from HelixOS is on,
 * a follow-up that sends it back to New, the member reading only their own, and the badge counting New only. Migration 0232.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-replies-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
const sendEmail = vi.fn(async () => "logged" as const);
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendEmail }));

const { db, schema, ensureMigrated } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { addReceipt, followUp, myReports, sendReply, unreadReplies, markRepliesRead } = await import("@/lib/report-replies");
const { unseenReports } = await import("@/lib/queries/reports");
const { HOW_BLANK } = await import("@/lib/engine/report-status");

const W = "w-replies";
const COACH = { workspaceId: W, userId: "u-coach", name: "Danno Hanfling" };
const MAYA = { workspaceId: W, userId: "u-maya" };
const JO = { workspaceId: W, userId: "u-jo" };
const report = async (id: string) => (await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, id) }))!;

beforeAll(async () => {
  await ensureMigrated();
  await db.insert(schema.workspaces).values({ id: W, name: "Studio", slug: "studio-replies", clientInviteCode: "CI-REP", coachInviteCode: "CO-REP" });
  for (const [id, name, role, emails] of [["u-coach", "Danno Hanfling", "coach", true], ["u-maya", "Maya Torres", "client", true], ["u-jo", "Jo Lee", "client", false]] as const) {
    await db.insert(schema.users).values({ id, email: `${id}@replies.test`, name, passwordHash: "x", firstSignedInAt: "2026-10-01T00:00:00.000Z" });
    await db.insert(schema.memberships).values({ id: `m-${id}`, workspaceId: W, userId: id, role, emailsEnabled: emails });
  }
  await db.insert(schema.memberReports).values([
    { id: "r-maya", ...MAYA, kind: "issue", severity: "red", description: "GoHighLevel still not connecting after I paste the key." },
    { id: "r-jo", ...JO, kind: "suggestion", severity: "green", description: "A calendar link would help." },
  ]);
  await addReceipt(MAYA, "r-maya", "Danno");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("report statuses that tell the member", () => {
  it("puts the receipt on the report at once, and the badge counts New", async () => {
    const [thread] = (await myReports(MAYA)).filter((t) => t.report.id === "r-maya");
    expect(thread!.messages.map((m) => [m.kind, m.body])).toEqual([["receipt", "Got it, Danno will see this soon."]]);
    expect(await unseenReports(W)).toBe(2);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends a reply once, with the edited words, logged and emailed while emails are on", async () => {
    const words = "Thanks, Maya. I've got your note about the GHL key and I'm on it.";
    expect(await sendReply(COACH, "r-maya", "seen", words, "the GHL key")).toEqual({ ok: true, emailed: true });
    expect(await sendReply(COACH, "r-maya", "seen", words, "the GHL key")).toEqual({ ok: true, emailed: true });
    const r = await report("r-maya");
    expect(r).toMatchObject({ status: "seen", topic: "the GHL key" });
    expect(r.seenAt).toBeTruthy();
    const log = (await db.query.reportMessages.findMany({ where: eq(schema.reportMessages.reportId, "r-maya") })).filter((m) => m.kind === "status");
    expect(log.map((m) => [m.status, m.body, m.byUserId, m.emailed])).toEqual([["seen", words, "u-coach", true]]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0] as unknown as string[])[1]).toBe("Danno replied about the GHL key");
    expect(await unseenReports(W)).toBe(1);
  });

  it("refuses Done until it says how, and emails no one whose emails are off", async () => {
    expect(await sendReply(COACH, "r-maya", "done", `Done: the GHL key is fixed. ${HOW_BLANK}. Thanks for flagging it!`, null)).toEqual({ ok: false, error: expect.stringMatching(/how it was fixed/) });
    expect((await report("r-maya")).status).toBe("seen");
    expect(await sendReply(COACH, "r-jo", "not_now", "Thanks for the idea about a calendar link. We're holding it for now because the app comes first.", null)).toEqual({ ok: true, emailed: false });
    // Jo's Emails from HelixOS is off: no email, the reply is still on the report.
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await report("r-jo")).status).toBe("not_now");
  });

  it("a member reads only their own reports, and Today's line clears once read", async () => {
    expect((await myReports(MAYA)).map((t) => t.report.id)).toEqual(["r-maya"]);
    expect(await unreadReplies(MAYA)).toEqual({ count: 1, reportId: "r-maya" });
    await markRepliesRead(MAYA);
    expect((await unreadReplies(MAYA)).count).toBe(0);
  });

  it("a follow-up goes on the same report and sends it back to New; never on someone else's", async () => {
    expect(await followUp(MAYA, "r-maya", "It still fails on my phone.")).toEqual({ ok: true });
    const r = await report("r-maya");
    expect(r.status).toBe("new");
    expect(r.seenAt).toBeNull();
    expect(await followUp(MAYA, "r-jo", "Not mine")).toEqual({ ok: false, error: "That report isn't here any more." });
    expect(await unseenReports(W)).toBe(1);
  });
});

describe("migration 0232", () => {
  it("comes after every migration before it in the journal, by number and by time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0232_report_statuses");
    expect(at).toBeGreaterThan(0);
    for (const e of journal.entries.slice(0, at)) {
      expect(e.tag < "0232").toBe(true);
      expect(e.when).toBeLessThan(journal.entries[at]!.when);
    }
  });
});
