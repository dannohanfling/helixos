"use client";

/**
 * A filmed loop over its own photo (H-1180): the scene's photo stays underneath as it is, and the loop, filmed from that photo
 * with the camera locked, sits over it in the same box at the same scale. Never a frozen look (the flame's rule, H-1063):
 * - The video is invisible until it fires `playing`, and goes back to invisible on `pause`; the photo shows through meanwhile.
 * - Only play() starts it (no autoplay attribute), and only while the box is on screen, the tab shows and the scene isn't
 *   paused; a refused play() (Low Power Mode, a slow line) leaves the photo.
 * - A file that won't load hides the video for good. Reduced motion: no video at all.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const MOTION = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const mq = typeof window !== "undefined" ? window.matchMedia?.(MOTION) : null;
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
};
const readMotion = () => Boolean(typeof window !== "undefined" && window.matchMedia?.(MOTION).matches);

export function LoopOverPhoto({ mp4, webm, held, className = "", testId }: { mp4: string; webm: string; held: boolean; className?: string; testId: string }) {
  // Quiet on the server and until hydrated: the photo is there either way.
  const quiet = useSyncExternalStore(subscribeMotion, readMotion, () => true);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [near, setNear] = useState(false);
  const box = useRef<HTMLVideoElement>(null);
  const onScreen = useRef(false);

  useEffect(() => {
    const v = box.current;
    if (!v || quiet || failed) return;
    const sync = () => {
      if (onScreen.current && !document.hidden && !held) void v.play().catch(() => undefined);
      else v.pause();
    };
    const io = new IntersectionObserver((entries) => {
      onScreen.current = entries[entries.length - 1].isIntersecting;
      if (onScreen.current) setNear(true);
      sync();
    });
    io.observe(v);
    const onPlaying = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    document.addEventListener("visibilitychange", sync);
    v.addEventListener("loadeddata", sync);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", onPause);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      v.removeEventListener("loadeddata", sync);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", onPause);
    };
  }, [quiet, failed, held, near, mp4]);

  if (quiet || failed) return null;
  return (
    <video
      key={mp4}
      ref={box}
      className={className}
      muted
      loop
      playsInline
      preload={near ? "auto" : "none"}
      aria-hidden="true"
      style={{ opacity: playing ? 1 : 0, transition: "opacity 240ms ease-out" }}
      data-testid={testId}
      data-loop-mode={playing ? "video" : near ? "loading" : "idle"}
    >
      {near ? <source src={mp4} type="video/mp4" /> : null}
      {near ? <source src={webm} type="video/webm" onError={() => setFailed(true)} /> : null}
    </video>
  );
}
