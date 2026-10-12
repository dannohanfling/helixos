import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CL_COPY, CL_NOTICE, CONNECT_ERRORS, GHL_COPY, clNoticeCode, clRefusal, connectProgress, defaultClAgent, isClContactId, publishBlockers } from "../connect-copy";

const ROOT = join(__dirname, "..", "..", "..", "..");
const conn = (o: Partial<Parameters<typeof publishBlockers>[0] & object> = {}) => ({ accounts: [{}], lastError: null, ghlUserId: "u1", mediaScopeMissingAt: null, ...o });

describe("Connect your tools (rev 850)", () => {
  it("the Community Loyalty test call's refusals are plain sentences, and the code in the address maps back to the same one", () => {
    expect(clRefusal(401)).toBe(CONNECT_ERRORS.clBadKey);
    expect(clRefusal(402)).toBe(CONNECT_ERRORS.clPlan);
    expect(clRefusal(403)).toBe(CONNECT_ERRORS.clPlan);
    expect(clRefusal(500)).toBe(CONNECT_ERRORS.clUnreachable);
    expect(clRefusal(null)).toBe(CONNECT_ERRORS.clUnreachable);
    for (const s of [401, 403, 500]) expect(CL_NOTICE[clNoticeCode(clRefusal(s))]).toBe(clRefusal(s));
  });
  it("a fresh key points at the FAQ agent, else the only one, else asks", () => {
    expect(defaultClAgent([{ ns: "a1", name: "Booking Agent" }, { ns: "a2", name: "FAQ Agent" }])).toBe("a2");
    expect(defaultClAgent([{ ns: "a1", name: "Answers FAQs" }])).toBe("a1");
    expect(defaultClAgent([{ ns: "a1", name: "Booking Agent" }])).toBe("a1");
    expect(defaultClAgent([{ ns: "a1", name: "Booking Agent" }, { ns: "a2", name: "Sales" }])).toBe("");
    expect(defaultClAgent([])).toBe("");
  });
  it("a contact ID is checked for its shape before it is kept", () => {
    expect(isClContactId("f12345u67890")).toBe(true);
    expect(isClContactId(" f12345u67890 ")).toBe(true);
    expect(isClContactId("abc")).toBe(false);
    expect(isClContactId("https://app.example.com/user/1")).toBe(false);
    expect(isClContactId("Maya Torres")).toBe(false);
  });
  it("progress counts the two connections", () => {
    expect(connectProgress({ ghl: false, cl: false }).line).toBe("0 of 2 connected");
    expect(connectProgress({ ghl: true, cl: true }).done).toBe(2);
  });
  it("what's holding a post up: each blocker once, with where to fix it", () => {
    expect(publishBlockers(null)[0].fix.href).toBe("/connect-tools#publishing");
    expect(publishBlockers(conn({ lastError: "That key didn't work." }))[0].what).toContain("That key didn't work.");
    expect(publishBlockers(conn({ accounts: [] }))[0].what).toContain("Social Planner");
    expect(publishBlockers(conn({ ghlUserId: null })).map((b) => b.what).join(" ")).toContain("which GoHighLevel user");
    expect(publishBlockers(conn({ mediaScopeMissingAt: "2026-10-12T00:00:00Z" }))[0].what).toContain("medias.write");
    expect(publishBlockers(conn())).toEqual([]);
  });
  it("Danno's words, no em dashes, and the key is never asked to be shared", () => {
    const words = JSON.stringify([GHL_COPY, CL_COPY, CONNECT_ERRORS]);
    expect(words).not.toContain("—");
    for (const c of [GHL_COPY, CL_COPY]) expect(c.after).toMatch(/Don't email or text your key to anyone/);
  });
  it("the key is never put in an address, a log line or a page: the actions answer with a short code", () => {
    const actions = readFileSync(join(ROOT, "src/lib/actions/connect.ts"), "utf8");
    expect(actions).not.toMatch(/cl=\$\{token|console\.[a-z]+\([^)]*token/);
    const card = readFileSync(join(ROOT, "src/components/cl-connect.tsx"), "utf8");
    expect(card).not.toMatch(/defaultValue=\{m\.clApiToken|open\(m\.clApiToken/);
  });
});
