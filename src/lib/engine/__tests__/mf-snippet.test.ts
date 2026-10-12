import { describe, expect, it } from "vitest";
import { MF_CLASSES, mfSnippet } from "../mf-snippet";

describe("the GoHighLevel snippet (rev 812 §5, rev 815 §5)", () => {
  const s = mfSnippet("https://helixos.example.com/");
  it("points at this HelixOS and carries nothing personal", () => {
    expect(s).toContain('"https://helixos.example.com/api/mf/"');
    expect(s).not.toMatch(/@[a-z]+\.[a-z]/);
  });
  it("every CSS rule sits under the wrapper class; nothing restyles the member's page", () => {
    const css = s.slice(s.indexOf("<style>") + 7, s.indexOf("</style>"));
    const selectors = css.split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel.startsWith(".hx-mf")).toBe(true);
  });
  it("only a 43-character code, kept for the thank-you page, set in mf_code, the backup signal on submit", () => {
    expect(s).toContain("/^[A-Za-z0-9_-]{43}$/");
    expect(s).toContain("sessionStorage");
    expect(s).toContain('input[name="mf_code"]');
    expect(s).toContain("sendBeacon(API+code+\"/registered\"");
    expect(s).toContain('credentials:"omit"');
  });
  it("names every class a member marks", () => {
    for (const c of ["mf-header", "mf-subheader", "mf-why-you", "mf-urgency", "mf-ticket-title"]) {
      expect(MF_CLASSES.some((x) => x.cls.includes(c))).toBe(true);
      expect(s).toContain(c);
    }
  });
});
