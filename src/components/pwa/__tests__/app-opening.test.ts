import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FORGED, openingMode, shouldPlayOpening, SPLASH_MARK, splashLook, videoSource } from "@/components/pwa/app-opening";

const IPHONE_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const root = process.cwd();

describe("the app's opening (H-1759, H-1824)", () => {
  it("plays once per cold start", () => {
    expect(shouldPlayOpening({ getItem: () => null })).toBe(true);
    expect(shouldPlayOpening({ getItem: () => "1" })).toBe(false);
    // No storage at all (a locked-down web view): it plays, as it would on any cold start.
    expect(shouldPlayOpening(null)).toBe(true);
    expect(
      shouldPlayOpening({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });

  it("knows the logo screen from the build's mark, and plays the video only over the Golden hour still", () => {
    expect(splashLook(IPHONE_APP)).toBe("medallion");
    expect(splashLook(`${IPHONE_APP} ${SPLASH_MARK}`)).toBe("golden");
    expect(openingMode("golden", false)).toBe("video");
    expect(openingMode("golden", true)).toBe("drawn");
    expect(openingMode("medallion", false)).toBe("drawn");
  });

  it("gives the iPhone the H.264 cut and Android the VP9 cut", () => {
    expect(videoSource("ios")).toBe(FORGED.mp4);
    expect(videoSource("android")).toBe(FORGED.webm);
  });

  it("ships the files, versioned and cached for a year, and the app build carries the same mark", () => {
    for (const f of Object.values(FORGED)) {
      const path = join(root, "public", f);
      expect(existsSync(path), f).toBe(true);
      expect(statSync(path).size).toBeLessThan(1_000_000);
      expect(f).toMatch(/\/app-opening\/forged-v\d+/);
    }
    expect(readFileSync(join(root, "next.config.ts"), "utf8")).toContain('source: "/app-opening/:file(forged-v.*)"');
    expect(readFileSync(join(root, "mobile/capacitor.config.ts"), "utf8")).toContain(`appendUserAgent: "${SPLASH_MARK}"`);
    // A cold start can come before anyone has signed in: the files load without a session.
    expect(readFileSync(join(root, "src/proxy.ts"), "utf8")).toMatch(/const PUBLIC = \[[^\]]*"\/app-opening"/);
  });
});
