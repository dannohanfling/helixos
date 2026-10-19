"use client";

/**
 * The streak fire (H-952): the filmed loops, Ember, Torch and Gold. This is the only file that draws the flame; the pill and
 * the sheet pass only a look, a place and the surge's start.
 *
 * - The pill plays the tier's pill loop, the sheet its stage loop: muted, looped, inline, on true black with a screen blend so
 *   the dark UI shows through.
 * - A video loads only once its box is laid out and on screen (a pill hidden by the layout loads nothing), so a page fetches
 *   just the current tier's pill; the stage file loads when the sheet opens. It pauses while the tab is hidden or the box is
 *   off screen.
 * - Waiting on you: the Ember loop at 60% brightness and 0.7x speed.
 * - The daily surge: a scale-up and extra glow drawn over the loop for 2.2 s.
 * - Reduced motion, or a video that won't play: the tier's still.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flameClip, surgeEnvelope, surgeLook, SURGE_SECONDS, type FlameLook } from "@/lib/engine/streak-flame";

const MOTION = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const mq = typeof window !== "undefined" ? window.matchMedia?.(MOTION) : null;
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
};
const readMotion = () => Boolean(typeof window !== "undefined" && window.matchMedia?.(MOTION).matches);

/** Laid out: the layout shows it (a `hidden` pill has no boxes). */
const laidOut = (el: Element) => el.getClientRects().length > 0;

export function Fire({ look, place, width, height, surgeAt = null, className = "" }: {
  look: FlameLook;
  place: "bar" | "stage";
  width: number;
  height: number;
  /** performance.now()/1000 when the surge started, or null. */
  surgeAt?: number | null;
  className?: string;
}) {
  const clip = flameClip(look, place);
  const quiet = useSyncExternalStore(subscribeMotion, readMotion, () => false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const visible = useRef(false);
  const still = quiet || failed;

  // Load once laid out and on screen; play only while it is and the tab is showing.
  useEffect(() => {
    const el = box.current;
    if (!el || still) return;
    const sync = () => {
      const v = video.current;
      if (!v) return;
      if (visible.current && !document.hidden) {
        v.playbackRate = clip.rate;
        void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      } else {
        v.pause();
        setPlaying(false);
      }
    };
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      visible.current = e.isIntersecting && laidOut(el);
      if (visible.current) setLoaded(true);
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    const v = video.current;
    v?.addEventListener("loadeddata", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      v?.removeEventListener("loadeddata", sync);
    };
  }, [still, loaded, clip.webm, clip.rate]);

  // The surge: drawn over the loop by the clock, then back to rest.
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const rest = () => {
      el.style.transform = "";
      el.style.filter = clip.brightness === 1 ? "" : `brightness(${clip.brightness})`;
    };
    if (surgeAt === null || quiet) {
      rest();
      return;
    }
    let raf = 0;
    const frame = () => {
      const since = performance.now() / 1000 - surgeAt;
      if (since >= SURGE_SECONDS) {
        rest();
        return;
      }
      const s = surgeLook(look, surgeEnvelope(since));
      el.style.transform = `scale(${s.scale.toFixed(3)})`;
      el.style.filter = `brightness(${(s.brightness * clip.brightness).toFixed(3)}) drop-shadow(0 0 ${(s.glow * 10).toFixed(1)}px rgba(255, 170, 70, ${(s.glow * 0.85).toFixed(2)}))`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [surgeAt, quiet, look, clip.brightness]);

  const fill = { width: "100%", height: "100%", objectFit: "cover" as const, objectPosition: "50% 100%", mixBlendMode: "screen" as const, display: "block" };
  const mode = still ? "still" : playing ? "video" : loaded ? "loading" : "idle";
  return (
    <span
      ref={box}
      aria-hidden="true"
      data-flame="fire"
      data-flame-mode={mode}
      data-flame-look={look}
      data-flame-place={place}
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width, height }}
    >
      <span ref={inner} className="block h-full w-full origin-bottom" style={clip.brightness === 1 ? undefined : { filter: `brightness(${clip.brightness})` }}>
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.still} alt="" style={fill} data-flame-still="true" />
        ) : (
          <video key={clip.webm} ref={video} muted loop playsInline preload={loaded ? "auto" : "none"} poster={loaded ? clip.still : undefined} style={fill} data-flame-video="true">
            {loaded ? <source src={clip.webm} type="video/webm" /> : null}
            {loaded ? <source src={clip.mp4} type="video/mp4" onError={() => setFailed(true)} /> : null}
          </video>
        )}
      </span>
    </span>
  );
}
