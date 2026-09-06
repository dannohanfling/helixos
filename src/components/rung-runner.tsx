"use client";

import { useSyncExternalStore } from "react";

const TICK = 15000;
function subscribe(onChange: () => void) {
  const t = setInterval(onChange, TICK);
  return () => clearInterval(t);
}
/** The clock, quantised to the tick so the snapshot is stable between renders; null on the server so hydration matches. */
const getNow = () => Math.floor(Date.now() / TICK) * TICK;
const getServerNow = () => null;

/** The clock for the live hour: how long since the first rung, and whether the next one is due. The rung list and its forms are server-rendered. */
export function LiveClock({ postedCount, total, lastPostedAt, launchedAt, gapMinutes, nextN }: { postedCount: number; total: number; lastPostedAt: string | null; launchedAt: string | null; gapMinutes: number; nextN: number | null }) {
  const now = useSyncExternalStore(subscribe, getNow, getServerNow);
  // Until the browser takes over, the clock is unknown: static wording, nothing "due".
  const sinceLast = now !== null && lastPostedAt ? (now - new Date(lastPostedAt).getTime()) / 60000 : null;
  const sinceLaunch = now !== null && launchedAt ? (now - new Date(launchedAt).getTime()) / 60000 : null;
  const due = now !== null && (sinceLast === null || sinceLast >= gapMinutes);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2" data-testid="live-clock">
      <span className="badge badge-neutral">{postedCount}/{total} posted</span>
      {sinceLaunch !== null ? <span>· {Math.max(0, Math.round(sinceLaunch))} min since the first rung{sinceLaunch > 60 ? " · past the hour, wrap it up" : ""}</span> : <span>· one rung every {gapMinutes} min, all inside the first hour</span>}
      {nextN ? <span className={due ? "font-semibold text-good" : ""}>· next: rung {nextN} {due ? "now" : `in ${Math.max(1, Math.ceil(gapMinutes - (sinceLast ?? 0)))} min`}</span> : <span className="font-semibold text-good">· all rungs are up</span>}
    </div>
  );
}
