"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The opening of the HelixOS app: only on a cold start, only inside the store app, and it never holds HelixOS back (the page
 * loads behind it all along). Its first frame is always the native logo screen itself, so when that hides underneath nothing
 * moves. A cold start is a new web view, so sessionStorage is empty; coming back from the background, page changes and a pull
 * to refresh keep it, and the opening doesn't replay.
 *
 * Which logo screen the phone shows depends on the build:
 * - Build 7 and later (H-1824) show the Golden hour still and say so in the user agent (SPLASH_MARK). The opening is the
 *   "Forged in gold" video (H-1819): it plays once, muted and inline, then fades into HelixOS. A tap skips it, and it is gone
 *   by CAP_MS whatever happens. With reduced motion, or when the video isn't playing within START_MS, the drawn gold sweep
 *   runs over the same still instead.
 * - Earlier builds show the medallion at 30% of the screen's height (H-1612): the drawn sweep (H-1759, plan H-1768), about
 *   1.2 s. The video would start with a jump there, so those builds keep the sweep.
 */
const SEEN = "helix.app.opened";
const DRAWN_MS = 1200;
const START_MS = 1000;
const CAP_MS = 4500;
const FADE_MS = 300;

/** Build 7 and later add this to the web view's user agent (mobile/capacitor.config.ts): their logo screen is the Golden hour still. */
export const SPLASH_MARK = "HelixSplash/2";
/** Versioned names: the files are cached for a year (next.config.ts), so a new cut gets a new name. */
export const FORGED = {
  mp4: "/app-opening/forged-v1.mp4",
  webm: "/app-opening/forged-v1.webm",
  poster: "/app-opening/forged-v1-poster.jpg",
} as const;
const MEDALLION = "/app-opening/medallion.webp";

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

type Look = "golden" | "medallion";
type Mode = "video" | "drawn";
type Phase = "off" | "on" | "out" | "done";

export function shouldPlayOpening(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return !storage?.getItem(SEEN);
  } catch {
    return false;
  }
}

/** The logo screen this build of the app shows while it starts. */
export function splashLook(userAgent: string): Look {
  return userAgent.includes(SPLASH_MARK) ? "golden" : "medallion";
}

/** The iPhone decodes H.264 in hardware; Android takes the smaller VP9 cut. */
export function videoSource(platform: string): string {
  return platform === "ios" ? FORGED.mp4 : FORGED.webm;
}

/** The video plays only over the Golden hour still, and never with reduced motion. */
export function openingMode(look: Look, reducedMotion: boolean): Mode {
  return look === "golden" && !reducedMotion ? "video" : "drawn";
}

export function AppOpening({ onFirstFrame }: { onFirstFrame: () => void }) {
  const [s, setS] = useState<{ phase: Phase; look: Look; mode: Mode; src: string }>({ phase: "off", look: "medallion", mode: "drawn", src: "" });
  const video = useRef<HTMLVideoElement>(null);
  // Never back from done: a late timer or event can only move the opening forward.
  const to = useCallback((phase: Phase) => setS((p) => (p.phase === "done" || (phase === "out" && p.phase !== "on") ? p : { ...p, phase })), []);

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
    const look = splashLook(navigator.userAgent);
    const mode = openingMode(look, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const platform = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ?? "";
    // Show the overlay only once its first frame is decoded (the native splash covers the wait), at most 500 ms; past that,
    // skip the opening and just let the page show, so it never adds waiting.
    let live = true;
    const img = new Image();
    img.src = look === "golden" ? FORGED.poster : MEDALLION;
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
            setS({ phase: "on", look, mode, src: mode === "video" ? videoSource(platform) : "" });
          });
        else onFirstFrame();
      });
    return () => {
      live = false;
    };
  }, [onFirstFrame]);

  // The overlay is painted: the native splash can hide now without a jump. Whatever happens next, it is gone by CAP_MS.
  useEffect(() => {
    if (s.phase !== "on") return;
    const paint = frameOr(100, onFirstFrame);
    const cap = window.setTimeout(() => to("out"), CAP_MS - FADE_MS);
    return () => {
      paint();
      window.clearTimeout(cap);
    };
  }, [s.phase, onFirstFrame, to]);

  // The drawn sweep runs its course (its CSS fades it out at the end).
  useEffect(() => {
    if (s.phase !== "on" || s.mode !== "drawn") return;
    const end = window.setTimeout(() => to("done"), DRAWN_MS);
    return () => window.clearTimeout(end);
  }, [s.phase, s.mode, to]);

  // The video: playing within START_MS or the sweep takes over; at its end it fades into HelixOS.
  useEffect(() => {
    const v = video.current;
    if (s.phase !== "on" || s.mode !== "video" || !v) return;
    const drawn = () => setS((p) => (p.phase === "on" && p.mode === "video" ? { ...p, mode: "drawn" } : p));
    const late = window.setTimeout(drawn, START_MS);
    const playing = () => window.clearTimeout(late);
    const ended = () => to("out");
    v.addEventListener("playing", playing);
    v.addEventListener("ended", ended);
    v.addEventListener("error", drawn);
    v.muted = true;
    v.defaultMuted = true;
    // Refused (an iPhone in Low Power Mode, say): the sweep instead.
    void v.play()?.catch(drawn);
    return () => {
      window.clearTimeout(late);
      v.removeEventListener("playing", playing);
      v.removeEventListener("ended", ended);
      v.removeEventListener("error", drawn);
    };
  }, [s.phase, s.mode, to]);

  useEffect(() => {
    if (s.phase !== "out") return;
    const end = window.setTimeout(() => to("done"), FADE_MS);
    return () => window.clearTimeout(end);
  }, [s.phase, to]);

  if (s.phase !== "on" && s.phase !== "out") return null;
  const cls = `helix-opening ${s.look} ${s.mode}${s.phase === "out" ? " out" : ""}`;
  return (
    <div className={cls} aria-hidden="true" data-testid="app-opening" data-look={s.look} data-mode={s.mode} onPointerDown={() => to("out")}>
      <style>{`
        .helix-opening { position: fixed; inset: 0; z-index: 2147483000; background: #111318; overflow: hidden; }
        .helix-opening.drawn { animation: helix-open-out 300ms ease-out 900ms forwards; }
        .helix-opening.medallion { display: grid; place-items: center; }
        .helix-opening .m { position: relative; width: 30vh; height: 30vh; max-width: 80vw; max-height: 80vw; }
        .helix-opening.drawn .m, .helix-opening.drawn .g { animation: helix-open-settle 900ms cubic-bezier(.33,0,.2,1) both; }
        .helix-opening .m img { width: 100%; height: 100%; display: block; }
        .helix-opening .m i { position: absolute; inset: 0; display: block;
          -webkit-mask: url(${MEDALLION}) center / contain no-repeat; mask: url(${MEDALLION}) center / contain no-repeat; }
        /* The Golden hour still, placed as the launch screen places it: full height, centred (cropped at the sides on a phone). */
        .helix-opening .g { position: absolute; top: 0; left: 50%; height: 100%; aspect-ratio: 9 / 16; translate: -50% 0; }
        .helix-opening .g img, .helix-opening .g video { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; }
        /* The medallion in the still: 49% of its width, dead centre. */
        .helix-opening .g i { position: absolute; left: 25.5%; top: 36.22%; width: 49%; aspect-ratio: 1; border-radius: 50%; display: block; }
        .helix-opening i { background: linear-gradient(105deg, transparent 35%, rgba(221,163,56,.0) 40%, rgba(255,231,170,.85) 50%, rgba(221,163,56,.0) 60%, transparent 65%) no-repeat;
          background-size: 250% 100%; background-position: 130% 0; mix-blend-mode: screen;
          animation: helix-open-sweep 800ms ease-in-out 80ms both; }
        @keyframes helix-open-sweep { from { background-position: 130% 0; } to { background-position: -30% 0; } }
        @keyframes helix-open-settle { 0% { transform: scale(1); } 45% { transform: scale(.96); } 100% { transform: scale(1); } }
        @keyframes helix-open-out { to { opacity: 0; visibility: hidden; } }
        @media (prefers-reduced-motion: reduce) {
          .helix-opening.drawn { animation: helix-open-out 300ms ease-out 200ms forwards; }
          .helix-opening.drawn .m, .helix-opening.drawn .g { animation: none; }
          .helix-opening i { display: none !important; }
        }
        .helix-opening.out { animation: helix-open-out ${FADE_MS}ms ease-out forwards; pointer-events: none; }
      `}</style>
      {s.look === "golden" ? (
        <div className="g">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local image that must paint on the very first frame */}
          <img src={FORGED.poster} alt="" width={720} height={1280} decoding="sync" />
          {s.mode === "video" ? (
            <video ref={video} src={s.src} poster={FORGED.poster} muted playsInline preload="auto" disablePictureInPicture disableRemotePlayback data-testid="app-opening-video" />
          ) : (
            <i />
          )}
        </div>
      ) : (
        <div className="m">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local image that must paint on the very first frame */}
          <img src={MEDALLION} alt="" width={512} height={512} decoding="sync" />
          <i />
        </div>
      )}
    </div>
  );
}
