import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HEADSHOT_IMPORT, attachmentProblem, attachmentUrlAllowed, dryRunLine, extFor, firstAttachment, headshotKey, headshotKeyOk, matchedCount, normEmail, parseRow, planImport, type HeadshotRow, type MemberRef } from "../headshots";

/** Client headshots from Airtable (Danno, 8 Oct): the match, the plan and its words, the key, and where a photo may come from. */
const att = (id: string, over: Record<string, unknown> = {}) => [{ id, url: `https://v5.airtableusercontent.com/${id}`, type: "image/jpeg", size: 300_000, filename: `${id}.jpg`, ...over }];
const row = (recordId: string, email: string | null, attachment: string | null, name = "A client"): HeadshotRow => parseRow({ id: recordId, fields: { [HEADSHOT_IMPORT.fields.headshot]: attachment ? att(attachment) : undefined, [HEADSHOT_IMPORT.fields.email]: email ?? undefined, [HEADSHOT_IMPORT.fields.name]: name } });
const member = (membershipId: string, email: string, over: Partial<MemberRef> = {}): MemberRef => ({ membershipId, email, source: null, airtableId: null, ...over });

describe("client headshots", () => {
  it("reads a row: the first attachment, the email trimmed and lower-cased (a lookup's first), the name", () => {
    expect(normEmail("  Maya@Example.COM ")).toBe("maya@example.com");
    expect(normEmail(["Jo@x.io", "other@x.io"])).toBe("jo@x.io");
    expect(normEmail("not an email")).toBeNull();
    expect(normEmail(undefined)).toBeNull();
    expect(firstAttachment([...att("att1"), ...att("att2")])?.id).toBe("att1");
    expect(firstAttachment([])).toBeNull();
    const r = row("rec1", " Maya@Example.com", "att1", " Maya Torres ");
    expect(r).toMatchObject({ recordId: "rec1", email: "maya@example.com", name: "Maya Torres", attachment: { id: "att1", type: "image/jpeg" } });
    expect(attachmentProblem({ type: "image/gif", size: 10 })).toContain("not a JPEG");
    expect(attachmentProblem({ type: "image/png", size: 11 * 1024 * 1024 })).toBe("larger than 10 MB");
    expect(attachmentProblem({ type: "image/webp", size: 10 })).toBeNull();
  });
  it("the plan: one member matched; no email, a shared email, no member and several members to review; no attachment counted; never a guess", () => {
    const members = [member("m-maya", "maya@example.com"), member("m-jo", "jo@example.com"), member("m-dup1", "dup@example.com"), member("m-dup2", "dup@example.com")];
    const rows = [row("r1", "maya@example.com", "a1"), row("r2", null, "a2"), row("r3", "twice@example.com", "a3"), row("r4", "twice@example.com", "a4"), row("r5", "nobody@example.com", "a5"), row("r6", "dup@example.com", "a6"), row("r7", "jo@example.com", null)];
    const p = planImport(rows, members);
    expect(p.store.map((x) => [x.row.recordId, x.membershipId])).toEqual([["r1", "m-maya"]]);
    expect(p.review.map((x) => [x.row.recordId, x.reason, x.candidates])).toEqual([["r2", "no_email", []], ["r3", "shared_email", []], ["r4", "shared_email", []], ["r5", "no_match", []], ["r6", "several_members", ["m-dup1", "m-dup2"]]]);
    expect(p.noHeadshot).toBe(1);
    expect(matchedCount(p)).toBe(1);
    expect(dryRunLine(p)).toBe("1 matched, 5 need review, 1 no headshot. Of the matched: 1 to store.");
  });
  it("a re-run: the same attachment is unchanged, a new one is stored; a member's own upload or removal is kept, whatever Airtable holds", () => {
    const members = [member("m1", "a@x.io", { source: "import", airtableId: "att-old" }), member("m2", "b@x.io", { source: "import", airtableId: "att-same" }), member("m3", "c@x.io", { source: "upload" }), member("m4", "d@x.io", { source: "removed", airtableId: "att-gone" })];
    const p = planImport([row("r1", "a@x.io", "att-new"), row("r2", "b@x.io", "att-same"), row("r3", "c@x.io", "att-c"), row("r4", "d@x.io", "att-gone")], members);
    expect(p.store.map((x) => x.membershipId)).toEqual(["m1"]);
    expect(p.unchanged.map((x) => x.membershipId)).toEqual(["m2"]);
    expect(p.kept.map((x) => [x.membershipId, x.why])).toEqual([["m3", "upload"], ["m4", "removed"]]);
    expect(dryRunLine(p)).toBe("4 matched, 0 need review, 0 no headshot. Of the matched: 1 to store, 1 unchanged, 2 keep the client's own choice.");
  });
  it("the private store's key: headshots/<workspace>/<folder>/<id>.<ext>, three safe segments, nothing else", () => {
    expect(headshotKey("ws1", "m1", "abc", "jpg")).toBe("headshots/ws1/m1/abc.jpg");
    expect(headshotKeyOk("headshots/ws1/review/abc-512.jpg")).toBe(true);
    expect(headshotKeyOk("headshots/ws1/../abc.jpg")).toBe(false);
    expect(headshotKeyOk("proofs/ws1/m1/abc.jpg")).toBe(false);
    expect(headshotKeyOk("headshots/ws1/m1/abc.svg")).toBe(false);
    expect([extFor("image/png"), extFor("image/webp"), extFor("image/jpeg")]).toEqual(["png", "webp", "jpg"]);
  });
  it("an attachment is fetched only from Airtable's hosts over https, or the configured mock's own origin", () => {
    const api = "https://api.airtable.com";
    expect(attachmentUrlAllowed("https://v5.airtableusercontent.com/v3/u/abc", api)).toBe(true);
    expect(attachmentUrlAllowed("https://dl.airtable.com/.attachments/abc", api)).toBe(true);
    expect(attachmentUrlAllowed("http://v5.airtableusercontent.com/abc", api)).toBe(false);
    expect(attachmentUrlAllowed("https://evil.example.com/abc", api)).toBe(false);
    expect(attachmentUrlAllowed("http://169.254.169.254/latest", api)).toBe(false);
    expect(attachmentUrlAllowed("http://localhost:4070/__attachments/a.jpg", "http://localhost:4070")).toBe(true);
    expect(attachmentUrlAllowed("not a url", api)).toBe(false);
  });
  it("the photo's private addresses are named only in server files, never a client component; the routes check who may see it", () => {
    const root = path.join(process.cwd(), "src");
    const walk = (d: string, out: string[] = []): string[] => { for (const e of readdirSync(d)) { const f = path.join(d, e); if (statSync(f).isDirectory()) { if (e !== "__tests__") walk(f, out); } else if (/\.tsx?$/.test(e)) out.push(f); } return out; };
    const naming = walk(root).filter((f) => /\b(headshotUrl|headshotDisplayUrl|photoUrl)\b/.test(readFileSync(f, "utf8"))).map((f) => path.relative(root, f).replaceAll("\\", "/")).sort();
    expect(naming).toEqual(["app/api/headshots/[membershipId]/route.ts", "db/schema.ts", "lib/actions/headshots.ts", "lib/erase.ts", "lib/headshots.ts", "lib/member-data.ts", "components/app-shell.tsx"].sort());
    for (const f of naming) expect(readFileSync(path.join(root, f), "utf8")).not.toMatch(/^\s*["']use client["']/m);
    const route = readFileSync(path.join(root, "app/api/headshots/[membershipId]/route.ts"), "utf8");
    expect(route).toMatch(/m\.userId === v\.user\.id \|\| \(v\.role === "coach" && !v\.switchedInto\)/);
    expect(route).toMatch(/private, no-store/);
  });
});
