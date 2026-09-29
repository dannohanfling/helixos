/**
 * The version shown in the app (rev 193): the deploy date and the short commit, read at build time, never typed by hand. On
 * Vercel the commit is VERCEL_GIT_COMMIT_SHA; elsewhere it is the checkout's HEAD. The date is the build day in Pacific time,
 * where the academy runs. Plain module, no Next imports: next.config.ts reads it while the build starts.
 */
export type BuildInfo = { date: string; sha: string };

export function buildInfo(env: Record<string, string | undefined>, now: Date, gitHead: () => string | null = () => null): BuildInfo {
  const sha = (env.VERCEL_GIT_COMMIT_SHA || gitHead() || "").trim().slice(0, 7).toLowerCase();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).replaceAll("-", ".");
  return { date, sha: /^[0-9a-f]{7}$/.test(sha) ? sha : "dev" };
}

export const versionLabel = (b: BuildInfo): string => `HelixOS ${b.date} · ${b.sha}`;
