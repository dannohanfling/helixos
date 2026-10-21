import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheName, installKind, OFFLINE_PATH, readyToOffer, seenDays, serviceWorkerSource } from "@/lib/engine/pwa";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const browser = { standalone: false, native: false };

describe("the home-screen app (H-626)", () => {
  it("offers the card on a phone's browser only", () => {
    expect(installKind(IPHONE, browser)).toBe("ios");
    expect(installKind(ANDROID, browser)).toBe("android");
    expect(installKind(ANDROID_TABLET, browser)).toBeNull();
    expect(installKind(IPAD, browser)).toBeNull();
    expect(installKind(DESKTOP, browser)).toBeNull();
  });

  it("never offers it inside the installed app or the store app", () => {
    expect(installKind(IPHONE, { standalone: true, native: false })).toBeNull();
    expect(installKind(ANDROID, { standalone: false, native: true })).toBeNull();
  });

  it("waits for the third separate day, and survives a bad stored value", () => {
    let days = seenDays(null, "2026-10-18");
    expect(readyToOffer(days)).toBe(false);
    days = seenDays(JSON.stringify(days), "2026-10-18");
    expect(days).toEqual(["2026-10-18"]);
    days = seenDays(JSON.stringify(days), "2026-10-19");
    expect(readyToOffer(days)).toBe(false);
    days = seenDays(JSON.stringify(days), "2026-10-21");
    expect(readyToOffer(days)).toBe(true);
    expect(seenDays("not json", "2026-10-18")).toEqual(["2026-10-18"]);
    expect(seenDays(JSON.stringify(["2026-10-01", 5, "x"]), "2026-10-02")).toEqual(["2026-10-01", "2026-10-02"]);
    expect(seenDays(JSON.stringify(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]), "2026-10-05")).toHaveLength(3);
  });

  it("names its cache for the build, safely", () => {
    expect(cacheName("abc1234")).toBe("helixos-offline-abc1234");
    expect(cacheName("")).toBe("helixos-offline-dev");
    expect(cacheName('a"b</script>')).toBe("helixos-offline-abscript");
  });

  it("only answers failed page loads, and never caches pages or API answers", () => {
    const sw = serviceWorkerSource("abc1234");
    expect(sw).toContain('const CACHE = "helixos-offline-abc1234"');
    expect(sw).toContain(`const OFFLINE = "${OFFLINE_PATH}"`);
    expect(sw).toContain('req.mode !== "navigate"');
    // The only thing ever written to the cache is the offline screen, at install.
    expect(sw.match(/cache\.(add|addAll|put)\(/g)).toEqual(["cache.add("]);
    expect(sw).not.toMatch(/\.put\(/);
  });

  it("serves the worker and the offline screen signed out", () => {
    const proxy = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(proxy).toMatch(/"\/sw\.js"/);
    expect(proxy).toMatch(/"\/offline"/);
  });
});
