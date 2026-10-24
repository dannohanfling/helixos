import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The app's offline screen and when it shows (H-1806, plan H-1813). The native parts build in the phone-app workflows; these
// checks keep their wiring from coming undone.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the app's offline screen (H-1813)", () => {
  it("is dark like the logo screen, with one big gold Try again that also fires on reconnect", () => {
    const html = read("mobile/www/offline.html");
    expect(html).toContain("--bg: #111318");
    expect(html).not.toContain("#f6f5f1");
    expect(html).toMatch(/button \{ display: block; width: 100%; min-height: 52px;/);
    expect(html).toContain('window.addEventListener("online", again)');
    expect(html).toContain("SplashScreen");
    expect(html).not.toContain("—");
    // H-1966: the Golden hour medallion, bundled beside the page (no network when this shows).
    expect(html).toContain('src="golden-medallion.webp"');
  });

  it("shows only when HelixOS can't be reached: the iPhone ignores interrupted loads and retries once", () => {
    const swift = read("mobile/ios/App/App/HelixBridgeViewController.swift");
    expect(swift).toContain("NSURLErrorCancelled");
    expect(swift).toContain("retryDelay: TimeInterval = 1.5");
    expect(read("mobile/ios/App/App/SceneDelegate.swift")).toContain("rootViewController = HelixBridgeViewController()");
    const project = read("mobile/ios/App/App.xcodeproj/project.pbxproj");
    expect(project.match(/HelixBridgeViewController\.swift in Sources/g)?.length).toBe(2);
  });

  it("and Android shows server error pages as they are, ignores interrupted loads and retries once", () => {
    const java = read("mobile/android/app/src/main/java/com/evolveomega/helixos/HelixWebViewClient.java");
    expect(java).toContain("ERR_ABORTED");
    expect(java).toContain("RETRY_DELAY_MS = 1500");
    expect(java).toMatch(/onReceivedHttpError[\s\S]*isForMainFrame[\s\S]*not offline/);
    expect(read("mobile/android/app/src/main/java/com/evolveomega/helixos/MainActivity.java")).toContain("new HelixWebViewClient(bridge)");
  });
});
