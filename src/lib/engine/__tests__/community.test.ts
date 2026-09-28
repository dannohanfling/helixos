import { describe, expect, it } from "vitest";
import { DEFAULT_MONDAY_TEXT, SHARE_POINTS, failedReason, patternFor, pickPlannerPost, testText, TITLE_MAX, shareRef, shareTarget, shareText, communityDetails, fromPlanner, isAccountHold, mondayDue, mondayText, mondayTitle, normalTime, postLink, upcomingWeek, validLink, validPattern } from "../community";

describe("the Monday post's title", () => {
  it("is the week's Monday to Sunday, month/day", () => {
    expect(mondayTitle("2026-09-28")).toBe("Set Your Intentions 9/28-10/4");
    expect(mondayTitle("2026-12-28")).toBe("Set Your Intentions 12/28-1/3");
  });
});

describe("when the Monday post is due", () => {
  it("only on a Monday, from the coach's time until the day ends", () => {
    expect(mondayDue("2026-09-28", "07:59", "08:00")).toBe(false);
    expect(mondayDue("2026-09-28", "08:00", "08:00")).toBe(true);
    expect(mondayDue("2026-09-28", "23:59", "08:00")).toBe(true);
    // A Monday missed entirely is never posted later in the week by the job: the coach presses Post now.
    expect(mondayDue("2026-09-29", "09:00", "08:00")).toBe(false);
    expect(mondayDue("2026-09-27", "09:00", "08:00")).toBe(false);
  });
  it("names the next week to preview: this Monday's until its time passes, then the one after", () => {
    expect(upcomingWeek("2026-09-28", "07:00", "08:00")).toBe("2026-09-28");
    expect(upcomingWeek("2026-09-28", "08:00", "08:00")).toBe("2026-10-05");
    expect(upcomingWeek("2026-10-01", "12:00", "08:00")).toBe("2026-10-05");
    expect(upcomingWeek("2026-10-04", "23:00", "08:00")).toBe("2026-10-05");
  });
});

describe("the coach's settings", () => {
  it("reads a time of day, and refuses anything else", () => {
    expect(normalTime("8:05")).toBe("08:05");
    expect(normalTime("23:59")).toBe("23:59");
    expect(normalTime("24:00")).toBeNull();
    expect(normalTime("8am")).toBeNull();
  });
  it("uses Danno's text until the coach writes their own", () => {
    expect(mondayText(null)).toBe(DEFAULT_MONDAY_TEXT);
    expect(mondayText("   ")).toBe(DEFAULT_MONDAY_TEXT);
    expect(mondayText(" Mine ")).toBe("Mine");
    expect(DEFAULT_MONDAY_TEXT).toContain("Share below @everyone");
  });
  it("takes a link pattern only as an https address with {postId} in it", () => {
    expect(validPattern("https://academy.example.com/communities/groups/g/home?postId={postId}")).toBe(true);
    expect(validPattern("https://academy.example.com/post")).toBe(false);
    expect(validPattern("javascript:alert(1)//{postId}")).toBe(false);
    expect(validLink("https://academy.example.com/p/1")).toBe(true);
    expect(validLink("http://academy.example.com/p/1")).toBe(false);
  });
});

describe("the post body and what comes back", () => {
  it("maps the community account to the team user, with the title", () => {
    expect(communityDetails("acc1", "Set Your Intentions 9/28-10/4", { id: "user1", name: "Danno" })).toEqual({ title: "Set Your Intentions 9/28-10/4", postAsUser: { acc1: { id: "user1", name: "Danno", avatar: "" } } });
    expect(communityDetails("acc1", "x".repeat(TITLE_MAX + 50), { id: "u", name: "n" }).title).toHaveLength(TITLE_MAX);
  });
  it("builds the link from the pattern once the community's id is known", () => {
    expect(postLink("https://c.example.com/p?id={postId}", "abc 1")).toBe("https://c.example.com/p?id=abc%201");
    expect(postLink("https://c.example.com/p?id={postId}", null)).toBeNull();
    expect(postLink(null, "abc")).toBeNull();
  });
  it("reads the planner's status in the coach's words", () => {
    expect(fromPlanner("published")).toBe("posted");
    expect(fromPlanner("failed")).toBe("failed");
    expect(fromPlanner("in_progress")).toBe("sent");
    expect(fromPlanner("scheduled")).toBe("sent");
  });
});

describe("an account on hold", () => {
  it("is recognised from the reply, so posting stops instead of retrying", () => {
    expect(isAccountHold({ status: 403, detail: "This location is on hold due to a failed payment. Please update billing." })).toBe(true);
    expect(isAccountHold({ status: 402 })).toBe(true);
    expect(isAccountHold({ status: 401, detail: "Location is suspended" })).toBe(true);
    expect(isAccountHold({ status: 403, detail: "The token does not have access to this scope: socialplanner/post.write" })).toBe(false);
    expect(isAccountHold({ status: 422, detail: "userId must be a valid user id" })).toBe(false);
  });
});

describe("Share to the thread", () => {
  const week = { word: "Consistent ", keyResults: [{ text: "Follow up with 12 leads" }, { text: "Book 3 calls" }, { text: " " }], initiative: "Build my webinar", tasks: [{ title: "Write the hook" }, { title: "Record the intro" }] };
  it("is the word, key results, initiative and tasks, and nothing else", () => {
    expect(shareText(week)).toBe("My word: Consistent\n\nKey results:\n1. Follow up with 12 leads\n2. Book 3 calls\n\nInitiative: Build my webinar\n\nTasks:\n1. Write the hook\n2. Record the intro");
  });
  it("opens only this week's post, once it's out with a link", () => {
    const posted = { weekOf: "2026-09-28", status: "posted", link: "https://c.example.com/p/1" };
    expect(shareTarget(posted, "2026-09-28")).toEqual({ link: "https://c.example.com/p/1" });
    expect("reason" in shareTarget(posted, "2026-10-05")).toBe(true);
    expect("reason" in shareTarget({ ...posted, status: "skipped" }, "2026-09-28")).toBe(true);
    expect("reason" in shareTarget({ ...posted, status: "failed" }, "2026-09-28")).toBe(true);
    expect("reason" in shareTarget({ ...posted, link: null }, "2026-09-28")).toBe(true);
    expect("reason" in shareTarget(null, "2026-09-28")).toBe(true);
  });
  it("scores 15 once per week", () => {
    expect(SHARE_POINTS).toBe(15);
    expect(shareRef("2026-09-28")).toBe("share:2026-09-28");
  });
});

describe("reading a post back (28 Sep, live)", () => {
  const post = (id: string, createdAt: string, summary = "Week text", accountIds = ["acc"]) => ({ id, status: "failed", summary, accountIds, createdAt });
  it("finds the planner's post when the create reply had no id: same channel and text, nearest to our send", () => {
    const posts = [post("a", "2026-09-28T10:43:05Z"), post("b", "2026-09-28T10:44:10Z"), post("c", "2026-09-28T10:44:12Z", "Other"), post("d", "2026-09-28T10:44:09Z", "Week text", ["other"])];
    expect(pickPlannerPost(posts, { accountId: "acc", summary: "Week  text", sentAtIso: "2026-09-28T10:44:08Z" })?.id).toBe("b");
    expect(pickPlannerPost(posts, { accountId: "acc", summary: "Week text", sentAtIso: "2026-09-28T12:00:00Z" })).toBeNull();
  });
  it("keeps each channel's own link pattern", () => {
    expect(patternFor({ test: "https://x/test/{postId}" }, { pattern: null, channel: null }, "test")).toBe("https://x/test/{postId}");
    expect(patternFor({ test: "https://x/test/{postId}" }, { pattern: null, channel: null }, "intentions")).toBeNull();
    expect(patternFor({}, { pattern: "https://x/old/{postId}", channel: "test" }, "test")).toBe("https://x/old/{postId}");
    expect(patternFor({}, { pattern: "https://x/old/{postId}", channel: "test" }, "intentions")).toBeNull();
  });
  it("says a failure in GoHighLevel's words, and makes each test post its own", () => {
    expect(failedReason("The channel or group is either deleted or inactive")).toBe("GoHighLevel says: The channel or group is either deleted or inactive");
    expect(failedReason("")).toBe("The Social Planner marked it failed without a reason.");
    expect(testText("2026-09-28T10:44:08.000Z")).not.toBe(testText("2026-09-28T10:45:08.000Z"));
  });
});
