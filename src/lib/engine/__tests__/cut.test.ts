import { describe, expect, it } from "vitest";
import { cutText, wellFormed } from "@/lib/engine/cut";
import { cleanLine, FORUM_MAX } from "@/lib/engine/forum";
import { parseHandoffPost } from "@/lib/engine/handoff";

// H-593: a cut that lands inside an emoji must never keep half of it (the database refuses a lone surrogate).
const whole = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("cutting text without breaking an emoji (H-593)", () => {
  it("cuts before an emoji the limit would split, and keeps one that fits", () => {
    expect(cutText("ab🏟️", 3)).toBe("ab");
    expect(cutText("ab🏟️", 4)).toBe("ab🏟");
    expect(cutText("abc", 10)).toBe("abc");
    for (let n = 0; n <= 12; n++) expect(whole(cutText("a🔥b🏟️c🏆d", n)), `at ${n}`).toBe(true);
  });

  it("drops a stray half that came in from outside", () => {
    expect(wellFormed("a\uD83Cb")).toBe("ab");
    expect(wellFormed("a\uDFDFb")).toBe("ab");
    expect(wellFormed("🏟️ ok")).toBe("🏟️ ok");
  });

  it("the Forum's flow label: the title that broke H-592 now cuts cleanly", () => {
    const title = "Plan: The Colosseum back in the menu (🏟️), opening on the arena, with Rewards one tap away";
    const label = cleanLine(title, FORUM_MAX.flowLabel)!;
    expect(whole(label)).toBe(true);
    expect(label.length).toBeLessThanOrEqual(FORUM_MAX.flowLabel);
    expect(label.endsWith("…")).toBe(true);
    for (let pad = 0; pad < 6; pad++) expect(whole(cleanLine(`${"x".repeat(30 + pad)}🏟️🏆🔥 tail`, FORUM_MAX.flowLabel)!), `pad ${pad}`).toBe(true);
  });

  it("an inbox post's fields come out whole at every limit", () => {
    const long = (n: number) => `${"y".repeat(n)}🏟️`;
    for (let n = 290; n < 302; n++) {
      const r = parseHandoffPost({ to: "Danno", kind: "status", title: long(n), body: "b" });
      if (r.ok) expect(whole(r.post.title), `title at ${n}`).toBe(true);
    }
  });
});
