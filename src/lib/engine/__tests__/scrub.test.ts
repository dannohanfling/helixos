import { describe, expect, it } from "vitest";
import { REDACTED, scrubEvent, scrubText, scrubValue } from "../scrub";

describe("error reports carry causes, ids and counts, never a member's words (H-349)", () => {
  it("takes email addresses, phone numbers and credentials out of a message", () => {
    expect(scrubText("mail to maya@example.com failed")).toBe(`mail to ${REDACTED} failed`);
    expect(scrubText("call +1 (555) 123-4567 later")).toBe(`call ${REDACTED} later`);
    expect(scrubText("Bearer abcdefghijklmnopqrstuvwxyz012345 refused")).toBe(`Bearer ${REDACTED} refused`);
    expect(scrubText("3 rows in 120ms for workspace ws_1")).toBe("3 rows in 120ms for workspace ws_1");
  });
  it("drops sensitive keys whole and scrubs strings deep", () => {
    const v = scrubValue({ userId: "u1", email: "a@b.co", firstName: "Maya", apiKey: "k", nested: { phone: "5551234567", note: "ok at x@y.io", count: 2 }, list: ["t@u.io", 1] });
    expect(v).toEqual({ userId: "u1", email: REDACTED, firstName: REDACTED, apiKey: REDACTED, nested: { phone: REDACTED, note: `ok at ${REDACTED}`, count: 2 }, list: [REDACTED, 1] });
    expect(scrubValue({ body_weight: 80, bodyEnabled: true, healthNote: "x", workspaceId: "w", rowCount: 4 })).toEqual({ body_weight: REDACTED, bodyEnabled: REDACTED, healthNote: REDACTED, workspaceId: "w", rowCount: 4 });
  });
  it("an event keeps the path and method, no body, headers, cookies or query; the user is an id alone", () => {
    const e = scrubEvent({
      message: "failed for maya@example.com",
      request: { url: "https://h/api/x?token=abc", method: "POST", data: { email: "a@b.co" }, headers: { cookie: "s=1" }, cookies: { s: "1" }, query_string: "token=abc" },
      user: { id: "u1", email: "a@b.co", username: "maya" },
      extra: { email: "a@b.co", workspaceId: "ws1" },
      tags: { job: "cron:community" },
      breadcrumbs: [{ category: "console", message: "sent to a@b.co", data: { phone: "5551234567" } }],
      exception: { values: [{ type: "Error", value: "no key for a@b.co" }] },
    });
    expect(e.request).toEqual({ url: "https://h/api/x", method: "POST" });
    expect(e.user).toEqual({ id: "u1" });
    expect(e.extra).toEqual({ email: REDACTED, workspaceId: "ws1" });
    expect(e.tags).toEqual({ job: "cron:community" });
    expect(e.breadcrumbs).toEqual([{ category: "console", message: `sent to ${REDACTED}`, data: { phone: REDACTED } }]);
    expect(e.message).toBe(`failed for ${REDACTED}`);
    expect(e.exception?.values?.[0].value).toBe(`no key for ${REDACTED}`);
    expect(JSON.stringify(e)).not.toMatch(/a@b\.co|maya|abc|5551234567/);
  });
  it("a user without an id is dropped; an event with nothing sensitive passes unchanged", () => {
    expect(scrubEvent({ user: { email: "a@b.co" } }).user).toBeUndefined();
    const plain = { message: "db timeout", tags: { job: "webhook:whoop" } };
    expect(scrubEvent(plain)).toEqual(plain);
  });
});
