"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { tabOfAnchor } from "@/lib/engine/settings-tabs";

/**
 * Settings in tabs (H-164 §16): a link or an action's return to /settings#<card> lands on that card's tab. The server never
 * sees the hash, so once mounted this reads it, and when the card isn't on the tab showing, it opens the right tab.
 */
export function SettingsHashTab({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    const anchor = decodeURIComponent(window.location.hash.slice(1));
    if (!anchor || document.getElementById(anchor)) return;
    const tab = tabOfAnchor(anchor);
    if (!tab || tab === current) return;
    const q = new URLSearchParams(window.location.search);
    q.set("tab", tab);
    router.replace(`/settings?${q}#${anchor}`);
  }, [current, router]);
  return null;
}
