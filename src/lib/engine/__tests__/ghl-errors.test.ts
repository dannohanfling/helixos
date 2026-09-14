import { describe, expect, it } from "vitest";
import { explainGhl, refusedField } from "../ghl-errors";

describe("what GoHighLevel's reply means, by the call that was made", () => {
  it("a 422 on a post is the post's own details refused, never the location; the field it named is the one the sentence names", () => {
    // Nest validation, as GoHighLevel sends it: a 422 with an array of messages.
    const userId = explainGhl({ error: "x", status: 422, detail: "userId must be a string; userId should not be empty" }, "post");
    expect(userId).toContain("GHL user ID on Settings → Publishing");
    expect(userId).not.toContain("location");
    expect(explainGhl({ error: "x", status: 422, detail: "accountIds must contain at least 1 elements" }, "post")).toContain("account chosen for this channel");
    expect(explainGhl({ error: "x", status: 422, detail: "scheduleDate must be a valid ISO 8601 date string" }, "post")).toContain("schedule time");
    expect(explainGhl({ error: "x", status: 422, detail: "summary must be shorter than or equal to 2200 characters" }, "post")).toContain("text or media");
    expect(explainGhl({ error: "x", status: 422, detail: "something new" }, "post")).toContain("refused the post's details (422)");
    // A 404 on a post is the post or its account, not the location either.
    expect(explainGhl({ error: "x", status: 404, detail: "Post not found" }, "post")).not.toContain("location ID");
  });
  it("the location sentence is only ever said of the accounts call, where a 404 is exactly that", () => {
    expect(explainGhl({ error: "x", status: 404, detail: "Location not found: loc_other" }, "accounts")).toContain("location ID doesn't match this token");
    expect(explainGhl({ error: "x", status: 422, detail: "" }, "accounts")).toContain("location ID doesn't match this token");
  });
  it("the token and scope reasons hold on every call; the vendor's words never reach the sentence", () => {
    for (const call of ["accounts", "post", "contact"] as const) {
      expect(explainGhl({ error: "x", status: 401, detail: "Invalid JWT" }, call)).toContain("rejected the token (401)");
      expect(explainGhl({ error: "x", status: 403, detail: "The token does not have access to this scope: socialplanner/post.write" }, call)).toContain("missing Social Planner permissions (403)");
      expect(explainGhl({ error: "x", status: 429, detail: "Too many requests" }, call)).toContain("429");
      const odd = explainGhl({ error: "x", status: 500, detail: "MongoServerError: E11000 duplicate key at /internal/path" }, call);
      expect(odd).not.toContain("Mongo");
      expect(odd).not.toContain("/internal");
    }
    expect(explainGhl({ error: "x", detail: "TypeError: fetch failed" }, "post")).toContain("Couldn't reach GoHighLevel");
  });
  it("names the field from the words GoHighLevel uses", () => {
    expect(refusedField("property createdBy should not exist")).toBe("userId");
    expect(refusedField("each value in accountIds must be a string")).toBe("accountIds");
    expect(refusedField("scheduleDate must be in the future")).toBe("scheduleDate");
    expect(refusedField("media.0.url must be an URL address")).toBe("content");
    expect(refusedField("")).toBeNull();
  });
});
