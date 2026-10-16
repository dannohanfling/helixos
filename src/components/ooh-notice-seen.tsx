"use client";

import { useEffect } from "react";
import { clearOohNoticeAction } from "@/lib/actions/office-hours";

/**
 * Once the owner has Office Hours open, the "booked for you" line has done its job (H-413): cleared on the server, so Today
 * and the next visit no longer carry it. This visit keeps the line on screen (no redraw) so it is read, not flashed.
 */
export function OohNoticeSeen({ pending }: { pending: boolean }) {
  useEffect(() => {
    if (!pending) return;
    void clearOohNoticeAction();
  }, [pending]);
  return null;
}
