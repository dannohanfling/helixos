/**
 * Where "Get the app" leads (H-655): three Vercel settings Danno sets, none of them secret. The TestFlight public link and the
 * Play testing link during the test phase, then the App Store and Play pages at release, with HELIXOS_APP_STAGE saying which.
 * Changing them and redeploying moves every member over; no code change. Until one is set, Get the app reads Coming soon (H-731).
 */
export type AppStage = "testing" | "store";
export type AppLinks = { ios: string | null; android: string | null; stage: AppStage };

/** Only an https address on the stores' own hosts: a typo or a stray value never becomes a link on a member's page. */
const HOSTS: Record<"ios" | "android", RegExp> = {
  ios: /^(testflight\.apple\.com|apps\.apple\.com)$/,
  android: /^play\.google\.com$/,
};

function storeUrl(raw: string | undefined, kind: "ios" | "android"): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && HOSTS[kind].test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

export function appLinksFrom(env: Record<string, string | undefined>): AppLinks {
  return {
    ios: storeUrl(env.HELIXOS_APP_IOS_URL, "ios"),
    android: storeUrl(env.HELIXOS_APP_ANDROID_URL, "android"),
    stage: env.HELIXOS_APP_STAGE === "store" ? "store" : "testing",
  };
}

export function appLinks(): AppLinks {
  return appLinksFrom(process.env);
}

/** Whether there's anything to install yet: the menu item is a link from then on, Coming soon before. */
export const appLinksOn = (l: AppLinks): boolean => Boolean(l.ios || l.android);

/** Which steps a browser gets, from its user agent: a phone sees only its own, a computer or iPad sees both. */
export type AppDevice = "ios" | "android" | "other";
export function appDevice(ua: string): AppDevice {
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** Apple's own TestFlight app on the App Store: step 1 of the iPhone test phase. */
export const TESTFLIGHT_APP_URL = "https://apps.apple.com/app/testflight/id899247664";

/** A member "has the app" while one of their phones opened it in the last 30 days: an uninstall can't be seen, so 30 days brings the link back. */
export const HAS_APP_DAYS = 30;
