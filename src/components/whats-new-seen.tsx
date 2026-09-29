"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markWhatsNewSeenAction } from "@/lib/actions/whats-new";

/** Marks What's new as seen once the page is open, then redraws so the menu's dot goes (rev 193). */
export function WhatsNewSeen({ unseen }: { unseen: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!unseen) return;
    void markWhatsNewSeenAction().then(() => router.refresh());
  }, [unseen, router]);
  return null;
}
