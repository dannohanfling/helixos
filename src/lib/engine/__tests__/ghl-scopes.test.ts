import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GHL_SCOPES, ONE_AT_A_TIME, REQUIRED_SCOPES, pickerName, scopeList, scopeNamedIn, searchText } from "../ghl-scopes";
import { explainGhl } from "../ghl-errors";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("the one GoHighLevel scope list", () => {
  it("covers what the app calls now and within two releases, once each", () => {
    expect(new Set(REQUIRED_SCOPES).size).toBe(REQUIRED_SCOPES.length);
    for (const s of ["socialplanner/account.readonly", "socialplanner/post.readonly", "socialplanner/post.write", "contacts.write", "locations.readonly", "medias.write", "users.readonly"]) expect(GHL_SCOPES.find((x) => x.scope === s)?.use).toBe("now");
    for (const s of ["socialplanner/stat.readonly", "emails/builder.write", "locations/customFields.write", "locations/customFields.readonly", "contacts.readonly", "opportunities.readonly"]) expect(GHL_SCOPES.find((x) => x.scope === s)?.use).toBe("next");
    // Nothing this product will ever touch.
    for (const s of ["category", "tag", "csv", "watermark"]) expect(REQUIRED_SCOPES.some((x) => x.includes(s))).toBe(false);
    // H-294: every id spelled as GoHighLevel's own scope list spells it (checked against its OpenAPI specs, 16 Oct): no "statistics", no "comments".
    for (const s of ["statistics", "comments"]) expect(REQUIRED_SCOPES.some((x) => x.includes(s))).toBe(false);
  });
  it("each row carries the picker's own name and a search text that finds it, one at a time (H-233)", () => {
    for (const s of GHL_SCOPES) {
      const name = pickerName(s);
      expect(name.startsWith(s.scope.endsWith(".readonly") ? "View " : "Edit "), s.scope).toBe(true);
      expect(name.toLowerCase(), s.scope).toContain(searchText(s).toLowerCase());
      expect(searchText(s).length, s.scope).toBeGreaterThan(3);
    }
    expect(pickerName(GHL_SCOPES.find((x) => x.scope === "socialplanner/post.write")!)).toBe("Edit Social Planner Posts");
    expect(searchText(GHL_SCOPES.find((x) => x.scope === "socialplanner/post.write")!)).toBe("Social Planner Post");
    expect(searchText(GHL_SCOPES.find((x) => x.scope === "opportunities.readonly")!)).toBe("Opportunities");
    expect(ONE_AT_A_TIME).toContain("one at a time");
    // The rows read the list and write no scope name of their own.
    const rows = readFileSync(join(ROOT, "src/components/ghl-scope-rows.tsx"), "utf8");
    expect(rows).toContain("pickerName");
    // H-294: a row's Copy is the scope id alone and the id sits beside the name; the list copy is every id, one a line.
    expect(rows).toContain("text={s.scope}");
    expect(rows).toContain("scopeList");
    expect(scopeList(GHL_SCOPES.slice(0, 2))).toBe(`${GHL_SCOPES[0].scope}\n${GHL_SCOPES[1].scope}`);
    expect(scopeList(GHL_SCOPES).endsWith("\n")).toBe(false);
    expect(rows).not.toMatch(/socialplanner\/[a-z]+\.[a-z]+|opportunities\.readonly/);
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
    expect(scopeNamedIn("The token does not have access to this scope: opportunities.readonly")).toBe("opportunities.readonly");
    expect(scopeNamedIn("Forbidden")).toBeNull();
    expect(explainGhl({ error: "x", status: 403, detail: "The token does not have access to this scope: socialplanner/account.readonly" }, "accounts")).toBe("Your key is missing one permission: socialplanner/account.readonly. Make a new key with everything in the list ticked.");
    expect(explainGhl({ error: "x", status: 403, detail: "Forbidden" }, "accounts")).toContain("Make a new key with everything in the list ticked");
  });
});
