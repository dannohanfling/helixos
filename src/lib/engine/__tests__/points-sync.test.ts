import { describe, expect, it } from "vitest";
import { inviteDue, levelFor, modeReaches, readInviteLink, tierWords } from "@/lib/engine/points-sync";
import { TIERS } from "@/lib/engine/tiers";

describe("the sync's modes (H-867 steps G and H)", () => {
  it("off reaches nobody, own only the coach, all everyone", () => {
    expect(modeReaches("off", true)).toBe(false);
    expect(modeReaches("own", true)).toBe(true);
    expect(modeReaches("own", false)).toBe(false);
    expect(modeReaches("all", false)).toBe(true);
  });
  it("puts the program on the back, or Coach for the coach", () => {
    expect(levelFor("client", "Accelerator")).toBe("Accelerator");
    expect(levelFor("client", " ")).toBe("Academy");
    expect(levelFor("coach", "Academy")).toBe("Coach");
  });
});

describe("the invitations (H-865, H-867 part 4)", () => {
  const due = (programTier: string, points: number, sent: string[] = [], role = "client") => inviteDue({ role, programTier, points, sent });
  it("Accelerator at Sentinel gets the Academy call", () => {
    // Sentinel from 5,000 under the 19 Oct table (H-1088).
    expect(due("Accelerator", 4999)).toBeNull();
    expect(due("Accelerator", 5000)).toBe("academy");
  });
  it("Academy at Centurion gets Elite; Academy at Sentinel gets nothing", () => {
    expect(due("Academy", 5000)).toBeNull();
    expect(due("Academy", 12000)).toBe("elite");
  });
  it("anyone below Luxe at Olympian gets the Lux conversation, the highest rung earned wins", () => {
    expect(due("Accelerator", 100000)).toBe("lux");
    expect(due("Elite", 100000)).toBe("lux");
    expect(due("Luxe", 100000)).toBeNull();
  });
  it("never goes twice, and never to a member already on that program or above", () => {
    expect(due("Accelerator", 5000, ["academy"])).toBeNull();
    expect(due("Elite", 7500)).toBeNull();
    expect(due("Accelerator", 5000, [], "team")).toBeNull();
  });
  it("follows the kept rank, never a raw points number (H-1088, H-1098)", () => {
    const sentinel = TIERS.find((t) => t.name === "Sentinel")!.level;
    // Reached Sentinel at 3,181 under the old table: still Sentinel, so the Academy call stands.
    expect(inviteDue({ role: "client", programTier: "Accelerator", points: 3181, rankKeptLevel: sentinel, sent: [] })).toBe("academy");
    expect(inviteDue({ role: "client", programTier: "Accelerator", points: 3181, rankKeptLevel: null, sent: [] })).toBeNull();
    // A kept rank is a floor: points above it still count.
    expect(inviteDue({ role: "client", programTier: "Academy", points: 12000, rankKeptLevel: sentinel, sent: [] })).toBe("elite");
  });
  it("names the kept rank for the pass's Tier", () => {
    const sentinel = TIERS.find((t) => t.name === "Sentinel")!.level;
    expect(tierWords(3181, sentinel)).toBe("Sentinel");
    expect(tierWords(1999, null)).toBe("Sage");
    expect(tierWords(2000, null)).toBe("Alchemist");
    expect(tierWords(600, null)).toBe("Sage");
  });
  it("keeps https links only", () => {
    expect(readInviteLink("")).toEqual({ ok: true, value: null });
    expect(readInviteLink(" https://book.example/academy ")).toEqual({ ok: true, value: "https://book.example/academy" });
    expect(readInviteLink("http://book.example").ok).toBe(false);
    expect(readInviteLink("javascript:alert(1)").ok).toBe(false);
  });
});
