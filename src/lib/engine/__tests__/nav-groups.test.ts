import { describe, expect, it } from "vitest";
import { COLOSSEUM_HREF, NAV, NAV_GROUPS, navActive, navVisible, visibleGroups, withColosseum } from "@/components/nav-groups";
import { colosseumHref } from "@/components/colosseum-view";

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
    expect(hrefs("Your content")).toEqual(["/coach/board", "/coach/board-seats", "/coach/glossary", "/coach/horizon", "/coach/helix", "/coach/setup", "/coach/recordings", "/integrations"]);
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

  it("with the Colosseum on, the one item is The Colosseum and opens on the arena; off, it stays Rewards (H-592)", () => {
    const items = (on: boolean) => visibleGroups({ ...client, colosseumOn: on }).flatMap((g) => g.items);
    const on = items(true).filter((n) => n.href === COLOSSEUM_HREF || n.href === "/rewards");
    expect(on).toEqual([expect.objectContaining({ href: COLOSSEUM_HREF, label: "The Colosseum", icon: "🏟️", line: "the arena, points and prizes" })]);
    const off = items(false).filter((n) => n.href === COLOSSEUM_HREF || n.href === "/rewards");
    expect(off).toEqual([expect.objectContaining({ href: "/rewards", label: "Rewards", icon: "🏆" })]);
    // The same place in its group, for coaches and team members too.
    const at = (on2: boolean, m: typeof client | typeof coach) => visibleGroups({ ...m, colosseumOn: on2 }).find((g) => g.items.some((n) => n.href.startsWith("/rewards")))!;
    expect(at(true, coach).items.findIndex((n) => n.href === COLOSSEUM_HREF)).toBe(at(false, coach).items.findIndex((n) => n.href === "/rewards"));
    expect(withColosseum(NAV, false)).toBe(NAV);
    expect(COLOSSEUM_HREF).toBe(colosseumHref());
  });

  it("The Colosseum is lit on both of its tabs, and only the menu goes to the arena (H-592)", () => {
    expect(navActive("/rewards", COLOSSEUM_HREF)).toBe(true);
    expect(navActive("/rewards/book", COLOSSEUM_HREF)).toBe(true);
    expect(navActive("/rewardsx", COLOSSEUM_HREF)).toBe(false);
    expect(navActive("/today", COLOSSEUM_HREF)).toBe(false);
    expect(navActive("/body/foods", "/body")).toBe(true);
  });
});
