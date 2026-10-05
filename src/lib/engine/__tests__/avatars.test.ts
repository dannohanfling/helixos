import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AVATAR_FIELDS } from "@/db/schema";
import { avatarBrief, avatarForDraft, avatarTree, avatarsOf, coachLine, copyName, fitFromAvatar, importName, importPlan, offersOf, parentProblem, type AvatarRow } from "@/lib/engine/avatars";
import { isToolName } from "@/lib/engine/mcp";
import { allTools } from "@/lib/mcp/registry";
import { MEMBER_TABLES } from "@/lib/member-data";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const blank = Object.fromEntries(AVATAR_FIELDS.map((f) => [f, null])) as Record<(typeof AVATAR_FIELDS)[number], null>;
const av = (id: string, over: Partial<AvatarRow> = {}): AvatarRow => ({ id, parentId: null, name: id, oneLine: null, primary: false, imported: false, archivedAt: null, createdAt: `2026-10-0${id.length} 00:00:00`, ...blank, ...over });

describe("avatars (rev 501, built by Body at rev 508)", () => {
  it("an imported avatar is named after the free text's first words, cut at a word, with no trailing punctuation", () => {
    expect(importName("Busy moms of school-age kids who've tried every diet and quit by week three.")).toBe("Busy moms of school-age kids who've");
    expect(importName("coaches, two years in. Fully booked.")).toBe("Coaches, two years in");
    expect(importName("   ")).toBe("Imported avatar");
  });

  it("the import makes one avatar per distinct text, ignoring case and spacing, linked to each offer that had it; never twice", () => {
    const offers = [
      { id: "o1", name: "Core", avatar: "Busy  moms who quit by week three" },
      { id: "o2", name: "Luxe", avatar: "busy moms who quit by week three" },
      { id: "o3", name: "Free", avatar: "" },
      { id: "o4", name: "Group", avatar: "New coaches" },
    ];
    const plan = importPlan(offers, false);
    expect(plan.map((p) => [p.name, p.offerIds])).toEqual([
      ["Busy moms who quit by week three", ["o1", "o2"]],
      ["New coaches", ["o4"]],
    ]);
    expect(plan[0].who).toBe("Busy  moms who quit by week three");
    expect(importPlan(offers, true)).toEqual([]);
  });

  it("cards: top-level avatars with the Primary first, sub-segments nested, archived ones out, an orphan stands alone", () => {
    const rows = [av("a"), av("bb", { primary: true }), av("ccc", { parentId: "a" }), av("dddd", { parentId: "gone" }), av("eeeee", { archivedAt: "2026-10-05" }), av("ffffff", { parentId: "eeeee" })];
    const t = avatarTree(rows);
    expect(t.map((n) => [n.avatar.id, n.children.map((c) => c.id)])).toEqual([
      ["bb", []],
      ["a", ["ccc"]],
      ["dddd", []],
      ["ffffff", []],
    ]);
  });

  it("sub-segments go one level deep, never under themselves", () => {
    const rows = [av("a"), av("b", { parentId: "a" }), av("c")];
    expect(parentProblem(rows, "c", "a")).toBeNull();
    expect(parentProblem(rows, "c", "c")).toMatch(/itself/);
    expect(parentProblem(rows, "c", "b")).toMatch(/sub-segment already/);
    expect(parentProblem(rows, "a", "c")).toMatch(/sub-segments of its own/);
    expect(parentProblem(rows, null, "zz")).toMatch(/isn't there/);
    expect(parentProblem(rows, "c", null)).toBeNull();
  });

  it("a copy's name never repeats one that's there", () => {
    expect(copyName("Coach", ["Coach"])).toBe("Coach (copy)");
    expect(copyName("Coach (copy)", ["Coach", "Coach (copy)"])).toBe("Coach (copy 2)");
  });

  it("links both ways, main first; a draft writes to the offer's main, else its only one, else the Primary", () => {
    const rows = [av("a"), av("b", { primary: true }), av("c"), av("x", { archivedAt: "2026-10-01" })];
    const links = [
      { avatarId: "a", offerId: "o1", main: false },
      { avatarId: "c", offerId: "o1", main: true },
      { avatarId: "a", offerId: "o2", main: false },
      { avatarId: "x", offerId: "o3", main: true },
    ];
    const offers = [{ id: "o1", name: "Core" }, { id: "o2", name: "Luxe" }, { id: "o3", name: "Old" }];
    expect(avatarsOf("o1", links, rows).map((a) => [a.id, a.main])).toEqual([["c", true], ["a", false]]);
    expect(offersOf("a", links, offers).map((o) => o.name)).toEqual(["Core", "Luxe"]);
    expect(avatarForDraft(rows, links, "o1")?.id).toBe("c");
    expect(avatarForDraft(rows, links, "o2")?.id).toBe("a");
    expect(avatarForDraft(rows, links, "o3")?.id).toBe("b");
    expect(avatarForDraft(rows, links, null)?.id).toBe("b");
    expect(avatarForDraft([av("a")], [], "o1")).toBeNull();
    expect(coachLine(rows, links)).toBe("3 avatars · 2 offers linked");
    expect(coachLine([av("a")], [])).toBe("1 avatar · 0 offers linked");
  });

  it("a drafter reads only the filled fields, in the member's words, under a rule that nothing is added; a bare name is nothing", () => {
    expect(avatarBrief(av("Coach"))).toBe("");
    expect(avatarBrief(null)).toBe("");
    const b = avatarBrief(av("a", { name: "The booked-out coach", pains: "No time\n- Turning people away", phrases: "I'm drowning" }), av("p", { name: "Coaches" }));
    expect(b).toMatch(/^WHO IT'S FOR: the member's own buyer avatar "The booked-out coach", a sub-segment of "Coaches"\. Use only what is written here/);
    expect(b).toMatch(/never invent a pain, a number, a quote or a result/);
    expect(b).toContain("Top pains or problems:\n- No time\n- Turning people away");
    expect(b).toContain("The words they use: I'm drowning");
    expect(b).not.toMatch(/Objections|Not for/);
  });

  it("the webinar's \"Who it is for\" off an avatar: who they are (else its one line), and not for", () => {
    expect(fitFromAvatar(av("a", { who: " Coaches  two years in ", notFor: "Beginners" }))).toEqual({ forYouIf: "Coaches two years in", notForYouIf: "Beginners" });
    expect(fitFromAvatar(av("a", { oneLine: "Busy moms" }))).toEqual({ forYouIf: "Busy moms", notForYouIf: null });
    expect(fitFromAvatar(null)).toEqual({ forYouIf: null, notForYouIf: null });
  });

  it("the offer's own fit lines win; the avatar fills only what's empty", () => {
    const src = read("src/lib/engine/webinar-context.ts");
    expect(src).toMatch(/forYouIf: offer\?\.forYouIf \?\? input\.avatarFit\?\.forYouIf \?\? null/);
    expect(read("src/lib/queries/webinar.ts").match(/avatarFit: await avatarFitFor\(w, offer\?\.id\)/g)).toHaveLength(2);
  });

  it("both tables are the member's: in their export and erase, and every read and write is scoped to workspace and user", () => {
    expect(Object.keys(MEMBER_TABLES)).toEqual(expect.arrayContaining(["avatars", "avatar_offers"]));
    const lib = read("src/lib/avatars.ts");
    expect(lib).toMatch(/const mine = \(m: Member\) => and\(eq\(schema\.avatars\.workspaceId, m\.workspaceId\), eq\(schema\.avatars\.userId, m\.userId\)\)/);
    // Every query of the two tables goes through the member's scope.
    for (const q of lib.match(/db\.query\.(avatars|avatarOffers)\.find\w+\(\{ where: [^,]+/g) ?? []) expect(q, q).toMatch(/where: (and\()?(mine|myLinks)\(m\)/);
    for (const w of lib.match(/\.where\([^)]*\)/g) ?? []) expect(w, w).toMatch(/mine\(m\)|myLinks\(m\)|pair/);
    // The actions pass only the two ids on, never the viewer.
    const actions = read("src/lib/actions/avatars.ts");
    expect(actions.match(/const \{ workspaceId, userId \} = await ctx\(\);\n  const m = \{ workspaceId, userId \};/g)).toHaveLength(6);
    expect(actions).not.toMatch(/\{ v, |\.\.\.v\b/);
  });

  it("four connector tools on the Offers scope: one read, three writes, none deleting", async () => {
    await import("@/lib/mcp/tools/index");
    const mine = allTools().filter((t) => ["avatars_list", "avatar_add", "avatar_update", "offer_link_avatar"].includes(t.name));
    expect(mine.map((t) => [t.name, t.scope, t.kind]).sort()).toEqual([
      ["avatar_add", "offers", "write"],
      ["avatar_update", "offers", "write"],
      ["avatars_list", "offers", "read"],
      ["offer_link_avatar", "offers", "write"],
    ]);
    for (const t of mine) {
      expect(isToolName(t.name), t.name).toBe(true);
      expect(t.description.length, t.name).toBeGreaterThan(60);
    }
    const tools = read("src/lib/mcp/tools/avatars.ts");
    expect(tools).not.toMatch(/from "@\/db"|\.insert\(|\.update\(|\.delete\(|archiveAvatar|importFromOffers/);
  });
});
