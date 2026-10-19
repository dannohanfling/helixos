"use client";

/**
 * The Forum, alive (H-327 §5, plan H-637 PR 3): over the photos, under the messengers and the plates. Night: three
 * high-contrast copies of the night photo, each clipped to a third and screen-blended, flicker so only the lit windows move;
 * a warm pool of light breathes over the plaza; the welcome's small flame burns on the centre column; fireflies drift in the
 * gardens. Golden hour: a loose flock of five birds flaps and glides over the plaza (H-966) and a cloud shadow passes. A hidden tab holds it; reduced motion
 * draws none of it. It only draws, and never takes a tap.
 */
import { FORUM_FIREFLIES, FORUM_FLIGHTS, FORUM_FLAME, FORUM_FLICKER } from "@/lib/engine/ambience";
import { useHidden, useQuiet } from "@/components/scene-life";
import { Flock } from "@/components/flock";
import "@/components/ambience.css";

type Look = "day" | "night";
const s = (n: number) => `${n}s`;

/** The welcome's flame (docs/welcome/daily-welcome-flame-v1.dc.html, as the Forum mockup draws it): three layers. */
function Flame() {
  return (
    <svg viewBox="0 0 80 96">
      <defs>
        <linearGradient id="amb-fo-outer" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#8E2F0C" />
          <stop offset=".25" stopColor="#D2531A" />
          <stop offset=".6" stopColor="#F28C2E" />
          <stop offset="1" stopColor="#FFB040" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="amb-fo-mid" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#F59A34" />
          <stop offset=".5" stopColor="#FFC45C" />
          <stop offset="1" stopColor="#FFD98A" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="amb-fo-core" cx=".5" cy=".7" r=".5">
          <stop offset="0" stopColor="#FFFBEF" />
          <stop offset=".5" stopColor="#FFE7A8" />
          <stop offset="1" stopColor="#FFD27A" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="amb-lv amb-l1">
        <path d="M40 4C43 17 58 26 63 42C68 60 63 76 53 85C47 91 33 91 27 85C17 76 12 60 17 44C20 34 29 28 32 18C35 26 36 31 38 34C39 24 37 13 40 4Z" fill="url(#amb-fo-outer)" />
      </g>
      <g className="amb-lv amb-l2">
        <path d="M40 28C43 38 53 45 55 58C57 71 51 81 40 86C29 81 23 71 25 58C27 49 33 45 35 39C37 43 38 45 39 47C39 41 39 34 40 28Z" fill="url(#amb-fo-mid)" />
      </g>
      <g className="amb-lv amb-l3">
        <ellipse cx="40" cy="72" rx="13" ry="14" fill="url(#amb-fo-core)" />
      </g>
    </svg>
  );
}

export function ForumAmbience({ look }: { look: Look }) {
  const quiet = useQuiet();
  const hidden = useHidden();
  if (quiet) return null;
  return (
    <div className={`amb${hidden ? " amb-still" : ""}`} aria-hidden="true" data-testid="forum-ambience" data-look={look}>
      {look === "night" ? (
        <>
          {FORUM_FLICKER.map((f, i) => (
            // The same picture as the map's own night photo, so the browser serves it from its cache: no second download.
            <picture key={i}>
              <source srcSet="/forum/forum-night.webp" type="image/webp" />
              <img className="amb-fl amb-fo-fl" src="/forum/forum-night.jpg" alt="" decoding="async" style={{ clipPath: f.clip, animationDuration: s(f.d), animationDelay: s(f.dl) }} data-testid="amb-flicker" />
            </picture>
          ))}
          <div className="amb-pool" data-testid="amb-pool" />
          <div className="amb-flame" style={{ left: `${FORUM_FLAME.x}%`, top: `${FORUM_FLAME.y}%`, width: `${FORUM_FLAME.w}%`, height: `${FORUM_FLAME.h}%` }} data-testid="amb-flame">
            <Flame />
          </div>
          {FORUM_FIREFLIES.map((f, i) => (
            <span key={i} className="amb-ff" style={{ left: `${f.x}%`, top: `${f.y}%`, "--dx": `${f.dx}px`, "--dy": `${f.dy}px`, animationDuration: s(f.d), animationDelay: s(f.dl) } as React.CSSProperties} data-testid="amb-firefly" />
          ))}
        </>
      ) : (
        <>
          <div className="amb-cloud amb-fo-cloud" data-testid="amb-cloud" />
          <Flock scene="fo" flights={FORUM_FLIGHTS} />
        </>
      )}
    </div>
  );
}
