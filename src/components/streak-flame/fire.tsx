"use client";

/**
 * The streak fire (H-952): the filmed loops, Ember, Torch and Gold. This is the only file that draws the flame; the pill and
 * the sheet pass only a look, a place and the surge's start.
 *
 * Never a frozen look (H-1063):
 * - The poster (the loop's first frame on a phone, the tier's still on a computer) is a plain image, there on first paint.
 * - The video sits over it, invisible, and fades in only once it fires `playing`. If it never plays (Low Power Mode, a slow
 *   connection, autoplay refused), the poster simply stays.
 * - A phone gets the light copies (MP4 only); a computer the full loops, MP4 first then WebM.
 * - Nothing is drawn on the video itself: no blend mode, no filter. The waiting ember is a dark layer over the flame at 0.7x
 *   speed; the surge scales the wrapper and brightens a soft glow layer behind it.
 * - A video loads once its box is laid out and on screen (a pill hidden by the layout loads nothing), and pauses while the tab
 *   is hidden or the box is off screen. Reduced motion: the tier's still, and no video at all.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flameClip, surgeEnvelope, surgeLook, SURGE_SECONDS, type FlameLook } from "@/lib/engine/streak-flame";

const MOTION = "(prefers-reduced-motion: reduce)";
/** A phone: a narrow screen or a finger for a pointer. */
export const PHONE = "(max-width: 767px), (pointer: coarse)";
const subscribeTo = (query: string) => (cb: () => void) => {
  const mq = typeof window !== "undefined" ? window.matchMedia?.(query) : null;
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
};
const readOf = (query: string) => () => Boolean(typeof window !== "undefined" && window.matchMedia?.(query).matches);
const subscribeMotion = subscribeTo(MOTION);
const readMotion = readOf(MOTION);
const subscribePhone = subscribeTo(PHONE);
const readPhone = readOf(PHONE);

/** Whether this screen gets the phone copies; false on the server, then the real answer once hydrated. */
export function usePhoneFlame(): boolean {
  return useSyncExternalStore(subscribePhone, readPhone, () => false);
}

/** Starts fetching a stage loop and its poster ahead of the sheet (on the pill's press), so the sheet opens on them. */
export function warmStage(look: FlameLook): void {
  const clip = flameClip(look, "stage", readPhone());
  const img = new Image();
  img.src = clip.poster;
  void fetch(clip.mp4).catch(() => undefined);
}

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
  const mobile = usePhoneFlame();
  const clip = flameClip(look, place, mobile);
  const quiet = useSyncExternalStore(subscribeMotion, readMotion, () => false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Which file has fired `playing`; a new file (another look, the phone copy after hydration) starts hidden again.
  const [playingSrc, setPlayingSrc] = useState<string | null>(null);
  const playing = playingSrc === clip.mp4;
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const visible = useRef(false);
  const still = quiet || failed;

  // Load once laid out and on screen; play only while it is and the tab is showing.
  useEffect(() => {
    const el = box.current;
    if (!el || still) return;
    const v = video.current;
    const src = clip.mp4;
    const sync = () => {
      if (!v) return;
      if (visible.current && !document.hidden) {
        v.playbackRate = clip.rate;
        void v.play().catch(() => undefined);
      } else {
        v.pause();
      }
    };
    const onPlaying = () => setPlayingSrc(src);
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      visible.current = e.isIntersecting && laidOut(el);
      if (visible.current) setLoaded(true);
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    v?.addEventListener("loadeddata", sync);
    v?.addEventListener("playing", onPlaying);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      v?.removeEventListener("loadeddata", sync);
      v?.removeEventListener("playing", onPlaying);
    };
  }, [still, loaded, clip.mp4, clip.rate]);

  // The surge: the wrapper scales and the glow layer behind it brightens, by the clock, then back to rest.
  useEffect(() => {
    const el = inner.current;
    const g = glow.current;
    if (!el || !g) return;
    const rest = () => {
      el.style.transform = "";
      g.style.opacity = "0";
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
      g.style.opacity = (s.glow * 0.9).toFixed(2);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [surgeAt, quiet, look]);

  const fill = { position: "absolute" as const, inset: 0, width: "100%", height: "100%", objectFit: "cover" as const, objectPosition: "50% 100%", display: "block" };
  const mode = still ? "still" : playing ? "video" : loaded ? "loading" : "idle";
  return (
    <span
      ref={box}
      aria-hidden="true"
      data-flame="fire"
      data-flame-mode={mode}
      data-flame-look={look}
      data-flame-place={place}
      data-flame-phone={mobile ? "true" : "false"}
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width, height }}
    >
      <span
        ref={glow}
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{ opacity: 0, transform: "scale(1.25)", background: "radial-gradient(closest-side, rgba(255, 170, 70, 0.75), rgba(255, 120, 40, 0.25) 60%, transparent)" }}
        data-flame-glow="true"
      />
      <span ref={inner} className="relative block h-full w-full origin-bottom">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={still ? clip.still : clip.poster} alt="" style={fill} decoding="async" data-flame-poster="true" data-flame-still={still ? "true" : undefined} />
        {still ? null : (
          <video
            key={clip.mp4}
            ref={video}
            muted
            loop
            playsInline
            autoPlay
            preload={loaded ? "auto" : "none"}
            style={{ ...fill, opacity: playing ? 1 : 0, transition: "opacity 180ms ease-out" }}
            data-flame-video="true"
          >
            {loaded ? <source src={clip.mp4} type="video/mp4" onError={clip.webm ? undefined : () => setFailed(true)} /> : null}
            {loaded && clip.webm ? <source src={clip.webm} type="video/webm" onError={() => setFailed(true)} /> : null}
          </video>
        )}
        {clip.dim > 0 ? <span className="pointer-events-none absolute inset-0" style={{ background: `rgba(0, 0, 0, ${clip.dim})` }} data-flame-dim="true" /> : null}
      </span>
    </span>
  );
}
