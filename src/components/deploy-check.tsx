"use client";

import { useEffect } from "react";
import { staleBuild } from "@/lib/engine/deploy-check";

/** Away at least this long before the return asks; and no more often than this. */
const AWAY_MS = 60_000;
const EVERY_MS = 5 * 60_000;

/**
 * A tab left open across a deploy (H-1623 item 8, Speed 2). On coming back after a minute or more away, it asks which build the
 * site runs. When that is newer than this tab's, the next click on a link loads the page in full, so the tab moves to the new
 * build cleanly instead of hanging on "Loading…". Nothing reloads under the member's hands: a half-typed form stays as it is.
 */
export function DeployCheck() {
  useEffect(() => {
    const mine = process.env.HELIX_BUILD_SHA ?? "dev";
    let hiddenAt = document.hidden ? Date.now() : 0;
    let askedAt = 0;
    let stale = false;
    const hardOnClick = (e: MouseEvent) => {
      if (!stale || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      e.preventDefault();
      location.assign(url.href);
    };
    const ask = async () => {
      askedAt = Date.now();
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      try {
        const r = await fetch("/api/version", { cache: "no-store", redirect: "manual", signal: ctl.signal });
        if (r.ok) stale = staleBuild(mine, ((await r.json()) as { sha?: string }).sha);
      } catch {
        // Offline or slow: nothing changes; the next return asks again.
      } finally {
        clearTimeout(t);
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away >= AWAY_MS && Date.now() - askedAt >= EVERY_MS) void ask();
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", hardOnClick, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", hardOnClick, true);
    };
  }, []);
  return null;
}
