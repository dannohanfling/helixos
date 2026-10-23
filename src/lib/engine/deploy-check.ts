/**
 * Whether the site now runs a different build from this tab's (Speed 2). Only two real short commits that differ count: a local
 * "dev" build, or an answer that isn't a commit, never makes a tab load in full.
 */
export function staleBuild(mine: string, live: unknown): boolean {
  const real = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{7}$/.test(s);
  return real(mine) && real(live) && mine !== live;
}
