import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The HelixOS apps (H-626 Phase 2, plan H-877). One codebase: the app opens the live web app, and adds what a website
 * can't (push, haptics, the icon badge, deep links, a bundled offline screen).
 *
 * HELIXOS_APP_URL points a test build at a Vercel Preview; store builds always use the live site.
 */
const url = process.env.HELIXOS_APP_URL || "https://helixos.evolveomega.com";
const host = new URL(url).host;

const config: CapacitorConfig = {
  appId: "com.evolveomega.helixos",
  appName: "HelixOS",
  // Bundled pages: the offline screen and the first frame while the live site loads. Nothing else ships in the app.
  webDir: "www",
  server: {
    url,
    // Only HelixOS itself loads inside the app; any other link opens in the phone's browser.
    allowNavigation: [host],
    // When the live site can't be reached, the app shows the bundled offline screen instead of an error page.
    errorPath: "offline.html",
    androidScheme: "https",
  },
  backgroundColor: "#111318",
  ios: {
    // The web app pads itself with env(safe-area-inset-*) (Phase 1), so the web view runs edge to edge.
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: true,
    scheme: "HelixOS",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // The medallion on the dark field (H-1612), held about a second while the live site loads, then a soft fade.
    SplashScreen: {
      launchShowDuration: 1000,
      launchFadeOutDuration: 300,
      launchAutoHide: true,
      backgroundColor: "#111318",
      showSpinner: false,
    },
    PushNotifications: {
      // The app never asks on open: the HelixOS card after the first evening close (H-767), or the member's own tap on
      // Allow in Settings → Notifications (H-1612).
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
