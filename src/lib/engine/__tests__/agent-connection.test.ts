import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { schema } from "@/db";
import { ago, connectionOf, envVarFor, failuresSince, minuteOf, pingLine, PING_TITLE } from "@/lib/engine/agent-connection";

const now = new Date("2026-10-17T19:00:00Z");
const clock = (iso: string) => iso.slice(11, 16);
const base = { agentName: "Viator", token: null, lastTool: null, failures: null, now, clock };

describe("Check connection (H-559)", () => {
  it("no token yet", () => {
    expect(connectionOf(base)).toEqual({ state: "none", chip: "idle", line: "No token yet. Make one to connect." });
  });

  it("made, never used", () => {
    const r = connectionOf({ ...base, token: { createdAt: "2026-10-17 17:58:00", lastUsedAt: null } });
    expect(r).toEqual({ state: "never", chip: "waiting", line: "Token made 17:58. Viator hasn't connected yet." });
  });

  it("connected: a call within 24 hours, with the tool's name", () => {
    const r = connectionOf({ ...base, token: { createdAt: "2026-10-17 17:58:00", lastUsedAt: "2026-10-17T18:58:00.000Z" }, lastTool: "forum_report" });
    expect(r).toEqual({ state: "connected", chip: "done", line: "Connected. Last call 2 min ago (forum_report)." });
  });

  it("quiet: connected before, nothing for over a day", () => {
    const r = connectionOf({ ...base, token: { createdAt: "2026-10-10 10:00:00", lastUsedAt: "2026-10-14T18:00:00.000Z" }, lastTool: "whoami" });
    expect(r).toEqual({ state: "quiet", chip: "idle", line: "Connected before. Last call 3 days ago." });
  });

  it("failing: calls on a revoked token since the last good call", () => {
    const failures = failuresSince([{ minute: "2026-10-17T18:02:00Z", count: 2 }, { minute: "2026-10-17T18:04:00Z", count: 1 }], "2026-10-17T17:00:00.000Z");
    expect(failures).toEqual({ count: 3, lastAt: "2026-10-17T18:04:00Z" });
    const r = connectionOf({ ...base, token: { createdAt: "2026-10-17 17:58:00", lastUsedAt: "2026-10-17T17:00:00.000Z" }, failures });
    expect(r).toEqual({ state: "failing", chip: "waiting", line: "3 calls at 18:04 used an old or wrong token. Make a new token and update the environment variable." });
  });

  it("a good call after the failures clears them", () => {
    expect(failuresSince([{ minute: "2026-10-17T18:02:00Z", count: 2 }], "2026-10-17T18:30:00.000Z")).toBeNull();
    expect(failuresSince([], null)).toBeNull();
    // The same minute: the order can't be told, and the good call wins.
    expect(failuresSince([{ minute: "2026-10-17T18:02:00Z", count: 2 }], "2026-10-17T18:02:40.000Z")).toBeNull();
    // A failure in the minute after the good call still counts.
    expect(failuresSince([{ minute: "2026-10-17T18:03:00Z", count: 1 }], "2026-10-17T18:02:40.000Z")).toEqual({ count: 1, lastAt: "2026-10-17T18:03:00Z" });
    expect(failuresSince([{ minute: "2026-10-17T18:02:00Z", count: 1 }], null)).toEqual({ count: 1, lastAt: "2026-10-17T18:02:00Z" });
  });

  it("the ping: sent, then answered", () => {
    expect(pingLine(null, clock)).toBeNull();
    expect(pingLine({ sentAt: "2026-10-17 18:05:00", ackedAt: null }, clock)).toBe("Ping sent 18:05");
    expect(pingLine({ sentAt: "2026-10-17 18:05:00", ackedAt: "2026-10-17T18:06:00.000Z" }, clock)).toBe("Ping answered 18:06");
    expect(PING_TITLE).toBe("Connection check from Danno. Reply with handoff_ack.");
  });

  it("names the variable and the minute", () => {
    expect(envVarFor("Viator")).toBe("HELIXOS_TOKEN_VIATOR");
    expect(envVarFor("Big Sky-2")).toBe("HELIXOS_TOKEN_BIGSKY2");
    expect(minuteOf(new Date("2026-10-17T19:05:42.123Z"))).toBe("2026-10-17T19:05:00Z");
    expect([0, 59_000, 120_000, 3 * 3600_000, 86_400_000, 3 * 86_400_000].map(ago)).toEqual(["just now", "just now", "2 min ago", "3 h ago", "1 day ago", "3 days ago"]);
  });

  it("a failure row holds only an agent, its owner, a minute and a count: never a token, a prefix or an address", () => {
    expect(Object.keys(getTableColumns(schema.agentAuthFailures)).sort()).toEqual(["agentId", "count", "id", "minute", "scope", "userId", "workspaceId"]);
  });
});
