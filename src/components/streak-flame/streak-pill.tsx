"use client";

/**
 * The streak pill and its detail sheet (H-552, plan H-558). The pill replaces the old 🔥 badge: on a phone at the right of the
 * top bar, on a computer in the sidebar's foot by the member's name (above Settings when the sidebar is folded). It shows the
 * fire and the count; tapping it opens the sheet with the fire large, the count, the tier and the days to the next one.
 *
 * The daily surge plays once per streak day, on the first open after the day has counted: the fire swells for 2.2 s and the
 * count ticks up by one. Only the pill the layout actually shows plays it (the others are hidden by the layout), and it waits
 * for the daily welcome or the first arrival to close. Reduced motion: no surge; the day is still marked seen.
 *
 * While the day waits, the sheet's main button goes to the close on Today, "Close the day" (or "Close yesterday" in the late
 * window), and a separate "Not now" dismisses it (H-927: a lone "Close" read as closing the day and only shut the sheet).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Fire, warmStage } from "./fire";
import { playTick } from "@/lib/synth-sounds";
import { WELCOME_CLOSED } from "@/components/rank-up";
import { ARRIVAL_CLOSED } from "@/components/first-arrival";
import { flameLabel, nextTierLine, sheetAction, tierName, type FlameState } from "@/lib/engine/streak-flame";
import { lbSerif } from "@/components/leaderboard/fonts";
import "./streak-flame.css";

export type PillPlace = "bar" | "side" | "rail";

/** Stores the day's surge as played: a plain request, kept out of the router's action queue (see the route). */
function markSurgeSeen(day: string): void {
  void fetch("/api/streak-flame/seen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ day }), keepalive: true }).catch(() => undefined);
}

/** How long after the open the surge starts when nothing else is on screen, and when the count ticks within it. */
const SURGE_DELAY_MS = 600;
const TICK_AT_MS = 450;

export function StreakPill({ state, place, afterWelcome = false }: { state: FlameState; place: PillPlace; afterWelcome?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // While a surge is pending the count shows yesterday's number; it ticks up when the surge plays (or at once when it won't).
  const [ticked, setTicked] = useState(false);
  const shown = state.surge && !ticked ? Math.max(0, state.days - 1) : state.days;
  const [ticking, setTicking] = useState(false);
  const [surgeAt, setSurgeAt] = useState<number | null>(null);
  const started = useRef(false);
  const look = state.waiting ? "risk" : state.tier;

  useEffect(() => {
    if (!state.surge) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const el = btn.current;
    const still = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    // Only the pill the layout shows plays the surge; the hidden ones just show the count.
    if (!el || el.getClientRects().length === 0 || still) {
      if (el && el.getClientRects().length > 0) markSurgeSeen(state.day);
      timers.push(setTimeout(() => setTicked(true), 0));
      return () => timers.forEach(clearTimeout);
    }
    const play = () => {
      if (started.current) return;
      started.current = true;
      markSurgeSeen(state.day);
      setSurgeAt(performance.now() / 1000);
      timers.push(
        setTimeout(() => {
          setTicked(true);
          setTicking(true);
          // H-651: one soft tick as the count goes up (after a tap only, like every scene sound).
          playTick(0.5);
        }, TICK_AT_MS),
      );
      timers.push(setTimeout(() => setTicking(false), TICK_AT_MS + 900));
    };
    const soon = () => timers.push(setTimeout(play, SURGE_DELAY_MS));
    window.addEventListener(WELCOME_CLOSED, soon);
    window.addEventListener(ARRIVAL_CLOSED, soon);
    if (!afterWelcome) soon();
    return () => {
      window.removeEventListener(WELCOME_CLOSED, soon);
      window.removeEventListener(ARRIVAL_CLOSED, soon);
      timers.forEach(clearTimeout);
    };
  }, [state.surge, state.day, afterWelcome]);

  const rail = place === "rail";
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen(true)}
        // The stage loop starts loading on the press, not the release, so the sheet opens on it (H-1063).
        onPointerDown={() => warmStage(look)}
        aria-label={flameLabel(state.days)}
        title={state.waiting ? `${flameLabel(state.days)}. Waiting on you` : flameLabel(state.days)}
        aria-haspopup="dialog"
        data-testid={`streak-pill-${place}`}
        data-waiting={state.waiting ? "true" : "false"}
        data-late={state.late ? "true" : "false"}
        data-surge={surgeAt !== null ? "playing" : state.surge ? "due" : "none"}
        className={`sf-pill shrink-0 overflow-hidden max-w-full rounded-full border ${rail ? "flex w-11 flex-col items-center px-0 py-1" : "flex min-h-11 items-center gap-1 py-0.5 pl-1.5 pr-3"}`}
      >
        <Fire look={look} place="bar" width={rail ? 24 : 30} height={rail ? 30 : 38} surgeAt={surgeAt} />
        <span className={`inline-flex items-center overflow-hidden ${rail ? "h-4" : "h-5"}`}>
          <span key={shown} className={`tabular font-bold ${rail ? "text-xs leading-4" : "text-base leading-5"} ${state.waiting ? "sf-muted" : ""} ${ticking ? "sf-tick" : ""}`} data-testid="streak-count">
            {shown}
          </span>
        </span>
        {state.waiting && place === "bar" ? (
          <span className="sf-chip ml-1 hidden whitespace-nowrap rounded-full border px-1.5 text-[11px] font-semibold leading-4 min-[400px]:inline" data-testid="streak-waiting">
            Waiting on you
          </span>
        ) : null}
        {/* The sidebar's row has no room for the words (they ran past its edge): an amber dot, the words for screen readers. */}
        {state.waiting && place === "side" ? (
          <span className="ml-1 inline-flex items-center" data-testid="streak-waiting">
            <span className="sf-dot block h-2 w-2 rounded-full" aria-hidden="true" />
            <span className="sr-only">Waiting on you</span>
          </span>
        ) : null}
      </button>
      {open ? <StreakSheet state={state} onClose={() => { setOpen(false); btn.current?.focus(); }} /> : null}
    </>
  );
}

function StreakSheet({ state, onClose }: { state: FlameState; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const act = useRef<HTMLAnchorElement>(null);
  const action = sheetAction(state);
  useEffect(() => {
    (act.current ?? close.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const look = state.waiting ? "risk" : state.tier;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose} data-testid="streak-sheet-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="streak-sheet-title"
        className="sf-stage relative w-full max-w-md overflow-hidden rounded-t-2xl border sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="streak-sheet"
      >
        {/* The stage loop, 16:9 on the dark stage: its poster at once, the loop fading in once it plays (H-952, H-1063). */}
        <div className="flex items-end justify-center px-4 pt-6">
          <Fire look={look} place="stage" width={336} height={189} className="max-w-full" />
        </div>
        <div className="px-6 pb-6 pt-2 text-center">
          <div className={`${lbSerif.className} sf-count text-7xl font-semibold leading-none`} data-testid="streak-sheet-count">
            {state.days}
          </div>
          <h2 id="streak-sheet-title" className="sf-eyebrow mt-2 text-xs font-bold uppercase tracking-[0.3em]">
            Day streak
          </h2>
          <div className="mt-4 text-sm font-semibold" data-testid="streak-sheet-tier">
            {tierName(state.tier)}
          </div>
          <div className="sf-muted mt-1 text-sm" data-testid="streak-sheet-next">
            {nextTierLine(state.days)}
          </div>
          {state.waiting ? (
            <p className="mt-4 text-sm" data-testid="streak-sheet-waiting">
              <span className="sf-chip mr-2 inline-block rounded-full border px-2 text-xs font-semibold leading-5">Waiting on you</span>
              Close out today to keep your {state.days}-day streak.
            </p>
          ) : (
            <p className={`${lbSerif.className} sf-muted mt-4 text-lg italic`}>The fire is yours to keep lit.</p>
          )}
          {action ? (
            <>
              <Link ref={act} href={action.href} onClick={onClose} className="btn btn-accent mt-5 flex min-h-11 w-full items-center justify-center rounded-full px-4 text-sm font-semibold" data-testid="streak-sheet-act">
                {action.label}
              </Link>
              <button ref={close} type="button" onClick={onClose} className="sf-muted mt-2 min-h-11 w-full rounded-full px-4 text-sm font-semibold underline-offset-4 hover:underline" data-testid="streak-sheet-close">
                Not now
              </button>
            </>
          ) : (
            <button ref={close} type="button" onClick={onClose} className="sf-close mt-5 min-h-11 w-full rounded-full border px-4 text-sm font-semibold" data-testid="streak-sheet-close">
              Close
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
