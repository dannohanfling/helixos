import { describe, expect, it } from "vitest";
import { DEFAULT_MONDAY_TEXT, TITLE_MAX, communityDetails, fromPlanner, isAccountHold, mondayDue, mondayText, mondayTitle, normalTime, postLink, upcomingWeek, validLink, validPattern } from "../community";

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
