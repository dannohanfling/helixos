import { describe, expect, it } from "vitest";
import { isStuck, linkWords, moveCounts, readOldMember, sameEmail, switchWords } from "@/lib/engine/pass-move";

describe("readOldMember", () => {
  it("reads names, email, tier as level, the member id and the available balance", () => {
    const m = readOldMember({ data: { id: "cus_2", first_name: "Ben", last_name: "Okafor", email: "ben@example.com", membership_tier: "Silver", points_balance: 300, points_earned: 1300, member_id: "ghl_9" } }, "cus_2");
    expect(m).toEqual({ firstName: "Ben", lastName: "Okafor", email: "ben@example.com", level: "Silver", memberId: "ghl_9", balance: 300 });
  });
  it("falls back to the service's own id, and a missing balance is null", () => {
    const m = readOldMember({ id: "cus_3", email: "x@example.com" }, "cus_3");
    expect(m.memberId).toBe("cus_3");
    expect(m.balance).toBeNull();
    expect(m.level).toBe("");
  });
});

describe("sameEmail", () => {
  it("matches whole addresses, ignoring case and spaces", () => {
    expect(sameEmail(" Ben@Example.com ", "ben@example.com")).toBe(true);
    expect(sameEmail("ben@example.co", "ben@example.com")).toBe(false);
    expect(sameEmail("", "")).toBe(false);
  });
});

describe("words", () => {
  it("say each outcome without a provider name or a price", () => {
    for (const c of ["made", "busy", "making", "notready", "noemail", "refused", "noanswer", "invalid"]) {
      const w = switchWords(c);
      expect(w).not.toBeNull();
      expect(w!.text).not.toMatch(/eloyalty|walletpush|\$/i);
    }
    for (const c of ["made", "nomember", "notready", "busy", "noanswer"]) expect(linkWords(c)).not.toBeNull();
    expect(switchWords("<x>")).toBeNull();
  });
});

describe("isStuck", () => {
  it("lets a make that died ten minutes ago be tried again, in either date shape", () => {
    const now = new Date("2026-10-23T18:00:00Z");
    expect(isStuck("2026-10-23 17:45:00", now)).toBe(true);
    expect(isStuck("2026-10-23T17:55:00.000Z", now)).toBe(false);
  });
});

describe("moveCounts", () => {
  it("counts links, made passes and carries, and flags a carry that didn't arrive whole", () => {
    const rows = [
      { status: "link", carryPoints: null, carryMoveId: null },
      { status: "made", carryPoints: 0, carryMoveId: null },
      { status: "made", carryPoints: 300, carryMoveId: "m1" },
      { status: "made", carryPoints: 100, carryMoveId: "m2" },
      { status: "made", carryPoints: 50, carryMoveId: "m3" },
      { status: "made", carryPoints: 40, carryMoveId: "m4" },
    ];
    const moves = new Map([
      ["m1", { status: "sent", newBalance: 300 }],
      ["m2", { status: "sent", newBalance: 90 }],
      ["m3", { status: "pending", newBalance: null }],
      ["m4", { status: "failed", newBalance: null }],
    ]);
    expect(moveCounts(rows, moves)).toEqual({ links: 6, made: 5, carried: 2, waiting: 1, failed: 1, mismatched: 1 });
  });
});
