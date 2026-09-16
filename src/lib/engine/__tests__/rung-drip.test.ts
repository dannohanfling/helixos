import { describe, expect, it } from "vitest";
import { HANDED_NOTE, HANDOFF_WORDS, PUBLISH_WORDS, THREADS_EXCLUSIVE, dripLock, dripPayload, estimateDripEnd, handoffReasons, joinRungs, scheduleAtProblem, splitRungs, threadsRefusal } from "../rung-drip";
import { handoffOutcome, outcomesFor, summarize, OUTCOME_WORD } from "../channel-outcome";
import { matchPlannerPost, needsCheck, orderForCheck } from "../planner-match";
import { normaliseTargets } from "../compose";
import { redactSecrets } from "../redact";

const rungs = ["1\\. Mistake one.\n\nSecond line of it.", "2. Mistake two.", "3. Mistake three."];
const now = { wall: "2026-09-15T13:00:00", iso: "2026-09-15T20:00:00.000Z", today: "2026-09-15", tz: "America/Los_Angeles" };

describe("handing a ladder to the Rung Dripper", () => {
  it("when HelixOS published Facebook and Instagram, rungs start at rung 1 and first_comment is rung 1 for the Threads post; when Community Loyalty publishes them, rungs start at rung 2", () => {
    const ours = dripPayload({ userNs: "f52594u50757435", post: "Raw post.", rungs, fbIgPublisher: "helixos" });
    expect(ours.first_comment).toBe(rungs[0]);
    expect(splitRungs(ours.rungs)).toHaveLength(3);
    expect(ours.schedule_at).toBe("");
    const theirs = dripPayload({ userNs: "f52594u50757435", post: "Raw post.", rungs, fbIgPublisher: "community_loyalty" });
    expect(theirs.first_comment).toBe(rungs[0]);
    expect(splitRungs(theirs.rungs)).toEqual(["Mistake two.", "Mistake three."]);
    expect(theirs.rungs).not.toContain("Mistake one");
  });
  it("rungs are joined on a --- line and round-trip through the flow's own splitter, blank lines inside a rung intact, numbering stripped", () => {
    const joined = joinRungs(rungs);
    expect(joined).toContain("\n\n---\n\n");
    expect(splitRungs(joined)).toEqual(["Mistake one.\n\nSecond line of it.", "Mistake two.", "Mistake three."]);
  });
  it("a Threads time under fifteen minutes out is refused with the reason; blank means now", () => {
    expect(scheduleAtProblem("", now.iso)).toBeNull();
    expect(scheduleAtProblem("2026-09-15T20:10:00.000Z", now.iso)).toMatch(/at least 15 minutes/);
    expect(scheduleAtProblem("2026-09-15T20:16:00.000Z", now.iso)).toBeNull();
    expect(scheduleAtProblem("not a time", now.iso)).toMatch(/couldn't be read/);
  });
  it("a second drip for the same coach while one is running is refused, with when it frees", () => {
    const until = estimateDripEnd(now.iso, 3);
    expect(dripLock([{ expiresAt: until }], now.iso)).toEqual({ active: true, until });
    expect(dripLock([{ expiresAt: "2026-09-15T19:00:00.000Z" }], now.iso)).toEqual({ active: false });
    expect(handoffReasons({ webhook: true, userNs: true, ladder: true, rungs: 3, blockers: 0, fbPublished: true, igPublished: true, lockedUntil: "1:30 PM" })).toEqual(["A ladder is already dripping until about 1:30 PM. One at a time: two would tangle."]);
    expect(handoffReasons({ webhook: true, userNs: true, ladder: true, rungs: 3, blockers: 0, fbPublished: true, igPublished: true, lockedUntil: null })).toEqual([]);
  });
  it("channel ownership is exclusive: Threads ticked with the handoff on is refused, and says why; off, or a Threads group, is not", () => {
    expect(threadsRefusal([{ channel: "fb_page" }, { channel: "threads" }], true)).toBe(THREADS_EXCLUSIVE);
    expect(threadsRefusal([{ channel: "fb_page" }, { channel: "threads" }], false)).toBeNull();
    expect(threadsRefusal([{ channel: "fb_page" }, { channel: "instagram" }], true)).toBeNull();
    expect(threadsRefusal([{ channel: "threads", groupId: "g1" }], true)).toBeNull();
    // A group id that is not the member's own is a plain channel post, and the refusal sees it as one.
    expect(threadsRefusal(normaliseTargets([{ channel: "threads", groupId: "not-mine" }], ["g1"]), true)).toBe(THREADS_EXCLUSIVE);
    expect(threadsRefusal(normaliseTargets([{ channel: "threads", groupId: "g1" }], ["g1"]), true)).toBeNull();
  });
  it("a Threads version already with the planner holds the handoff, with the reason", () => {
    expect(handoffReasons({ webhook: true, userNs: true, ladder: true, rungs: 3, blockers: 0, fbPublished: true, igPublished: true, lockedUntil: null, threadsWithPlanner: true })).toEqual(["A Threads version of this is already with the Social Planner. Remove it there first; Community Loyalty handles Threads with the ladder."]);
  });
  it("the handoff row never says posted: its two words and its note carry no publish word, and the headline keeps it out of the publish count", () => {
    const everyReason = handoffReasons({ webhook: false, webhookHttps: false, userNs: false, ladder: true, rungs: 0, blockers: 2, fbPublished: false, igPublished: false, lockedUntil: "1:30 PM", threadsWithPlanner: true });
    const times = [scheduleAtProblem("x", now.iso)!, scheduleAtProblem("2026-09-15T20:01:00.000Z", now.iso)!];
    for (const text of [HANDOFF_WORDS.handed, HANDOFF_WORDS.unhanded, HANDED_NOTE, THREADS_EXCLUSIVE, ...everyReason, ...times]) for (const w of PUBLISH_WORDS) expect(text.toLowerCase(), `${text} / ${w}`).not.toMatch(new RegExp(`\\b${w}\\b`));
    expect(OUTCOME_WORD.handed).toBe(HANDOFF_WORDS.handed);
    const handed = handoffOutcome({ handedAt: "2026-09-15T19:56:34.000Z" }, null, now)!;
    expect(handed.state).toBe("handed");
    expect(handed.when).toContain("12:56");
    const s = summarize(outcomesFor([], now, [handed]));
    expect(s.total).toBe(0);
    expect(s.headline).toBe("comments handed to Community Loyalty");
    const not = handoffOutcome(null, ["Facebook page and Instagram have to be confirmed by GoHighLevel first: the rungs land on the newest one on each."], now)!;
    expect(not.state).toBe("unhanded");
    expect(not.reason).toContain("confirmed by GoHighLevel first");
    expect(handoffOutcome(null, null, now)).toBeNull();
  });
  it("the webhook URL is a credential: anything shaped like it is redacted from a note", () => {
    expect(redactSecrets("posted to https://communityloyalty.io/api/iwh/305612b47015e53ed1f2127ab9827f35 and failed")).toBe("posted to https://communityloyalty.io/api/iwh/[redacted] and failed");
  });
});

describe("a 2xx with no id: accepted, then reconciled from the planner's own list", () => {
  it("the row reads accepted with the id pending, never didn't send and never published", () => {
    const [o] = outcomesFor([{ id: "v", channel: "fb_page", groupId: "", status: "posted", postAt: null, postedAt: null, externalId: null, externalStatus: "accepted", externalError: null, externalSyncedAt: now.iso, createdAt: now.iso }], now);
    expect(o.state).toBe("sending");
    expect(o.word).toBe("Accepted, id pending");
    expect(o.canCheck).toBe(true);
  });
  it("the planner's list gives the id back: newest post on the same account whose text starts the same, since the request", () => {
    const posts = [
      { id: "old", summary: "Twelve minutes on Tuesday. Beats three hours on Sunday.", accountIds: ["acc_fb"], createdAt: "2026-09-14T10:00:00.000Z", status: "published" },
      { id: "other", summary: "Twelve minutes on Tuesday. Beats three hours on Sunday.", accountIds: ["acc_ig"], createdAt: "2026-09-15T19:52:20.000Z", status: "published" },
      { id: "mine", summary: "Twelve minutes on Tuesday.\nBeats three hours on Sunday.", accountIds: ["acc_fb"], createdAt: "2026-09-15T19:52:20.000Z", publishedAt: "2026-09-15T19:52:40.000Z", status: "published" },
    ];
    expect(matchPlannerPost(posts, { accountId: "acc_fb", summary: "Twelve minutes on Tuesday.\n\nBeats three hours on Sunday.", sinceIso: "2026-09-15T19:52:14.000Z" })?.id).toBe("mine");
    expect(matchPlannerPost(posts, { accountId: "acc_li", summary: "Twelve minutes", sinceIso: "2026-09-15T19:52:14.000Z" })).toBeNull();
    expect(matchPlannerPost([{ id: "nostamp", summary: "Twelve minutes on Tuesday.", accountIds: ["acc_fb"] }], { accountId: "acc_fb", summary: "Twelve minutes on Tuesday.", sinceIso: now.iso })?.id).toBe("nostamp");
    expect(matchPlannerPost(posts, { accountId: "acc_fb", summary: "", sinceIso: now.iso })).toBeNull();
  });
  it("two candidates in the window is ambiguous, and ambiguity refuses rather than adopting the newest", () => {
    const twins = [
      { id: "a", summary: "Twelve minutes on Tuesday.", accountIds: ["acc_fb"], createdAt: "2026-09-15T19:52:20.000Z", status: "published" },
      { id: "b", summary: "Twelve minutes on Tuesday.", accountIds: ["acc_fb"], createdAt: "2026-09-15T19:53:20.000Z", status: "published" },
    ];
    expect(matchPlannerPost(twins, { accountId: "acc_fb", summary: "Twelve minutes on Tuesday.", sinceIso: "2026-09-15T19:52:14.000Z" })).toBeNull();
    expect(matchPlannerPost(twins.slice(1), { accountId: "acc_fb", summary: "Twelve minutes on Tuesday.", sinceIso: "2026-09-15T19:52:14.000Z" })?.id).toBe("b");
  });
  it("rows are checked least-recently-checked first, never-checked first of all, so the cap is a rate and not a cliff", () => {
    const rows = [{ id: "new", externalSyncedAt: "2026-09-15T19:00:00.000Z" }, { id: "never", externalSyncedAt: null }, { id: "old", externalSyncedAt: "2026-09-15T10:00:00.000Z" }];
    expect(orderForCheck(rows).map((r) => r.id)).toEqual(["never", "old", "new"]);
  });
  it("the board re-checks a row once an hour, published rows included, so a post deleted in the planner is found; an accepted row every twenty seconds", () => {
    const t = new Date("2026-09-15T20:00:00.000Z").getTime();
    const row = (over: Partial<Parameters<typeof needsCheck>[0]>) => ({ externalId: "p1", externalStatus: "published", externalSyncedAt: "2026-09-15T18:30:00.000Z", status: "posted", ...over });
    expect(needsCheck(row({}), t)).toBe(true);
    expect(needsCheck(row({ externalSyncedAt: "2026-09-15T19:30:00.000Z" }), t)).toBe(false);
    expect(needsCheck(row({ externalStatus: "deleted" }), t)).toBe(false);
    expect(needsCheck(row({ externalId: null, externalStatus: "accepted", externalSyncedAt: "2026-09-15T19:59:50.000Z" }), t)).toBe(false);
    expect(needsCheck(row({ externalId: null, externalStatus: "accepted", externalSyncedAt: "2026-09-15T19:59:00.000Z" }), t)).toBe(true);
    expect(needsCheck(row({ externalId: null, externalStatus: null }), t)).toBe(false);
    expect(needsCheck(row({ status: "draft" }), t)).toBe(false);
  });
  it("a post the planner deleted reads Deleted with the sentence, not Published", () => {
    const [o] = outcomesFor([{ id: "v", channel: "fb_page", groupId: "", status: "posted", postAt: null, postedAt: "2026-09-15T19:52:40.000Z", externalId: "p1", externalStatus: "deleted", externalError: "This post was deleted in the Social Planner.", externalSyncedAt: now.iso, createdAt: now.iso }], now);
    expect(o.state).toBe("failed");
    expect(o.word).toBe("Deleted");
    expect(o.reason).toBe("This post was deleted in the Social Planner.");
  });
});
