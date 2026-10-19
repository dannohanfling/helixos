import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_CAUSES, IDENTIFY_SETTLE_MS, cleanHost, isChatCause } from "../chat-cause";

const SRC = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("telling the chat who the member is (H-1199, plan H-1203)", () => {
  it("knows its four causes and nothing else", () => {
    expect(CHAT_CAUSES).toEqual(["identified-ready", "identified-loaded", "sdk-never-loaded", "csp-blocked"]);
    for (const c of CHAT_CAUSES) expect(isChatCause(c)).toBe(true);
    for (const c of ["", "identified", "a@b.com", 3, null, undefined]) expect(isChatCause(c)).toBe(false);
  });

  it("keeps only a host name from a blocked address, never its path or query", () => {
    expect(cleanHost("https://sdk.dfktv2.com/js/sdk.js?user=abc")).toBe("sdk.dfktv2.com");
    expect(cleanHost("communityloyalty.io")).toBe("communityloyalty.io");
    expect(cleanHost("inline")).toBe("inline");
    expect(cleanHost("not a host at all")).toBeNull();
    expect(cleanHost(42)).toBeNull();
  });

  it("the widget tells the chat first and opens it only once that has settled, on every ready, and reports once", () => {
    const w = read("components/chat-widget.tsx");
    const call = w.indexOf("const result = bot.setUser(");
    const open = w.indexOf("w.$chatbot?.open?.()");
    expect(call).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(call);
    expect(w.slice(call, open)).toMatch(/void settled\(result\)\.then/);
    // No open straight after setUser any more.
    expect(w).not.toMatch(/bot\.open\?\.\(\);/);
    // Every ready identifies again: the handler has no once-only guard.
    expect(w).toMatch(/const onReady = \(\) => identify\("ready"\);/);
    expect(w).toMatch(/if \(reportedThisLoad\) return;\n  reportedThisLoad = true;/);
    expect(w).toMatch(/report\("sdk-never-loaded"\)/);
    expect(w).toMatch(/report\("csp-blocked", host\)/);
    // The client widget never imports the server's chat engine (it holds node:crypto).
    expect(w).not.toMatch(/from "@\/lib\/engine\/chat";/);
    expect(read("lib/engine/chat-cause.ts")).not.toMatch(/^import /m);
    expect(IDENTIFY_SETTLE_MS).toBeGreaterThanOrEqual(1000);
  });

  it("the report route carries no member: no user on the row, the cause and a host only", () => {
    const r = read("app/api/chat-seen/route.ts");
    expect(r).toMatch(/userId: null/);
    expect(r).toMatch(/payload: \{ cause: body\.cause, \.\.\.\(host \? \{ host \} : \{\}\) \}/);
    expect(r).not.toMatch(/email|v\.user\.name/);
  });
});
