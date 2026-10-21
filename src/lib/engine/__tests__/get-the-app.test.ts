import { describe, expect, it } from "vitest";
import { appDevice, appLinksFrom, appLinksOn } from "@/lib/app-links";
import { NAV, navVisible, visibleGroups } from "@/components/nav-groups";

describe("Get the app: the links Danno sets (H-655)", () => {
  it("is off until a store link is set, and the stage defaults to testing", () => {
    const l = appLinksFrom({});
    expect(l).toEqual({ ios: null, android: null, stage: "testing" });
    expect(appLinksOn(l)).toBe(false);
  });
  it("takes the TestFlight, App Store and Play addresses, each for its own phone", () => {
    const l = appLinksFrom({ HELIXOS_APP_IOS_URL: "https://testflight.apple.com/join/ABCdef12", HELIXOS_APP_ANDROID_URL: " https://play.google.com/apps/testing/com.evolveomega.helixos ", HELIXOS_APP_STAGE: "store" });
    expect(l.ios).toBe("https://testflight.apple.com/join/ABCdef12");
    expect(l.android).toBe("https://play.google.com/apps/testing/com.evolveomega.helixos");
    expect(l.stage).toBe("store");
    expect(appLinksOn(l)).toBe(true);
    expect(appLinksFrom({ HELIXOS_APP_IOS_URL: "https://apps.apple.com/app/id123" }).ios).toBe("https://apps.apple.com/app/id123");
  });
  it("never makes a link of a typo, plain http, another host or an Android link in the iPhone slot", () => {
    expect(appLinksFrom({ HELIXOS_APP_IOS_URL: "testflight.apple.com/join/x" }).ios).toBeNull();
    expect(appLinksFrom({ HELIXOS_APP_IOS_URL: "http://testflight.apple.com/join/x" }).ios).toBeNull();
    expect(appLinksFrom({ HELIXOS_APP_IOS_URL: "https://example.com/join/x" }).ios).toBeNull();
    expect(appLinksFrom({ HELIXOS_APP_IOS_URL: "https://play.google.com/store/apps/details?id=x" }).ios).toBeNull();
    expect(appLinksFrom({ HELIXOS_APP_ANDROID_URL: "https://play.google.com.evil.example/x" }).android).toBeNull();
    expect(appLinksFrom({ HELIXOS_APP_STAGE: "beta" }).stage).toBe("testing");
  });
  it("shows each phone its own steps, and a computer or iPad both", () => {
    expect(appDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios");
    expect(appDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile")).toBe("android");
    expect(appDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("other");
  });
});

describe("Get the app in the menu (H-655, H-731)", () => {
  const client = { role: "client" as const, passEnabled: false, bodyEnabled: false };
  const coach = { role: "coach" as const, passEnabled: false, bodyEnabled: false };
  const item = (m: Parameters<typeof visibleGroups>[0]) => visibleGroups(m).flatMap((g) => g.items).find((n) => n.href === "/get-the-app");
  it("is Coming soon for clients and coaches until a link is set, then a link", () => {
    expect(item(client)).toMatchObject({ label: "Get the app", comingSoon: true });
    expect(item(coach)).toMatchObject({ comingSoon: true });
    expect(item({ ...client, appLinks: true })).toMatchObject({ comingSoon: false });
  });
  it("is gone once the member has the app, and never shown to a team member", () => {
    expect(item({ ...client, appLinks: true, hasApp: true })).toBeUndefined();
    expect(item({ ...client, hasApp: true })).toBeUndefined();
    const n = NAV.find((x) => x.href === "/get-the-app")!;
    expect(navVisible(n, { ...coach, team: true })).toBe(false);
  });
});
