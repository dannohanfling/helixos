import { describe, expect, it } from "vitest";
import { allCollapsed, isOpen, isTypingIn, navStateOf, RAIL_KEY, toggleAll, toggleGroup } from "../nav-state";

describe("navStateOf", () => {
  it.each([undefined, null, "junk", 12, [], {}, { collapsed: "x" }, { rail: "yes" }])("safely normalizes %j", (raw) => {
    expect(navStateOf(raw)).toEqual({ collapsed: {}, rail: false });
  });
  it("round-trips valid state", () => {
    const state = { collapsed: { Work: true, Learn: true }, rail: true };
    expect(navStateOf(state)).toEqual(state);
  });
  it("keeps only true collapsed entries with labels at most 40 characters", () => {
    expect(navStateOf({ collapsed: { Work: true, Learn: false, Other: "true", Count: 1, ["x".repeat(40)]: true, ["x".repeat(41)]: true }, rail: 1 }))
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
    expect(isOpen(state, "Work", "Learn")).toBe(false);
    expect(isOpen(state, "Learn", null)).toBe(true);
    expect(isOpen(state, "Work", null)).toBe(false);
  });
  it("requires a nonempty list of entirely collapsed labels", () => {
    expect(allCollapsed(state, [])).toBe(false);
    expect(allCollapsed(state, ["Work"])).toBe(true);
    expect(allCollapsed(state, ["Work", "Learn"])).toBe(false);
  });
  it("toggles a group in a new state without mutating either input object", () => {
    const expanded = toggleGroup(state, "Work");
    const collapsed = toggleGroup(state, "Learn");
    expect(expanded).toEqual({ collapsed: {}, rail: true });
    expect(collapsed).toEqual({ collapsed: { Work: true, Learn: true }, rail: true });
    for (const result of [expanded, collapsed]) {
      expect(result).not.toBe(state);
      expect(result.collapsed).not.toBe(state.collapsed);
    }
    expect(state).toEqual({ collapsed: { Work: true }, rail: true });
  });
  it("collapses exactly the named groups and expands all once they are collapsed", () => {
    const collapsed = toggleAll(state, ["Learn", "Play"]);
    expect(collapsed).toEqual({ collapsed: { Learn: true, Play: true }, rail: true });
    Object.freeze(collapsed.collapsed);
    Object.freeze(collapsed);
    const expanded = toggleAll(collapsed, ["Learn", "Play"]);
    expect(expanded).toEqual({ collapsed: {}, rail: true });
    expect(collapsed.collapsed).toEqual({ Learn: true, Play: true });
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
