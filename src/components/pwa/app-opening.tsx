"use client";

import { useEffect, useState } from "react";

/**
 * The opening of the HelixOS app (H-1759, plan H-1768): about 1.2 s, only on a cold start, only inside the store app.
 *
 * Its first frame is the native splash itself (the medallion at 30% of the screen's height on #111318, as the iPhone launch
 * screen draws it), so when the native splash hides underneath nothing moves. Then a gold light sweeps across the
 * medallion, it settles (1 → 0.96 → 1) and the whole thing fades into the page, which has been loading behind it all along:
 * it never holds HelixOS back. Reduced motion: a plain fade. A cold start is a new web view, so sessionStorage is empty;
 * coming back from the background, page changes and a pull to refresh keep it, and the opening doesn't replay.
 */
const SEEN = "helix.app.opened";
const TOTAL_MS = 1200;

/**
 * The next painted frame, or `ms` at the latest. Android holds its system splash by not drawing the app underneath, and a web
 * view that isn't drawing may not run frame callbacks, so a timer backs each one up and the splash can always hide.
 */
function frameOr(ms: number, fn: () => void): () => void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    window.cancelAnimationFrame(f);
    window.clearTimeout(t);
    fn();
  };
  const f = window.requestAnimationFrame(once);
  const t = window.setTimeout(once, ms);
  return () => {
    done = true;
    window.cancelAnimationFrame(f);
    window.clearTimeout(t);
  };
}

export function shouldPlayOpening(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return !storage?.getItem(SEEN);
  } catch {
    return false;
  }
}

export function AppOpening({ onFirstFrame }: { onFirstFrame: () => void }) {
  const [phase, setPhase] = useState<"off" | "on" | "done">("off");

  useEffect(() => {
    let store: Storage | null = null;
    try {
      store = window.sessionStorage;
    } catch {
      store = null;
    }
    if (!shouldPlayOpening(store)) {
      onFirstFrame();
      return;
    }
    // Show the overlay only once its medallion is decoded (the native splash covers the wait), at most 500 ms; past that, skip
    // the opening and just let the page show, so it never adds waiting.
    let live = true;
    const img = new Image();
    img.src = "/app-opening/medallion.webp";
    const ready = img.decode ? img.decode() : Promise.resolve();
    const timeout = new Promise<"late">((r) => window.setTimeout(() => r("late"), 500));
    void Promise.race([ready.then(() => "ok" as const), timeout])
      .catch(() => "late" as const)
      .then((r) => {
        if (!live) return;
        if (r === "ok")
          frameOr(100, () => {
            if (!live) return;
            // Marked seen only when it really shows, so a re-run of this effect (React's dev double run) can't skip it.
            try {
              store?.setItem(SEEN, "1");
            } catch {
              /* private mode: it simply plays */
            }
            setPhase("on");
          });
        else onFirstFrame();
      });
    return () => {
      live = false;
    };
  }, [onFirstFrame]);

  useEffect(() => {
    if (phase !== "on") return;
    // The overlay is painted: the native splash can hide now without a jump.
    const paint = frameOr(100, onFirstFrame);
    const end = window.setTimeout(() => setPhase("done"), TOTAL_MS);
    return () => {
      paint();
      window.clearTimeout(end);
    };
  }, [phase, onFirstFrame]);

  if (phase !== "on") return null;
  return (
    <div className="helix-opening" aria-hidden="true" data-testid="app-opening">
      <style>{`
        .helix-opening { position: fixed; inset: 0; z-index: 2147483000; background: #111318; display: grid; place-items: center;
          animation: helix-open-out 300ms ease-out 900ms forwards; pointer-events: none; }
        .helix-opening .m { position: relative; width: 30vh; height: 30vh; max-width: 80vw; max-height: 80vw;
          animation: helix-open-settle 900ms cubic-bezier(.33,0,.2,1) both; }
        .helix-opening .m img { width: 100%; height: 100%; display: block; }
        .helix-opening .m i { position: absolute; inset: 0; display: block;
          -webkit-mask: url(/app-opening/medallion.webp) center / contain no-repeat; mask: url(/app-opening/medallion.webp) center / contain no-repeat;
          background: linear-gradient(105deg, transparent 35%, rgba(221,163,56,.0) 40%, rgba(255,231,170,.85) 50%, rgba(221,163,56,.0) 60%, transparent 65%) no-repeat;
          background-size: 250% 100%; background-position: 130% 0; mix-blend-mode: screen;
          animation: helix-open-sweep 800ms ease-in-out 80ms both; }
        @keyframes helix-open-sweep { from { background-position: 130% 0; } to { background-position: -30% 0; } }
        @keyframes helix-open-settle { 0% { transform: scale(1); } 45% { transform: scale(.96); } 100% { transform: scale(1); } }
        @keyframes helix-open-out { to { opacity: 0; visibility: hidden; } }
        @media (prefers-reduced-motion: reduce) {
          .helix-opening { animation: helix-open-out 300ms ease-out 200ms forwards; }
          .helix-opening .m, .helix-opening .m i { animation: none; }
          .helix-opening .m i { display: none; }
        }
      `}</style>
      <div className="m">
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local image that must paint on the very first frame */}
        <img src="/app-opening/medallion.webp" alt="" width={512} height={512} decoding="sync" />
        <i />
      </div>
    </div>
  );
}
