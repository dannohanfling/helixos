import { describe, expect, it } from "vitest";
import { SENDING_CUTOFF_MINUTES, UNMAPPED_FAILURE, outcomeOf, outcomesFor, summarize, whenText, type OutcomeRow } from "../channel-outcome";
import { explainPlatformError } from "../ghl-errors";

const now = { wall: "2026-09-15T21:00:00", iso: "2026-09-16T04:00:00.000Z", today: "2026-09-15", tz: "America/Los_Angeles" };
const row = (over: Partial<OutcomeRow>): OutcomeRow => ({ id: "v", channel: "fb_page", groupId: "", status: "scheduled", postAt: null, postedAt: null, externalId: "p1", externalStatus: null, externalError: null, externalSyncedAt: null, createdAt: "2026-09-16T03:59:00.000Z", ...over });

describe("per-channel outcome: the worst state wins, a reason on every failure, no green on hope", () => {
  it("some channels succeed and some fail: the failures render with their reason and the headline counts them, never Posted", () => {
    const rows = [
      row({ id: "a", channel: "fb_page", externalStatus: "published", postedAt: "2026-09-16T04:02:00.000Z" }),
      row({ id: "b", channel: "instagram", externalStatus: "failed", externalError: "GoHighLevel refused the post (422): the text or media didn't pass its checks for this channel. Shorten the text or change the media and try again." }),
      row({ id: "c", channel: "threads", externalStatus: "failed", externalError: "" }),
    ];
    const outcomes = outcomesFor(rows, now);
    expect(outcomes.map((o) => o.state)).toEqual(["published", "failed", "failed"]);
    expect(outcomes[1].reason).toContain("Shorten the text");
    expect(outcomes[2].reason).toBe(UNMAPPED_FAILURE);
    const s = summarize(outcomes);
    expect(s.headline).toBe("1 of 3 published · 2 didn't send");
    expect(s.worst).toBe("failed");
    expect(s.headline).not.toMatch(/Posted/);
  });
  it("a copy-and-paste channel is neither success nor failure, and is not counted against the post", () => {
    const o = outcomeOf(row({ channel: "fb_personal", externalId: null, externalStatus: "manual", externalError: "Facebook doesn't allow posting to personal profiles through any API. Paste it." }), now);
    expect(o.state).toBe("manual");
    expect(o.word).toBe("Copy and paste");
    const s = summarize([o, outcomeOf(row({ externalStatus: "published" }), now)]);
    expect(s.headline).toBe("1 of 1 published · 1 to paste");
    expect(s.worst).toBe("published");
  });
  it("a fixable refusal that was stored as manual is a failure with its reason, not a pasted channel", () => {
    const o = outcomeOf(row({ channel: "instagram", externalId: null, externalStatus: "manual", externalError: "No Instagram business account chosen for this channel in Settings" }), now);
    expect(o.state).toBe("failed");
    expect(o.reason).toContain("chosen for this channel");
  });
  it("an unmapped platform error still produces a client sentence, and the vendor's words never appear in it", () => {
    const raw = "OAuthException: Error validating access token: Session has expired on Monday (#190) {\"trace\":\"abc\"}";
    const sentence = explainPlatformError(raw, "Instagram")!;
    expect(sentence).toBe("Instagram needs reconnecting in GoHighLevel.");
    expect(sentence).not.toMatch(/OAuthException|#190|trace/);
    const other = explainPlatformError("E_WEIRD_9917 unexpected node", "Threads")!;
    expect(other).toBe(UNMAPPED_FAILURE);
    expect(other).not.toMatch(/E_WEIRD|node/);
    expect(explainPlatformError("", "Facebook")).toBeNull();
  });
  it("a row still sending past the cutoff is lost track, not published and not a spinner", () => {
    const late = row({ postAt: "2026-09-15T20:30:00", externalStatus: "scheduled" });
    const o = outcomeOf(late, now);
    expect(o.state).toBe("unknown");
    expect(o.word).toBe("Lost track");
    expect(o.reason).toBe("We lost track of this one. Check Facebook before re-posting.");
    expect(outcomeOf(late, { ...now, wall: "2026-09-15T20:45:00" }).state).toBe("sending");
    expect(SENDING_CUTOFF_MINUTES).toBe(20);
    // A push that never wrote back at all
    expect(outcomeOf(row({ externalId: null, createdAt: "2026-09-16T03:00:00.000Z" }), now).state).toBe("unknown");
    expect(outcomeOf(row({ externalId: null, createdAt: "2026-09-16T03:59:30.000Z" }), now).state).toBe("sending");
  });
  it("an accepted immediate post is sending, not published, until the readback says so", () => {
    expect(outcomeOf(row({ externalStatus: "in_progress", externalSyncedAt: "2026-09-16T03:59:50.000Z" }), now).state).toBe("sending");
    expect(outcomeOf(row({ externalStatus: "published", postedAt: "2026-09-16T04:02:00.000Z" }), now).state).toBe("published");
  });
  it("a scheduled time renders as the member's own wall time, whatever zone the server runs in", () => {
    const o = outcomeOf(row({ postAt: "2026-12-15T10:30:00", externalStatus: "scheduled" }), now);
    expect(o.state).toBe("scheduled");
    expect(o.when).toBe("Dec 15 10:30 AM");
    expect(whenText("2026-09-16T08:00:00", "2026-09-15")).toBe("Tomorrow 8:00 AM");
  });
});
