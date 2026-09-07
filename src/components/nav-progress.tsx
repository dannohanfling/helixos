"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar along the top the moment any in-app link is tapped, gone when the new page has arrived. Native navigation
 * gives no signal on its own; this is the signal. External links, new tabs and modified clicks are left alone.
 * The bar is "armed for" the route it was tapped on, so it switches off by itself when the route changes.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const here = `${pathname}?${search.toString()}`;
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const active = armedFor === here;
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page or a #hash
      setArmedFor(`${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setArmedFor(null), 12000); // never stuck
    return () => window.clearTimeout(id);
  }, [active]);
  return <div className={`nav-progress ${active ? "is-active" : ""}`} aria-hidden="true" data-testid="nav-progress" data-active={active ? "1" : "0"} />;
}
