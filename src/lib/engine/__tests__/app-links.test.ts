import { describe, expect, it } from "vitest";
import { APP_ID, APP_PATHS, androidAssetLinks, appleAssociation } from "@/lib/engine/app-links";

const PRINT = Array.from({ length: 32 }, (_, i) => (i * 7 + 16).toString(16).toUpperCase().padStart(2, "0")).join(":");

describe("deep links for the apps (H-877)", () => {
  it("stays a 404 until Danno sets the Apple Team ID, and refuses anything that isn't one", () => {
    expect(appleAssociation(undefined)).toBeNull();
    expect(appleAssociation("")).toBeNull();
    expect(appleAssociation("not-a-team")).toBeNull();
  });

  it("names the app and only the addresses that should open in it", () => {
    const a = appleAssociation(" abcde12345 ") as { applinks: { details: { appIDs: string[]; components: { "/": string }[] }[] } };
    expect(a.applinks.details[0].appIDs).toEqual([`ABCDE12345.${APP_ID}`]);
    const paths = a.applinks.details[0].components.map((c) => c["/"]);
    expect(paths).toEqual(APP_PATHS);
    // The API, OAuth and the funnel pages never open in the app.
    expect(paths.some((p) => p.startsWith("/oauth") || p.startsWith("/mf") || p === "/api/*")).toBe(false);
  });

  it("stays a 404 until the Play signing fingerprint is set, and keeps only well-formed ones", () => {
    expect(androidAssetLinks(undefined)).toBeNull();
    expect(androidAssetLinks("nope")).toBeNull();
    const links = androidAssetLinks(`${PRINT.toLowerCase()}, bad`) as { target: { package_name: string; sha256_cert_fingerprints: string[] } }[];
    expect(links[0].target.package_name).toBe(APP_ID);
    expect(links[0].target.sha256_cert_fingerprints).toEqual([PRINT]);
  });
});
