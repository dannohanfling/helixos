import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GHL_SCOPES, REQUIRED_SCOPES, scopeNamedIn } from "../ghl-scopes";
import { explainGhl } from "../ghl-errors";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("the one GoHighLevel scope list", () => {
  it("covers what the app calls now and within two releases, once each", () => {
    expect(new Set(REQUIRED_SCOPES).size).toBe(REQUIRED_SCOPES.length);
    for (const s of ["socialplanner/account.readonly", "socialplanner/post.readonly", "socialplanner/post.write", "contacts.write"]) expect(GHL_SCOPES.find((x) => x.scope === s)?.use).toBe("now");
    for (const s of ["socialplanner/statistics.readonly", "socialplanner/comment.readonly", "socialplanner/comment.write", "medias.write", "emails/builder.write"]) expect(GHL_SCOPES.find((x) => x.scope === s)?.use).toBe("next");
    // Nothing this product will ever touch.
    for (const s of ["category", "tag", "csv", "watermark"]) expect(REQUIRED_SCOPES.some((x) => x.includes(s))).toBe(false);
  });
  it("every screen and document that names a scope reads this list: the README carries every entry and no other socialplanner scope", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const s of REQUIRED_SCOPES) expect(readme, s).toContain(s);
    const named = new Set(readme.match(/socialplanner\/[a-z]+\.[a-z]+/g) ?? []);
    for (const s of named) expect(REQUIRED_SCOPES, `${s} is in the README but not on the list`).toContain(s);
    const settings = readFileSync(join(ROOT, "src/components/ghl-connect.tsx"), "utf8");
    expect(settings).toContain("GHL_SCOPES");
    expect(settings).not.toMatch(/socialplanner\/[a-z]+\.[a-z]+/);
  });
  it("a 403 names the scope GoHighLevel refused, so the client fixes that one alone", () => {
    expect(scopeNamedIn("The token does not have access to this scope: socialplanner/post.write")).toBe("socialplanner/post.write");
    expect(scopeNamedIn("The token does not have access to this scope: medias.write")).toBe("medias.write");
    expect(scopeNamedIn("Forbidden")).toBeNull();
    expect(explainGhl({ error: "x", status: 403, detail: "The token does not have access to this scope: socialplanner/account.readonly" }, "accounts")).toBe("The token is valid but socialplanner/account.readonly was not granted (403). Edit the Private Integration in GoHighLevel, tick it, and paste the new token.");
    expect(explainGhl({ error: "x", status: 403, detail: "Forbidden" }, "accounts")).toContain("every scope on the list");
  });
});
