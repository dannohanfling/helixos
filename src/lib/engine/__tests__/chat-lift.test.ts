import { describe, expect, it } from "vitest";
import { isLauncher, liftPx, staysLifted } from "../chat-lift";

const phone = { width: 390, height: 844 };

describe("lifting the chat bubble on a phone (rev 468)", () => {
  it("finds the small fixed bubble at the bottom, never the opened chat or anything not fixed", () => {
    expect(isLauncher({ top: 768, bottom: 828, width: 60, height: 60 }, phone, true)).toBe(true);
    expect(isLauncher({ top: 640, bottom: 828, width: 300, height: 188 }, phone, true)).toBe(true); // the bubble with its greeting
    expect(isLauncher({ top: 768, bottom: 828, width: 60, height: 60 }, phone, false)).toBe(false);
    expect(isLauncher({ top: 40, bottom: 844, width: 390, height: 804 }, phone, true)).toBe(false); // the chat, opened
    expect(isLauncher({ top: 100, bottom: 160, width: 60, height: 60 }, phone, true)).toBe(false); // fixed, but at the top
    expect(isLauncher({ top: 788, bottom: 844, width: 390, height: 56 }, phone, true)).toBe(false); // a full-width bar
  });
  it("keeps a lifted bubble lifted while it stays small, and lets it go once it opens into the chat", () => {
    expect(staysLifted({ top: 600, bottom: 660, width: 60, height: 60 })).toBe(true);
    expect(staysLifted({ top: 40, bottom: 844, width: 390, height: 804 })).toBe(false);
  });
  it("clears the highest bottom bar by the gap, and lifts nothing when there is no bar", () => {
    expect(liftPx(844, [788])).toBe(68); // the tab bar, 56 px, plus 12
    expect(liftPx(844, [788, 700])).toBe(156); // a sticky row of buttons above the tab bar
    expect(liftPx(844, [120])).toBeNull(); // a bar in the top half is not a bottom bar
    expect(liftPx(844, [])).toBeNull();
  });
});
