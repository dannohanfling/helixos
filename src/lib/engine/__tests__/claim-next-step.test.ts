import { describe, expect, it } from "vitest";
import { COACH_DELIVERS, WAITING_ON_COACH, claimToast, isAccessReward, overdueNoLinkClaims, waitingLine } from "@/lib/engine/claim-next-step";

describe("claimToast", () => {
  it("names the booking link only when there is one", () => {
    expect(claimToast(500, true)).toBe("Claimed. 500 points spent. Your booking link is ready.");
    expect(claimToast(0, true)).toBe("Claimed. Your booking link is ready.");
  });
  it("says the coach acts next when there is no link", () => {
    expect(claimToast(0, false)).toBe("Claimed. Your coach delivers this one and it shows Done here.");
    expect(claimToast(1500, false)).not.toContain("booking link");
  });
});

describe("waiting words", () => {
  it("knows the two access rewards", () => {
    expect(isAccessReward("30 Days Access to Evolve Omega Academy")).toBe(true);
    expect(isAccessReward("30 Days Access to Evolve Omega Elite")).toBe(true);
    expect(isAccessReward("Limited Edition Evolve Omega Swag Box")).toBe(false);
  });
  it("says who acts and where it shows", () => {
    expect(WAITING_ON_COACH).toBe("Waiting on your coach");
    expect(waitingLine("30 Days Access to Evolve Omega Academy")).toContain("opens your 30 days");
    expect(waitingLine("Limited Edition Evolve Omega Swag Box")).toContain("delivers this by hand");
    expect(COACH_DELIVERS).toBe("you deliver this by hand");
  });
});

describe("overdueNoLinkClaims", () => {
  const now = new Date("2026-10-21T20:00:00Z");
  const link = (n: string) => (n === "VIP Laser Coaching Call" ? "https://example.com/book" : "");
  it("counts open no-link claims older than a day, in either stored format", () => {
    const claims = [
      { rewardName: "30 Days Access to Evolve Omega Academy", createdAt: "2026-10-20 10:00:00" },
      { rewardName: "Limited Edition Evolve Omega Swag Box", createdAt: "2026-10-19T08:00:00Z" },
      { rewardName: "30 Days Access to Evolve Omega Elite", createdAt: "2026-10-21 08:00:00" },
      { rewardName: "VIP Laser Coaching Call", createdAt: "2026-10-01 08:00:00" },
    ];
    expect(overdueNoLinkClaims(claims, link, now)).toBe(2);
  });
  it("is zero with nothing waiting", () => {
    expect(overdueNoLinkClaims([], link, now)).toBe(0);
  });
});
