import { describe, expect, it } from "vitest";
import { allCollapsed, EMPTY_NAV, isOpen, isTypingIn, navStateOf, NONE_CLOSED, RAIL_KEY, toggleAll, toggleGroup } from "../nav-state";

describe("navStateOf", () => {
  it.each([undefined, null, "junk", 12, [], {}, { collapsed: "x" }, { rail: "yes" }])("safely normalizes %j", (raw) => {
    expect(navStateOf(raw)).toEqual({ collapsed: {}, rail: false });
  });
  it("round-trips valid state", () => {
    const state = { collapsed: { Work: true, Extra: true }, rail: true };
    expect(navStateOf(state)).toEqual(state);
  });
  it("keeps only true collapsed entries with labels at most 40 characters", () => {
    expect(navStateOf({ collapsed: { Work: true, Extra: false, Other: "true", Count: 1, ["x".repeat(40)]: true, ["x".repeat(41)]: true }, rail: 1 }))
      .toEqual({ collapsed: { Work: true, ["x".repeat(40)]: true }, rail: false });
  });
  it("accepts partial objects", () => {
    expect(navStateOf({ rail: true })).toEqual({ collapsed: {}, rail: true });
    expect(navStateOf({ collapsed: { Work: true } })).toEqual({ collapsed: { Work: true }, rail: false });
  });
});

describe("menu groups", () => {
  const state = Object.freeze({ collapsed: Object.freeze({ Work: true }), rail: true });
  it("always opens the current group", () => {
    expect(isOpen(state, "Work", "Work")).toBe(true);
    expect(isOpen(state, "Work", "Extra")).toBe(false);
    expect(isOpen(state, "Extra", null)).toBe(true);
    expect(isOpen(state, "Work", null)).toBe(false);
  });
  it("requires a nonempty list of entirely collapsed labels", () => {
    expect(allCollapsed(state, [])).toBe(false);
    expect(allCollapsed(state, ["Work"])).toBe(true);
    expect(allCollapsed(state, ["Work", "Extra"])).toBe(false);
  });
  it("toggles a group in a new state without mutating either input object", () => {
    const expanded = toggleGroup(state, "Work");
    const collapsed = toggleGroup(state, "Extra");
    expect(expanded).toEqual({ collapsed: {}, rail: true });
    expect(collapsed).toEqual({ collapsed: { Work: true, Extra: true }, rail: true });
    for (const result of [expanded, collapsed]) {
      expect(result).not.toBe(state);
      expect(result.collapsed).not.toBe(state.collapsed);
    }
    expect(state).toEqual({ collapsed: { Work: true }, rail: true });
  });
  it("collapses exactly the named groups and expands all once they are collapsed", () => {
    const collapsed = toggleAll(state, ["Extra", "Play"]);
    expect(collapsed).toEqual({ collapsed: { Extra: true, Play: true }, rail: true });
    Object.freeze(collapsed.collapsed);
    Object.freeze(collapsed);
    const expanded = toggleAll(collapsed, ["Extra", "Play"]);
    expect(expanded).toEqual({ collapsed: {}, rail: true });
    expect(collapsed.collapsed).toEqual({ Extra: true, Play: true });
    expect(state.collapsed).toEqual({ Work: true });
    expect(collapsed).not.toBe(state);
    expect(expanded).not.toBe(collapsed);
    expect(expanded.collapsed).not.toBe(collapsed.collapsed);
  });
  it("returns a fresh empty collapsed map for an empty label list", () => {
    const result = toggleAll(state, []);
    expect(result).toEqual({ collapsed: {}, rail: true });
    expect(result).not.toBe(state);
    expect(result.collapsed).not.toBe(state.collapsed);
  });
});

describe("rail shortcut", () => {
  it("uses the opening bracket", () => expect(RAIL_KEY).toBe("["));
  it.each(["INPUT", "TEXTAREA", "SELECT"])("recognizes %s", (tagName) => {
    expect(isTypingIn({ tagName } as Element)).toBe(true);
  });
  it("recognizes editable elements", () => {
    expect(isTypingIn({ tagName: "DIV", isContentEditable: true } as unknown as Element)).toBe(true);
  });
  it("ignores null and ordinary elements", () => {
    expect(isTypingIn(null)).toBe(false);
    expect(isTypingIn({ tagName: "DIV" } as Element)).toBe(false);
    expect(isTypingIn({ tagName: "BUTTON", isContentEditable: false } as unknown as Element)).toBe(false);
  });
});

describe("groups that start shut (H-164 §10)", () => {
  const fresh = { collapsed: {}, rail: false };
  it("My business, Get leads, My bot and Learn start shut; Daily and the rest start open", () => {
    for (const g of ["My business", "Get leads", "My bot", "Learn"]) expect(isOpen(fresh, g, null)).toBe(false);
    for (const g of ["Daily", "HumanOS", "Socrates Domain", "Platforms"]) expect(isOpen(fresh, g, null)).toBe(true);
    expect(isOpen(fresh, "Learn", "Learn")).toBe(true);
  });
  it("remembers a shut group the member opened, and forgets it once it's back at its default", () => {
    const opened = toggleGroup(fresh, "Learn");
    expect(opened.collapsed).toEqual({ Learn: false });
    expect(isOpen(opened, "Learn", null)).toBe(true);
    expect(navStateOf(opened)).toEqual(opened);
    expect(toggleGroup(opened, "Learn").collapsed).toEqual({});
  });
  it("Expand all opens the shut ones too", () => {
    const all = ["Daily", "Learn"];
    const shut = toggleAll(fresh, all);
    expect(allCollapsed(shut, all)).toBe(true);
    const open = toggleAll(shut, all);
    expect(all.every((g) => isOpen(open, g, null))).toBe(true);
  });

  it("a coach's or a team member's menu starts with every group open, and a shut one stays shut by the stored true (H-164 §10)", () => {
    expect(isOpen(EMPTY_NAV, "Get leads", null, NONE_CLOSED)).toBe(true);
    expect(isOpen(EMPTY_NAV, "Get leads", null)).toBe(false);
    const shut = toggleGroup(EMPTY_NAV, "Get leads", NONE_CLOSED);
    expect(shut.collapsed).toEqual({ "Get leads": true });
    expect(isOpen(shut, "Get leads", null, NONE_CLOSED)).toBe(false);
    expect(toggleGroup(shut, "Get leads", NONE_CLOSED).collapsed).toEqual({});
    expect(allCollapsed(EMPTY_NAV, ["Get leads", "Learn"], NONE_CLOSED)).toBe(false);
    expect(toggleAll(EMPTY_NAV, ["Get leads", "Learn"], NONE_CLOSED).collapsed).toEqual({ "Get leads": true, Learn: true });
  });
});
