import { describe, expect, it } from "vitest";
import { NAV, navVisible } from "@/components/nav-groups";
import { monthShareTarget } from "@/lib/engine/community";

/** The friction walk of 7 Oct (rev 584): what it asked main to confirm, pinned. */
describe("friction walk (7 Oct)", () => {
  it("the Grow items a client must not see are hidden for a client, and the ones for their own business stay", () => {
    const client = { role: "client" as const, passEnabled: false, bodyEnabled: false };
    const labels = (visible: boolean) => NAV.filter((n) => navVisible(n, client) === visible).map((n) => n.label);
    // "Coach" became "Clients" under People (H-164 §7); the client's own Clients page is a different address.
    for (const l of ["OOH requests", "Feedback", "Issues and ideas", "Community posts", "Move to a client", "Import from Airtable", "Integrations", "Community Pass"]) expect(labels(false)).toContain(l);
    expect(NAV.filter((n) => n.href === "/coach").every((n) => !navVisible(n, client))).toBe(true);
    // A member runs their own coaching business inside HelixOS: their clients and their numbers are theirs to see.
    for (const l of ["Clients", "Numbers", "Rewards", "What's new"]) expect(labels(true)).toContain(l);
  });
  it("the Intentions share line carries no date that goes stale (I2)", () => {
    const r = monthShareTarget(null, "2026-10");
    expect("reason" in r && r.reason).not.toMatch(/the 1st/);
  });
});
