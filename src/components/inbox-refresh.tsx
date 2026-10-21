"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The Inbox number in the menu is drawn by the shell, which a soft navigation leaves as it was (H-1488): once this page has
 * marked the owner's messages read, one refresh redraws the shell with the right number, and so does coming back to the tab.
 */
export function InboxRefresh() {
  const router = useRouter();
  useEffect(() => {
    const go = () => {
      if (!document.hidden) router.refresh();
    };
    const t = setTimeout(go, 400);
    document.addEventListener("visibilitychange", go);
    window.addEventListener("focus", go);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", go);
      window.removeEventListener("focus", go);
    };
  }, [router]);
  return null;
}
