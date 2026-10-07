import { describe, expect, it } from "vitest";
import { healAccountId, originId, shortAccountId } from "../ghl-map";
import { scheduleNotice } from "../compose";

/**
 * Rev 567: an account reconnected in GoHighLevel gets a new OAuth prefix on its composite id, and the stored one is refused
 * with a 422. The same account is found by its origin id; a reconnect that leaves one fitting account is healed too; two
 * fitting accounts with no origin match are nobody's guess.
 */
const live = (id: string, platform: string, type = "business") => ({ id, name: id, platform, type, isExpired: false });

describe("a stale Social Planner account id heals to the same account", () => {
  it("reads the origin id off the composite id", () => {
    expect(originId("OsyiwYzwGdK9O1noUOcT_17841467713825666")).toBe("17841467713825666");
    expect(originId("loc_maya_ig_gen2_1")).toBe("1");
    expect(originId("plain")).toBe("plain");
  });
  it("finds the reconnected account by origin id and channel, and leaves a live id alone", () => {
    const accounts = [live("newprefix_17841467713825666", "instagram"), live("pfx_111", "facebook", "page")];
    expect(healAccountId("oldprefix_17841467713825666", accounts, "instagram")).toBe("newprefix_17841467713825666");
    expect(healAccountId("oldprefix_17841467713825666", accounts, "stories")).toBe("newprefix_17841467713825666");
    expect(healAccountId("newprefix_17841467713825666", accounts, "instagram")).toBeNull();
    // The same origin id on another platform is not the account.
    expect(healAccountId("x_111", [live("y_111", "linkedin", "profile")], "fb_page")).toBeNull();
  });
  it("with no origin match, the one account that fits the channel is the one; two is a question for Settings", () => {
    expect(healAccountId("gone_1", [live("a_2", "instagram")], "instagram")).toBe("a_2");
    expect(healAccountId("gone_1", [live("a_2", "instagram"), live("b_3", "instagram")], "instagram")).toBeNull();
    expect(healAccountId("gone_1", [live("a_2", "instagram", "business"), live("x_2", "instagram", "business")], "instagram")).toBeNull();
    // An expired account never heals anything.
    expect(healAccountId("gone_1", [{ ...live("a_1", "instagram"), isExpired: true }], "instagram")).toBeNull();
  });
  it("shows a long id by its tail", () => {
    expect(shortAccountId("OsyiwYzwGdK9O1noUOcT_17841467713825666")).toBe("…cT_17841467713825666");
    expect(shortAccountId("loc_maya_ig_1")).toBe("loc_maya_ig_1");
  });
});

describe("the composer's line after a save never says Saved 0 versions", () => {
  const fb = { channel: "fb_page", label: "Facebook business page", why: "posted" as const };
  const ig = { channel: "instagram", label: "Instagram caption", why: "posted" as const };
  it("names what was kept when nothing was scheduled, and the way to re-post on purpose", () => {
    const line = scheduleNotice({ scheduled: 0, posted: 0, skipped: [fb, ig] }, "schedule");
    expect(line).toBe('Nothing scheduled: Facebook business page already posted; Instagram caption already posted. A posted channel is never overwritten. To post one again on purpose, use "Post again to this channel" on the Distribute page.');
    expect(scheduleNotice({ scheduled: 0, posted: 0, skipped: [] }, "now")).toMatch(/^Nothing posted\./);
  });
  it("counts what was saved and says what was left as it was", () => {
    expect(scheduleNotice({ scheduled: 2, posted: 0, skipped: [fb] }, "schedule")).toBe("Saved 2 versions. Facebook business page already posted, left as it was. Each channel says below when it goes.");
    expect(scheduleNotice({ scheduled: 0, posted: 1, skipped: [] }, "now")).toBe("Saved 1 version. Each channel says below what happened.");
  });
});
