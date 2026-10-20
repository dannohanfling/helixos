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
    expect(hrefs("People")).toEqual(["/coach", "/coach/office-hours", "/hermes/calendars", "/coach/community", "/coach/move", "/coach/import"]);
    // Booking calendars in the menu (H-1236, plan H-1240), and Clients says it is the Coach view.
    expect(NAV.find((n) => n.href === "/hermes/calendars")?.coachOnly).toBe(true);
    expect(NAV.find((n) => n.href === "/coach")?.hint).toBe("the Coach view");
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

  it("the Agent inbox (H-727): right after The Forum in Build, a member's own once they have an agent, never the coach's or a team member's", () => {
    const build = NAV_GROUPS.find((g) => g.label === "Build")!.items.map((i) => i.href);
    expect(build.indexOf("/forum/inbox")).toBe(build.indexOf("/forum") + 1);
    const item = NAV.find((n) => n.href === "/forum/inbox")!;
    expect(item).toMatchObject({ label: "Agent inbox", icon: "📥", line: "your agents' plans for your OK", clientOnly: true, agentsOnly: true });
    expect(navVisible(item, client)).toBe(false);
    expect(navVisible(item, { ...client, agentsOn: true })).toBe(true);
    expect(navVisible(item, { ...coach, agentsOn: true })).toBe(false);
    expect(navVisible(item, { ...client, agentsOn: true, team: true })).toBe(false);
    // The side menu and the More page draw from the same rule.
    expect(visibleGroups({ ...client, agentsOn: true }).flatMap((g) => g.items).some((n) => n.href === "/forum/inbox")).toBe(true);
    expect(visibleGroups(client).flatMap((g) => g.items).some((n) => n.href === "/forum/inbox")).toBe(false);
    // Lit on its own page, and The Forum stays a separate item (the most specific match wins in the menu).
    expect(navActive("/forum/inbox", "/forum/inbox")).toBe(true);
  });
});

describe("Ask your coach in the menu (H-693)", () => {
  const ask = (m: Parameters<typeof visibleGroups>[0]) => visibleGroups(m).flatMap((g) => g.items).find((n) => n.href === "/ask");
  const client = { role: "client" as const, passEnabled: false, bodyEnabled: false };
  it("shows only where the chat is on, in Daily right after Office Hours, named for the coach", () => {
    expect(ask(client)).toBeUndefined();
    expect(ask({ ...client, chatOn: true, coachFirst: "Danno" })?.label).toBe("Ask Danno");
    expect(ask({ ...client, chatOn: true })?.label).toBe("Ask your coach");
    const daily = visibleGroups({ ...client, chatOn: true, oohOn: true }).find((g) => g.label === "Daily")!.items.map((n) => n.href);
    expect(daily.indexOf("/ask")).toBe(daily.indexOf("/office-hours") + 1);
  });
  it("the coach sees what members see; a team member never sees it", () => {
    expect(ask({ role: "coach", passEnabled: false, bodyEnabled: false, chatOn: true })).toMatchObject({ label: "Ask your coach", line: "what members see" });
    expect(ask({ ...client, chatOn: true, team: true })).toBeUndefined();
  });
});
