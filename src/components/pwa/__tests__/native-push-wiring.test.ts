import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The iPhone app hands Apple's push address to Capacitor only through these two AppDelegate methods. Without them the
// "registration" event never fires, HelixOS never stores the address, and Send me a test stays hidden (found 24 Oct).
describe("the iPhone app's push wiring", () => {
  it("forwards the push address, and a failure to get one, to Capacitor", () => {
    const swift = readFileSync(join(process.cwd(), "mobile/ios/App/App/AppDelegate.swift"), "utf8");
    expect(swift).toMatch(/didRegisterForRemoteNotificationsWithDeviceToken[\s\S]*\.capacitorDidRegisterForRemoteNotifications/);
    expect(swift).toMatch(/didFailToRegisterForRemoteNotificationsWithError[\s\S]*\.capacitorDidFailToRegisterForRemoteNotifications/);
  });
});
