import { describe, expect, it } from "vitest";
import { HORIZON_LISTS, HORIZON_SEED, SHIPPED_DAYS, VOTABLE, byList, inArea, parseHorizonForm, shippedMenuKeys, shippedNotice, shippedShows, visibleItems, type HorizonItemLike } from "../horizon";

const base = (o: Partial<HorizonItemLike> & { id: string }): HorizonItemLike => ({ title: "t", line: "l", area: "Daily", status: "next", fromFeedback: false, sort: 0, shippedAt: null, menuKey: null, hidden: false, ...o });
const now = new Date("2026-10-16T12:00:00Z");

describe("On the horizon (H-385): the lists and what members see", () => {
  it("members vote on Next up and Exploring only", () => {
    expect([...VOTABLE].sort()).toEqual(["exploring", "next"]);
    expect(HORIZON_LISTS.map((l) => l.key)).toEqual(["shipped", "building", "next", "exploring"]);
  });
  it("Just shipped keeps an item for 30 days, then it leaves the page; an unstamped shipped item never shows", () => {
    expect(SHIPPED_DAYS).toBe(30);
    expect(shippedShows({ status: "shipped", shippedAt: "2026-10-01T00:00:00Z" }, now)).toBe(true);
    expect(shippedShows({ status: "shipped", shippedAt: "2026-09-16T12:01:00Z" }, now)).toBe(true);
    expect(shippedShows({ status: "shipped", shippedAt: "2026-09-16T11:59:00Z" }, now)).toBe(false);
    expect(shippedShows({ status: "shipped", shippedAt: "2026-09-15T00:00:00Z" }, now)).toBe(false);
    expect(shippedShows({ status: "shipped", shippedAt: null }, now)).toBe(false);
    expect(shippedShows({ status: "building", shippedAt: null }, now)).toBe(true);
  });
  it("visible: not hidden, shipped inside the window, in sort order", () => {
    const items = [base({ id: "b", sort: 20 }), base({ id: "a", sort: 10 }), base({ id: "h", sort: 5, hidden: true }), base({ id: "old", sort: 1, status: "shipped", shippedAt: "2026-01-01T00:00:00Z" })];
    expect(visibleItems(items, now).map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("the area chips: Everywhere shows under every chip, All shows everything", () => {
    expect(inArea({ area: "Grow" }, "All")).toBe(true);
    expect(inArea({ area: "Grow" }, "Grow")).toBe(true);
    expect(inArea({ area: "Grow" }, "Board")).toBe(false);
    expect(inArea({ area: "Everywhere" }, "Board")).toBe(true);
  });
  it("byList buckets the four lists", () => {
    const b = byList([base({ id: "1", status: "shipped" }), base({ id: "2", status: "exploring" }), base({ id: "3" })]);
    expect(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.length]))).toEqual({ shipped: 1, building: 0, next: 1, exploring: 1 });
  });
  it("a menu key is shipped once the item carrying it is in Just shipped, hidden or not", () => {
    expect([...shippedMenuKeys([base({ id: "1", menuKey: "magic-funnel", status: "next" })])]).toEqual([]);
    expect([...shippedMenuKeys([base({ id: "1", menuKey: "magic-funnel", status: "shipped", hidden: true })])]).toEqual(["magic-funnel"]);
  });
  it("the one-time notice: the newest shipped item the member wanted and has not been told about", () => {
    const items = [base({ id: "a", status: "shipped", shippedAt: "2026-10-10T00:00:00Z" }), base({ id: "b", status: "shipped", shippedAt: "2026-10-15T00:00:00Z" }), base({ id: "c", status: "next" })];
    expect(shippedNotice(items, [{ itemId: "a", notifiedAt: null }, { itemId: "b", notifiedAt: null }, { itemId: "c", notifiedAt: null }])?.id).toBe("b");
    expect(shippedNotice(items, [{ itemId: "b", notifiedAt: "2026-10-16T00:00:00Z" }, { itemId: "a", notifiedAt: null }])?.id).toBe("a");
    expect(shippedNotice(items, [{ itemId: "c", notifiedAt: null }])).toBeNull();
    expect(shippedNotice(items, [])).toBeNull();
  });
  it("the coach's form is checked: title and line bounded, area and list from the lists, menu key from the known ones", () => {
    expect(parseHorizonForm({ title: "A thing", line: "One line.", area: "Grow", status: "next", fromFeedback: "on", menuKey: "" })).toEqual({ ok: true, item: { title: "A thing", line: "One line.", area: "Grow", status: "next", fromFeedback: true, menuKey: null } });
    expect(parseHorizonForm({ title: "", line: "x", area: "Grow", status: "next" })).toMatchObject({ ok: false });
    expect(parseHorizonForm({ title: "x".repeat(81), line: "x", area: "Grow", status: "next" })).toMatchObject({ ok: false });
    expect(parseHorizonForm({ title: "x", line: "x", area: "Nowhere", status: "next" })).toMatchObject({ ok: false, error: "Pick an area." });
    expect(parseHorizonForm({ title: "x", line: "x", area: "Grow", status: "done" })).toMatchObject({ ok: false, error: "Pick a list." });
    expect(parseHorizonForm({ title: "x", line: "x", area: "Grow", status: "next", menuKey: "nope" })).toMatchObject({ ok: false });
    expect(parseHorizonForm({ title: "x", line: "x", area: "Grow", status: "next", menuKey: "magic-funnel" })).toMatchObject({ ok: true, item: { menuKey: "magic-funnel" } });
  });
  it("the first list: every seed item is well formed, the shipped ones are stamped, Magic funnel drives the menu entry", () => {
    for (const s of HORIZON_SEED) {
      expect(parseHorizonForm(s)).toMatchObject({ ok: true });
      if (s.status === "shipped") expect(s.shippedAt).toBeTruthy();
      else expect(s.shippedAt).toBeNull();
    }
    expect(HORIZON_SEED.filter((s) => s.menuKey === "magic-funnel").map((s) => s.status)).toEqual(["next"]);
    expect(new Set(HORIZON_SEED.map((s) => s.sort)).size).toBe(HORIZON_SEED.length);
  });
});
