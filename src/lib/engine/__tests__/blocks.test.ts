import { describe, expect, it } from "vitest";
import { A_MEMBER, boardName, canBlock, CANT_BLOCK_COACH, NO_BLOCKS, readContentReport, reasonOf, REASON_SEVERITY, reportStatus, shortName, veil, visibleWins, type BlockSet } from "../blocks";
import { champions, standings, type Standing } from "../colosseum";

const blocks: BlockSet = { memberships: new Set(["m-leo"]), users: new Set(["u-leo"]), wins: new Set(["w-reported"]) };
const row = (userId: string, name: string, over: Partial<Standing> = {}): Standing => ({ userId, membershipId: `m-${userId.slice(2)}`, name, points: 100, week: 10, tier: "Sage", hidden: false, photo: true, isYou: false, ...over });

describe("one rule for every feed (H-745)", () => {
  it("wins: a blocked member's are gone, a reported one is gone for the reporter, a hidden one for everyone", () => {
    const wins = [
      { id: "w1", userId: "u-mia", hiddenAt: null },
      { id: "w2", userId: "u-leo", hiddenAt: null },
      { id: "w-reported", userId: "u-mia", hiddenAt: null },
      { id: "w4", userId: "u-mia", hiddenAt: "2026-10-18T10:00:00Z" },
    ];
    expect(visibleWins(wins, blocks).map((w) => w.id)).toEqual(["w1"]);
    expect(visibleWins(wins, NO_BLOCKS).map((w) => w.id)).toEqual(["w1", "w2", "w-reported"]);
  });
  it("arena and standings: the blocked member keeps the seat as 'A member', with no photo", () => {
    const rows = [row("u-leo", "Leo Tolstoy", { week: 99 }), row("u-mia", "Mia Wong")].map((r) => veil(r, blocks));
    expect(rows[0]).toMatchObject({ name: A_MEMBER, photo: false, veiled: true, points: 100, week: 99 });
    expect(rows[1]).toMatchObject({ name: "Mia Wong", photo: true, veiled: false });
    expect(standings(rows)).toHaveLength(2);
    expect(champions(rows)[0].name).toBe(A_MEMBER);
    expect(shortName(A_MEMBER)).toBe(A_MEMBER);
  });
  it("the Rewards leaderboard: 'First L.', the arena's shape, and 'A member' for someone blocked", () => {
    expect(shortName("Leo Tolstoy")).toBe("Leo T.");
    expect(shortName("Cher")).toBe("Cher");
    expect(boardName({ name: "Mia Ann Wong", avatarEmoji: "🌱" }, "u-mia", blocks)).toEqual({ name: "Mia W.", emoji: "🌱" });
    expect(boardName({ name: "Leo Tolstoy", avatarEmoji: "🦁" }, "u-leo", blocks)).toEqual({ name: A_MEMBER, emoji: "🧭" });
    expect(boardName(undefined, "u-x", NO_BLOCKS)).toEqual({ name: "Member", emoji: "🧭" });
  });
});

describe("who can be blocked", () => {
  const me = { membershipId: "m-ana" };
  it("never the coach, never yourself, never someone gone", () => {
    expect(canBlock(me, { membershipId: "m-coach", userId: "u-coach", role: "coach" })).toEqual({ ok: false, error: CANT_BLOCK_COACH });
    expect(canBlock(me, { membershipId: "m-ana", userId: "u-ana", role: "client" }).ok).toBe(false);
    expect(canBlock(me, { membershipId: "m-leo", userId: "u-leo", role: "client", removed: true }).ok).toBe(false);
    expect(canBlock(me, null).ok).toBe(false);
    expect(canBlock(me, { membershipId: "m-leo", userId: "u-leo", role: "client" })).toEqual({ ok: true });
  });
});

describe("a Content report", () => {
  it("needs a target and one of the three reasons; the note is optional and kept short", () => {
    expect(readContentReport({ targetKind: "win", targetId: "w1", reason: "spam", note: "" })).toEqual({ value: { targetKind: "win", targetId: "w1", reason: "spam", severity: "orange", note: "" } });
    expect(readContentReport({ targetKind: "member", targetId: "m1", reason: "harassment", note: " Said hurtful things \u0007 " })).toMatchObject({ value: { severity: "red", note: "Said hurtful things" } });
    expect(readContentReport({ targetKind: "post", targetId: "w1", reason: "spam", note: "" })).toHaveProperty("error");
    expect(readContentReport({ targetKind: "win", targetId: " ", reason: "spam", note: "" })).toHaveProperty("error");
    expect(readContentReport({ targetKind: "win", targetId: "w1", reason: "rude", note: "" })).toHaveProperty("error");
    expect(readContentReport({ targetKind: "win", targetId: "w1", reason: "other", note: "x".repeat(1001) })).toHaveProperty("error");
  });
  it("the reason round-trips through the colour, and the reporter reads Handled once the coach acted", () => {
    for (const r of ["spam", "harassment", "other"] as const) expect(reasonOf(REASON_SEVERITY[r])).toBe(r);
    expect(reportStatus({ kind: "content", seenAt: "x", doneAt: null, handledAt: null })).toBe("Sent");
    expect(reportStatus({ kind: "content", seenAt: null, doneAt: null, handledAt: "2026-10-18" })).toBe("Handled");
    expect(reportStatus({ kind: "content", seenAt: null, doneAt: "2026-10-18", handledAt: null })).toBe("Handled");
    expect(reportStatus({ kind: "issue", seenAt: "x", doneAt: null })).toBe("Seen");
    expect(reportStatus({ kind: "issue", seenAt: "x", doneAt: "y" })).toBe("Done");
  });
});
