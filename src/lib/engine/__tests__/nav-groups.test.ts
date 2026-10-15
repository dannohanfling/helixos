import { describe, expect, it } from "vitest";
import { NAV, NAV_GROUPS, navVisible } from "@/components/nav-groups";

/** The menu after cleanup slice 1 (H-164 §5 and §7). */
describe("the menu: subtitles and the coach's three groups", () => {
  const client = { role: "client" as const, passEnabled: false, bodyEnabled: false };
  const coach = { role: "coach" as const, passEnabled: false, bodyEnabled: false };
  it("every item that is a name carries a short line under it", () => {
    for (const label of ["Essence", "Doctrine", "Evidence", "Pathway", "Library", "Courses", "Offers", "Numbers", "Intentions", "Tasks", "Content", "DMs", "Webinars", "Images", "Recordings", "My Board", "Rewards"]) {
      const n = NAV.find((x) => x.label === label && !x.coachOnly);
      expect(n?.line, label).toBeTruthy();
    }
    expect(NAV.find((x) => x.label === "Essence")?.line).toBe("who you are and who you serve");
  });
  it("the coach's links sit in People, Agents and Your content; a client sees none of them", () => {
    const hrefs = (g: string) => NAV_GROUPS.find((x) => x.label === g)!.items.map((i) => i.href);
    expect(hrefs("People")).toEqual(["/coach", "/coach/office-hours", "/coach/community", "/coach/move", "/coach/import"]);
    expect(hrefs("Agents")).toEqual(["/coach/inbox", "/coach/agents", "/forum", "/coach/reports", "/coach/feedback"]);
    expect(hrefs("Your content")).toEqual(["/coach/board", "/coach/board-seats", "/coach/glossary", "/coach/helix", "/coach/setup", "/coach/recordings", "/integrations"]);
    for (const g of ["People", "Agents", "Your content"]) for (const i of NAV_GROUPS.find((x) => x.label === g)!.items) expect(navVisible(i, client), i.href).toBe(false);
    // The Forum once for each role: under Agents for the coach, under Build for a client.
    expect(NAV.filter((n) => n.href === "/forum" && navVisible(n, coach))).toHaveLength(1);
    expect(NAV.filter((n) => n.href === "/forum" && navVisible(n, client))).toHaveLength(1);
    // Grow holds no coach link any more.
    expect(NAV_GROUPS.find((x) => x.label === "Grow")!.items.some((i) => i.coachOnly)).toBe(false);
  });
  it("Rewards and the Colosseum are one link (H-164 §4)", () => {
    expect(NAV.some((n) => n.href === "/colosseum")).toBe(false);
    expect(NAV.filter((n) => n.href === "/rewards")).toHaveLength(1);
  });
});
