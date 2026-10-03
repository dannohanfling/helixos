import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GHL_SCOPES, REQUIRED_SCOPES, scopeNamedIn } from "../ghl-scopes";
import { explainGhl } from "../ghl-errors";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("the one GoHighLevel scope list", () => {
  it("covers what the app calls now and within two releases, once each", () => {
    expect(new Set(REQUIRED_SCOPES).size).toBe(REQUIRED_SCOPES.length);
    for (const s of ["socialplanner/account.readonly", "socialplanner/post.readonly", "socialplanner/post.write", "contacts.write", "locations.readonly"]) expect(GHL_SCOPES.find((x) => x.scope === s)?.use).toBe("now");
    for (const s of ["socialplanner/statistics.readonly", "socialplanner/comments.readonly", "socialplanner/comments.write", "medias.write", "emails/builder.write", "locations/customFields.write", "locations/customFields.readonly", "contacts.readonly"]) expect(GHL_SCOPES.find((x) => x.scope === s)?.use).toBe("next");
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
    expect(scopeNamedIn("The token does not have access to this scope: locations/customFields.write")).toBe("locations/customFields.write");
    expect(scopeNamedIn("The token does not have access to this scope: locations.readonly")).toBe("locations.readonly");
    expect(scopeNamedIn("Forbidden")).toBeNull();
    expect(explainGhl({ error: "x", status: 403, detail: "The token does not have access to this scope: socialplanner/account.readonly" }, "accounts")).toBe("The token is missing permissions: socialplanner/account.readonly. Edit the Private Integration in GoHighLevel, tick it, and paste the new token.");
    expect(explainGhl({ error: "x", status: 403, detail: "Forbidden" }, "accounts")).toContain("tick every permission on the list");
  });
});
