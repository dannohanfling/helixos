"use client";

import { useEffect } from "react";

/**
 * A personal page opened before the engine finished writing shows the default copy (H-15 gap 1). This looks again every few
 * seconds for up to two minutes, by asking for the same page and reading its data-copy mark, and reloads once the personal copy
 * is there. Never while the person is typing in the form: what they typed is never thrown away.
 */
export function AutoReload() {
  useEffect(() => {
    const started = Date.now();
    let typed = false;
    let stop = false;
    const onInput = () => {
      typed = true;
    };
    document.addEventListener("input", onInput);
    const look = async () => {
      if (stop || typed || Date.now() - started > 120_000) return;
      try {
        const html = await (await fetch(window.location.pathname, { cache: "no-store", credentials: "same-origin" })).text();
        if (!stop && !typed && html.includes('data-copy="personal"')) {
          window.location.reload();
          return;
        }
      } catch {
        // Offline for a moment: try again on the next round.
      }
      if (!stop) timer = setTimeout(look, 6000);
    };
    let timer = setTimeout(look, 4000);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("input", onInput);
    };
  }, []);
  return null;
}
