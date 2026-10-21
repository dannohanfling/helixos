/**
 * Deep links for the HelixOS apps (H-626 Phase 2, plan H-877): the two files Apple and Google read to let these addresses
 * open in the app instead of the browser. Built from two Vercel settings Danno sets, neither of them secret:
 *  - HELIXOS_APPLE_TEAM_ID: the 10-character Team ID of the Apple account the app is published from;
 *  - HELIXOS_ANDROID_CERT_SHA256: the SHA-256 fingerprint of the Play app signing certificate (comma-separated for more).
 * Until a setting is there, its file is a 404, exactly as before.
 */
export const APP_ID = "com.evolveomega.helixos";

/** The addresses that open in the app. Anything else (the API, OAuth, funnel pages) stays in the browser. */
export const APP_PATHS = ["/today", "/tasks", "/tasks/*", "/calls", "/calls/*", "/reset/*", "/email-change/*", "/join/*", "/api/body/whoop/callback"];

const TEAM_ID = /^[A-Z0-9]{10}$/;
const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function appleAssociation(teamId: string | undefined): object | null {
  const team = (teamId ?? "").trim().toUpperCase();
  if (!TEAM_ID.test(team)) return null;
  return {
    applinks: {
      details: [{ appIDs: [`${team}.${APP_ID}`], components: APP_PATHS.map((p) => ({ "/": p })) }],
    },
    webcredentials: { apps: [`${team}.${APP_ID}`] },
  };
}

export function androidAssetLinks(fingerprints: string | undefined): object[] | null {
  const prints = (fingerprints ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => SHA256.test(f));
  if (!prints.length) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: APP_ID, sha256_cert_fingerprints: prints },
    },
  ];
}
