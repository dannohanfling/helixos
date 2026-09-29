import { versionLabel } from "@/lib/build-info";

/** The running build's version (rev 193), inlined at build time by next.config.ts. */
export const APP_BUILD = { date: process.env.HELIX_BUILD_DATE ?? "dev", sha: process.env.HELIX_BUILD_SHA ?? "dev" };
export const APP_VERSION = versionLabel(APP_BUILD);
