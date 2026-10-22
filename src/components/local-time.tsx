"use client";

import { useSyncExternalStore } from "react";

const never = () => () => {};

/**
 * A stored instant in the reader's own zone (H-457), for a page with no signed-in viewer (the public leaderboard): the
 * server's words first, then the browser's own zone with its short name, "Oct 12, 1:32 PM GMT+11".
 */
export function LocalTime({ iso, fallback }: { iso: string; fallback: string }) {
  const text = useSyncExternalStore(
    never,
    () => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? fallback : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    },
    () => fallback,
  );
  return <span data-testid="local-time">{text}</span>;
}
