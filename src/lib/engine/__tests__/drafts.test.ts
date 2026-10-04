import { describe, expect, it } from "vitest";
import { DRAFT_KEEP_MS, draftExpired, newerDraft, validDraftKey } from "../drafts";

describe("drafts across devices (rev 444)", () => {
  it("takes only the names the app gives its drafts", () => {
    for (const k of ["month.u1.2026-10", "feedback.u1.2026-09", "ooh.u1.new", "week.u1.2026-09-28", "webinar.u1.w1.section-hook", "close.u1.2026-10-04", "body-food.u1.new"]) expect(validDraftKey(k), k).toBe(true);
    for (const k of ["", "month", "../etc", "month.u1.<script>", "x".repeat(200), "Month.u1.2026-10"]) expect(validDraftKey(k), k).toBe(false);
  });
  it("puts back the newer copy, from whichever device", () => {
    const old = { at: 1000, sent: false, tag: "laptop" };
    const fresh = { at: 2000, sent: false, tag: "phone" };
    expect(newerDraft(old, fresh)?.tag).toBe("phone");
    expect(newerDraft(fresh, old)?.tag).toBe("phone");
    expect(newerDraft(null, fresh)?.tag).toBe("phone");
    expect(newerDraft(old, null)?.tag).toBe("laptop");
    expect(newerDraft(null, null)).toBeNull();
  });
  it("lets a draft go after 30 days untouched", () => {
    expect(draftExpired(0, DRAFT_KEEP_MS + 1)).toBe(true);
    expect(draftExpired(0, DRAFT_KEEP_MS - 1)).toBe(false);
  });
});
