import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATE, renderEmailHtml, renderEmailText } from "../email-template";
import { comebackCopy, eveningCopy, morningCopy, numberWords } from "../reminder-copy";
import { readFileSync } from "node:fs";

const base = { actionUrl: "https://app.test/today", settingsUrl: "https://app.test/settings", logoUrl: "https://app.test/email/logo-120.png" };

describe("the email template", () => {
  it("is embedded verbatim from the file that shipped with the brief", () => {
    expect(EMAIL_TEMPLATE).toBe(readFileSync(new URL("../../../data/email/template.html", import.meta.url), "utf8"));
    const html = renderEmailHtml({ ...base, preheader: "p", greeting: "g", stateLine: null, asks: ["A"], buttonLabel: "b", pointsLine: "" });
    expect(html).not.toMatch(/<style|class=|<!--/);
  });
  it("fills every slot, escapes values, keeps the fallback styles on the logo, and the URL is the href only", () => {
    const html = renderEmailHtml({ ...base, preheader: "P & Q", greeting: "Morning, <Maya>.", stateLine: "Four days straight.", asks: ["A", "B", "C"], buttonLabel: "Lock in my day", pointsLine: "+10" });
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain("P &amp; Q");
    expect(html).toContain("Morning, &lt;Maya&gt;.");
    expect(html).toContain('<a href="https://app.test/today"');
    expect(html.match(/https:\/\/app\.test\/today/g)).toHaveLength(1);
    expect(html).toContain('alt="Evolve Omega" style="display:block;width:60px;height:60px;border:0;outline:none;text-decoration:none;font-family');
    expect(html).toContain('bgcolor="#ffffff"');
  });
  it("removes the whole state row when there is no state line, never an empty box", () => {
    const html = renderEmailHtml({ ...base, preheader: "p", greeting: "g", stateLine: null, asks: ["A"], buttonLabel: "b", pointsLine: "" });
    expect(html).not.toContain("border-left:3px solid #E49C24");
    expect(html).not.toContain("{{STATE_LINE}}");
    expect(html).toContain('<div style="margin:0 0 6px 0;">A</div>');
    expect(html).not.toContain('<div style="margin:0 0 6px 0;"></div>');
  });
  it("the text part puts the URL on its own line and keeps every word", () => {
    const text = renderEmailText({ greeting: "Morning, Maya.", stateLine: "Four days straight.", asks: ["Pick your top three.", "Set your energy."], actionUrl: "https://app.test/today", pointsLine: "+10 points when you do.", footerText: "Reminders come at 8am and 5pm. Change them in Settings." });
    expect(text.split("\n")).toContain("https://app.test/today");
    expect(text).toBe("Morning, Maya.\n\nFour days straight.\n\nPick your top three.\nSet your energy.\n\nhttps://app.test/today\n\n+10 points when you do.\n\nReminders come at 8am and 5pm. Change them in Settings.");
  });
});

describe("the morning email, by state, verbatim", () => {
  const sage = { name: "Sage", minPoints: 500 };
  it("streak running", () => {
    const c = morningCopy({ first: "Danno", streak: 4, brokenYesterday: false, points: 460, nextTier: sage });
    expect(c.subject).toBe("Danno — day 4");
    expect(c.stateLine).toBe("Four days straight. Don't break it today.");
    expect(c.preheader).toBe("Three things. Sixty seconds. Then you're free.");
    expect(c.greeting).toBe("Morning, Danno.");
    expect(c.asks).toEqual(["Pick your top three.", "Set your energy.", "That's it. Sixty seconds."]);
    expect(c.buttonLabel).toBe("Lock in my day");
    expect(c.pointsLine).toBe("+10 points when you do.");
    expect(morningCopy({ first: "Danno", streak: 1, brokenYesterday: false, points: 0, nextTier: null }).stateLine).toBe("One day straight. Don't break it today.");
  });
  it("streak broken yesterday does not shame", () => {
    const c = morningCopy({ first: "Danno", streak: 0, brokenYesterday: true, points: 460, nextTier: sage });
    expect(c.subject).toBe("Danno, start again today");
    expect(c.stateLine).toBe("You missed yesterday. That's fine. Start again.");
  });
  it("within fifty points of the next rank", () => {
    const c = morningCopy({ first: "Danno", streak: 0, brokenYesterday: false, points: 460, nextTier: sage });
    expect(c.subject).toBe("Danno — 40 points to Sage");
    expect(c.stateLine).toBe("460 points. Forty more and you're Sage.");
    expect(morningCopy({ first: "Danno", streak: 0, brokenYesterday: false, points: 310, nextTier: sage }).stateLine).toBeNull();
  });
  it("none of the above: no state line, never padding", () => {
    const c = morningCopy({ first: "Danno", streak: 0, brokenYesterday: false, points: 10, nextTier: { name: "Philosopher", minPoints: 100 } });
    expect(c.subject).toBe("Danno, lock in your day");
    expect(c.stateLine).toBeNull();
  });
  it("the states take precedence in the brief's order", () => {
    expect(morningCopy({ first: "Danno", streak: 4, brokenYesterday: false, points: 460, nextTier: sage }).subject).toBe("Danno — day 4");
    expect(morningCopy({ first: "Danno", streak: 0, brokenYesterday: true, points: 460, nextTier: sage }).subject).toBe("Danno, start again today");
  });
});

describe("the evening and comeback emails", () => {
  it("evening leads with the day, points under the button", () => {
    const c = eveningCopy({ first: "Danno", streak: 4, bonus: 10 });
    expect(c.subject).toBe("Danno — close out day 4");
    expect(c.preheader).toBe("Numbers in, one win named. Ninety seconds.");
    expect(c.stateLine).toBe("Day 4 of your streak. Close it and it holds.");
    expect(c.asks).toEqual(["Log your numbers.", "Name the win.", "Ninety seconds."]);
    expect(c.buttonLabel).toBe("Close my day");
    expect(c.pointsLine).toBe("+20 points. +10 more for the streak.");
    const none = eveningCopy({ first: "Danno", streak: 0, bonus: 0 });
    expect(none.subject).toBe("Danno, close the day");
    expect(none.stateLine).toBeNull();
    expect(none.pointsLine).toBe("+20 points.");
  });
  it("comeback keeps its existing words", () => {
    const c = comebackCopy("Danno", true);
    expect(c.subject).toBe("Danno, Mondays are restart day");
    expect([c.greeting, ...c.asks].join(" ")).toBe("Happens. The system doesn't punish pauses, it just resets the streak. Day 1 is 10 points. By Friday it's 310.");
  });
  it("small counts as words", () => {
    expect([numberWords(1), numberWords(4), numberWords(40), numberWords(42), numberWords(100)]).toEqual(["one", "four", "forty", "forty-two", "100"]);
  });
});
