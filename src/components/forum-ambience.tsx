"use client";

/**
 * The Forum, alive (H-327 §5, plan H-637 PR 3): over the photos, under the messengers and the plates. Night: three
 * high-contrast copies of the night photo, each clipped to a third and screen-blended, flicker so only the lit windows move;
 * a warm pool of light breathes over the plaza; the welcome's small flame burns on the centre column; fireflies drift in the
 * gardens. Golden hour: a loose flock of five birds flaps and glides over the plaza (H-966) and a cloud shadow passes. A hidden tab holds it; reduced motion
 * draws none of it. It only draws, and never takes a tap.
 */
import { FORUM_FIREFLIES, FORUM_FLAME, FORUM_FLICKER } from "@/lib/engine/ambience";
import { useHidden, useQuiet } from "@/components/scene-life";
import { AmbienceFlame } from "@/components/ambience-flame";
import "@/components/ambience.css";

type Look = "day" | "night";
const s = (n: number) => `${n}s`;

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
            <AmbienceFlame />
          </div>
          {FORUM_FIREFLIES.map((f, i) => (
            <span key={i} className="amb-ff" style={{ left: `${f.x}%`, top: `${f.y}%`, "--dx": `${f.dx}px`, "--dy": `${f.dy}px`, animationDuration: s(f.d), animationDelay: s(f.dl) } as React.CSSProperties} data-testid="amb-firefly" />
          ))}
        </>
      ) : (
        <>
          <div className="amb-cloud amb-fo-cloud" data-testid="amb-cloud" />
          {/* The drawn birds are off (H-1180) until the filmed golden-hour loop of the plaza replaces them. */}
        </>
      )}
    </div>
  );
}
