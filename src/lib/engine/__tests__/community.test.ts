import { describe, expect, it } from "vitest";
import { DEFAULT_MONDAY_TEXT, DEFAULT_MONTH_TEXT, SHARE_POINTS, failedReason, patternFor, pickPlannerPost, testText, TITLE_MAX, shareRef, shareTarget, shareText, communityDetails, fromPlanner, isAccountHold, mondayDue, mondayText, mondayTitle, monthDue, monthShareRef, monthShareText, monthShareTarget, monthTestText, monthText, monthTitle, nextMonth, normalTime, postLink, upcomingMonth, upcomingWeek, validLink, validPattern, postIdFromLink, patternFromLink, communityHtml, plainOf, mondayTestText, EVERYONE_MENTION } from "../community";
import { MONTH_QUESTIONS } from "../month-intentions";

describe("the first-of-the-month post (1 Oct)", () => {
  it("is titled the way Danno titles it", () => {
    expect(monthTitle("2026-10")).toBe("Set Your October Intentions");
    expect(monthTitle("2026-11")).toBe("Set Your November Intentions");
  });
  it("is due on the 1st only, from the coach's month time until the day ends", () => {
    expect(monthDue("2026-11-01", "07:59", "08:00")).toBe(false);
    expect(monthDue("2026-11-01", "08:00", "08:00")).toBe(true);
    expect(monthDue("2026-11-01", "23:59", "08:00")).toBe(true);
    // A 1st missed is never posted later in the month by the job: the coach presses Post now.
    expect(monthDue("2026-11-02", "09:00", "08:00")).toBe(false);
  });
  it("names the next month to preview: this month's until the 1st's time passes, then the one after", () => {
    expect(upcomingMonth("2026-11-01", "07:00", "08:00")).toBe("2026-11");
    expect(upcomingMonth("2026-11-01", "08:00", "08:00")).toBe("2026-12");
    expect(upcomingMonth("2026-11-15", "12:00", "08:00")).toBe("2026-12");
    expect(upcomingMonth("2026-12-15", "12:00", "08:00")).toBe("2027-01");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
  it("uses the eleven questions as the default text until the coach writes their own", () => {
    expect(monthText(null)).toBe(DEFAULT_MONTH_TEXT);
    expect(monthText(" Mine ")).toBe("Mine");
    for (const q of MONTH_QUESTIONS) expect(DEFAULT_MONTH_TEXT).toContain(q.q);
    expect(DEFAULT_MONTH_TEXT).toContain("@everyone");
    expect(monthTestText("Text", "2026-10-01T08:00:00.000Z")).toContain("A test of the month text from HelixOS, sent 2026-10-01 08:00 UTC");
  });
  it("shares the eleven answers, question by question, revenue included as Danno asked", () => {
    const text = monthShareText({ word: " Rooted ", personalSeason: "wealth", fear: "Being seen", habit: "Walk daily", skill: "Selling", impact: "Ten clients served", businessSeason: "sales", revenueGoal: 10000, revenueWhy: "To hire help.", plan: "Two offers a week", proudLast: "Launched", proudEnd: "Kept every promise" });
    expect(text).toBe(
      [
        "My word: Rooted",
        "Personal season: Wealth",
        "Fear or limiting belief to overcome: Being seen",
        "Habit to start: Walk daily",
        "Skill to develop: Selling",
        "Impact: Ten clients served",
        "Business season: Sales",
        "Revenue goal: $10,000. To hire help.",
        "Plan: Two offers a week",
        "Most proud of last month: Launched",
        "At the end of the month, proud of: Kept every promise",
      ].join("\n\n"),
    );
    expect(monthShareRef("2026-11")).toBe("share:month:2026-11");
  });
  it("goes only to this month's post, once it's out with a link", () => {
    expect(monthShareTarget(null, "2026-11")).toEqual({ reason: "This month's post isn't up yet. Check back after the 1st." });
    expect(monthShareTarget({ monthOf: "2026-10", status: "posted", link: "https://x" }, "2026-11")).toEqual({ reason: "This month's post isn't up yet. Check back after the 1st." });
    expect(monthShareTarget({ monthOf: "2026-11", status: "sent", link: null }, "2026-11")).toEqual({ reason: "This month's post isn't up yet. Check back later today." });
    expect(monthShareTarget({ monthOf: "2026-11", status: "posted", link: "https://x" }, "2026-11")).toEqual({ link: "https://x" });
  });
});

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
    expect(communityDetails("acc1", "Set Your Intentions 9/28-10/4", { id: "user1", name: "Danno" })).toEqual({ title: "Set Your Intentions 9/28-10/4", postAsUser: { acc1: { id: "user1", name: "Danno", avatar: "" } }, notifyAllGroupMembers: false });
    // Rev 187: the composer's own flag, sent only when asked (the Monday post's setting), false otherwise.
    expect(communityDetails("acc1", "t", { id: "u", name: "n" }, true).notifyAllGroupMembers).toBe(true);
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

describe("a post link the coach pastes (28 Sep, live)", () => {
  const link = "https://academy.example.com/communities/groups/g/channels/Old-Slug-2sIZH/posts/6aba9e02b152d012a960d2f9";
  it("gives the community's post id, and only a 24-hex one after /posts/", () => {
    expect(postIdFromLink(link)).toBe("6aba9e02b152d012a960d2f9");
    expect(postIdFromLink(`${link}?ref=x`)).toBe("6aba9e02b152d012a960d2f9");
    expect(postIdFromLink(link.toUpperCase().replace("HTTPS", "https"))).toBe("6aba9e02b152d012a960d2f9");
    expect(postIdFromLink("https://academy.example.com/communities/groups/g/channels/c")).toBeNull();
    expect(postIdFromLink("https://academy.example.com/posts/6aba9e02b152d012a960d2f")).toBeNull();
    expect(postIdFromLink("https://academy.example.com/posts/6aba9e02b152d012a960d2f9ab")).toBeNull();
  });
  it("gives its channel's pattern, which builds the same link back", () => {
    const pattern = patternFromLink(`${link}#top`)!;
    expect(pattern).toBe("https://academy.example.com/communities/groups/g/channels/Old-Slug-2sIZH/posts/{postId}");
    expect(validPattern(pattern)).toBe(true);
    expect(postLink(pattern, "6aba9e02b152d012a960d2f9")).toBe(link);
    expect(patternFromLink("https://academy.example.com/communities/groups/g")).toBeNull();
  });
});

describe("the post's text as the community shows it (rev 169)", () => {
  it("keeps paragraphs and line breaks, and escapes the text first", () => {
    expect(communityHtml("Set your week.\n\nOne word\nThree key results\n\n\nShare below @everyone")).toBe("<p>Set your week.</p><p>One word<br>Three key results</p><p>Share below @everyone</p>");
    expect(communityHtml("A & B <script>\r\n\r\n\"quoted\" it's")).toBe("<p>A &amp; B &lt;script&gt;</p><p>&quot;quoted&quot; it&#39;s</p>");
    expect(communityHtml("  \n\n  ")).toBe("");
  });
  it("reads back to the same words, so the planner's copy is still found", () => {
    expect(plainOf(communityHtml("One\ntwo\n\nA & <b>"))).toBe("One two A & <b>");
    const posts = [{ id: "h", status: "published", accountIds: ["acc"], summary: communityHtml("Week\n\ntext & more"), createdAt: "2026-09-28T10:45:00Z" }];
    expect(pickPlannerPost(posts, { accountId: "acc", summary: "Week\n\ntext & more", sentAtIso: "2026-09-28T10:44:08Z" })?.id).toBe("h");
    // A plain post from before is still compared as plain text, "<" and all.
    const old = [{ id: "p", status: "published", accountIds: ["acc"], summary: "1 < 2 <yes>", createdAt: "2026-09-28T10:45:00Z" }];
    expect(pickPlannerPost(old, { accountId: "acc", summary: "1 < 2 <yes>", sentAtIso: "2026-09-28T10:44:08Z" })?.id).toBe("p");
  });
  it("sends the Monday text as a test with its send time on a last paragraph", () => {
    const t = mondayTestText("Set your week.", "2026-09-29T10:44:08.000Z");
    expect(t.startsWith("Set your week.\n\n(A test of the Monday text")).toBe(true);
    expect(t).toContain("2026-09-29 10:44 UTC");
    expect(communityHtml(t).startsWith("<p>Set your week.</p><p>(A test")).toBe(true);
  });
});

describe("@everyone as a real mention (rev 203)", () => {
  const text = "Declare your goals here.\n\nShare below @everyone so we can check in.";
  it("the Monday post gets the composer's own broadcast mention, exactly", () => {
    expect(communityHtml(text, { mentionEveryone: true })).toBe(`<p>Declare your goals here.</p><p>Share below ${EVERYONE_MENTION} so we can check in.</p>`);
    expect(EVERYONE_MENTION).toBe('<span data-label="everyone" data-icon-type="emoji" data-mention-type="broadcast" data-type="mention" class="min-h-6"><span class="mention-text truncate min-w-0">@everyone</span></span>');
    expect(communityHtml("@everyone", { mentionEveryone: true })).toBe(`<p>${EVERYONE_MENTION}</p>`);
    expect(communityHtml("Hi (@everyone)!\n@everyone.", { mentionEveryone: true })).toBe(`<p>Hi (${EVERYONE_MENTION})!<br>${EVERYONE_MENTION}.</p>`);
  });
  it("a test keeps it as words: the default, for both kinds of test", () => {
    expect(communityHtml(text)).toBe("<p>Declare your goals here.</p><p>Share below @everyone so we can check in.</p>");
    expect(communityHtml(mondayTestText(text, "2026-09-29T10:44:08.000Z"))).not.toContain("data-mention-type");
  });
  it("leaves @everyone inside another word or address alone, and still escapes the rest", () => {
    expect(communityHtml("x@everyone a.b@everyone @everyones @everyone@x", { mentionEveryone: true })).toBe("<p>x@everyone a.b@everyone @everyones @everyone@x</p>");
    expect(communityHtml("<b>Tom & Jerry</b> @everyone", { mentionEveryone: true })).toBe(`<p>&lt;b&gt;Tom &amp; Jerry&lt;/b&gt; ${EVERYONE_MENTION}</p>`);
  });
  it("reads back to the same words, so the planner's copy is still found", () => {
    expect(plainOf(communityHtml(text, { mentionEveryone: true }))).toBe("Declare your goals here. Share below @everyone so we can check in.");
  });
});
