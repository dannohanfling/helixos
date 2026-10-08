import { describe, expect, it } from "vitest";
import { LABEL, graphicPublicPath, isGraphicToken, shipLine, shipRuns, shipSteps, type ShipFacts } from "../ship";
import { dripPayload } from "../rung-drip";

/** Ship (rev 583 #1, commit 3): the steps, what one press runs, what is held and why; the drip payload's new keys; the public address. */
const ok = (): ShipFacts => ({ blockers: 0, hasGraphic: true, publicLink: true, ghl: { connected: true, userId: true, page: true, instagram: true }, posts: { page: { state: "none", reason: null }, instagram: { state: "none", reason: null } }, drip: { setUp: true, handed: false, locked: null }, keyword: { set: true, token: true, pushed: false, blocked: null } });

describe("Ship a ladder", () => {
  it("a clear ladder with its graphic and GoHighLevel ready: the two posts run first, the drip waits for them, the keyword runs", () => {
    const s = shipSteps(ok());
    expect(s.map((x) => [x.key, x.state])).toEqual([["graphic", "done"], ["page", "ready"], ["instagram", "ready"], ["drip", "held"], ["keywords", "ready"]]);
    expect(s.find((x) => x.key === "drip")?.why).toContain("confirmed by GoHighLevel first");
    expect(shipRuns(s)).toEqual(["page", "instagram", "keywords"]);
    expect(shipLine(s)).toBe("Ship runs: facebook page post, instagram post, keyword on your bot.");
  });
  it("the checklist holds everything; no graphic holds the posts; GoHighLevel's gaps are named where they are fixed", () => {
    expect(shipSteps({ ...ok(), blockers: 2 }).every((x) => x.state === "held" && x.why?.includes("2 things to fix"))).toBe(true);
    const noGraphic = shipSteps({ ...ok(), hasGraphic: false });
    expect(noGraphic.find((x) => x.key === "graphic")?.why).toContain("Make the graphic first");
    expect(noGraphic.find((x) => x.key === "page")?.state).toBe("held");
    expect(shipSteps({ ...ok(), ghl: { connected: false, userId: false, page: false, instagram: false } }).find((x) => x.key === "page")?.why).toContain("Settings → Publishing");
    expect(shipSteps({ ...ok(), ghl: { connected: true, userId: false, page: true, instagram: true } }).find((x) => x.key === "instagram")?.why).toContain("GHL user ID");
    expect(shipSteps({ ...ok(), ghl: { connected: true, userId: true, page: true, instagram: false } }).find((x) => x.key === "instagram")?.why).toContain("No Instagram account chosen");
    // With no graphic the posts are held, but the keyword can still go: the line names what Ship would run.
    expect(shipLine(shipSteps({ ...ok(), hasGraphic: false }))).toBe("Ship runs: keyword on your bot.");
    expect(shipLine(shipSteps({ ...ok(), hasGraphic: false, keyword: { set: false, token: false, pushed: false, blocked: null } }))).toContain("Held: Make the graphic first");
  });
  it("once both posts are published the drip is ready; handed, it is done; a failed post runs again with its reason shown; everything done says shipped", () => {
    const published = { ...ok(), posts: { page: { state: "published" as const, reason: null }, instagram: { state: "published" as const, reason: null } } };
    expect(shipSteps(published).find((x) => x.key === "drip")?.state).toBe("ready");
    expect(shipSteps({ ...published, drip: { setUp: true, handed: false, locked: "6:10 pm" } }).find((x) => x.key === "drip")?.why).toContain("already dripping");
    expect(shipSteps({ ...published, drip: { setUp: false, handed: false, locked: null } }).find((x) => x.key === "drip")?.why).toContain("Evolve Omega sets that up");
    const failed = shipSteps({ ...ok(), posts: { page: { state: "failed", reason: "The channel is inactive." }, instagram: { state: "sent", reason: null } } });
    expect(failed.find((x) => x.key === "page")).toMatchObject({ state: "ready", why: "The channel is inactive." });
    expect(failed.find((x) => x.key === "instagram")).toMatchObject({ state: "done" });
    const done = shipSteps({ ...published, drip: { setUp: true, handed: true, locked: null }, keyword: { set: true, token: true, pushed: true, blocked: null } });
    expect(done.every((x) => x.state === "done")).toBe(true);
    expect(shipLine(done)).toBe("Shipped: every step is done.");
    expect(shipSteps({ ...ok(), keyword: { set: false, token: false, pushed: false, blocked: null } }).find((x) => x.key === "keywords")?.why).toContain("NONE");
    expect(shipSteps({ ...ok(), keyword: { set: true, token: false, pushed: false, blocked: null } }).find((x) => x.key === "keywords")?.why).toContain("API token");
    expect(shipSteps({ ...ok(), keyword: { set: true, token: true, pushed: false, blocked: "Your bot has no keyword router yet." } }).find((x) => x.key === "keywords")?.why).toBe("Your bot has no keyword router yet.");
    expect(Object.keys(LABEL)).toEqual(["graphic", "page", "instagram", "drip", "keywords"]);
  });
  it("the drip payload carries Ship's keys as strings, empty when unknown, and the five keys it always had", () => {
    const base = dripPayload({ userNs: "u1", post: "P", rungs: ["1. a", "2. b"], fbIgPublisher: "helixos" });
    expect(base).toMatchObject({ user_ns: "u1", post: "P", first_comment: "1. a", schedule_at: "", target: "both", rung_fb_post_id: "", rung_ig_media_id: "", gap_minutes: "", pin_last: "" });
    const shipped = dripPayload({ userNs: "u1", post: "P", rungs: ["1. a"], fbIgPublisher: "helixos", target: "instagram", fbPostId: "fb_1", igMediaId: "ig_2", gapMinutes: 5, pinLast: true });
    expect(shipped).toMatchObject({ target: "instagram", rung_fb_post_id: "fb_1", rung_ig_media_id: "ig_2", gap_minutes: "5", pin_last: "1" });
    expect(Object.values(shipped).every((v) => typeof v === "string")).toBe(true);
  });
  it("the public address is the token alone, as a .png; a token is 32 hex characters", () => {
    expect(graphicPublicPath("0123456789abcdef0123456789abcdef")).toBe("/api/graphics/0123456789abcdef0123456789abcdef.png");
    expect(isGraphicToken("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isGraphicToken("hx_0123456789abcdef0123456789abcdef")).toBe(false);
    expect(isGraphicToken("../../etc")).toBe(false);
  });
});
