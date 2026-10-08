"use client";

import { useEffect } from "react";

/**
 * Lands a hash link on a page that streams in (friction walk T6, 7 Oct: "Set your brand kit" went to /settings#brand-kit and
 * stopped at the top, because the card was not on the page when the browser looked for it). Once mounted, it scrolls to the
 * element the hash names, if there is one; no hash, nothing happens.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
