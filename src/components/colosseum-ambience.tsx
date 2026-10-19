"use client";

/**
 * The Colosseum, alive (H-327 §3, plan H-637 PR 1): under the orbiting avatars, over the photo. Night: three high-contrast copies
 * of the photo, each clipped to a third and screen-blended, flicker on their own timings so only the lit arches move; twelve city
 * lights twinkle round the rim; a warm haze drifts over the sand. Golden hour: a cloud shadow crosses about every 48 s, dust
 * drifts over the floor, three birds flap and glide across (H-966). Pause and a hidden tab hold it; reduced motion draws none of it. It only draws.
 */
import { COLOSSEUM_FLICKER, COLOSSEUM_FLIGHTS, COLOSSEUM_MOTES, COLOSSEUM_TWINKLES } from "@/lib/engine/ambience";
import { useHidden, useQuiet } from "@/components/scene-life";
import { Flock } from "@/components/flock";
import "@/components/ambience.css";

type Look = "day" | "night";
const s = (n: number) => `${n}s`;

export function ColosseumAmbience({ look, paused }: { look: Look; paused: boolean }) {
  const quiet = useQuiet();
  const hidden = useHidden();
  if (quiet) return null;
  return (
    <div className={`amb${paused || hidden ? " amb-still" : ""}`} aria-hidden="true" data-testid="arena-ambience" data-look={look}>
      {look === "night" ? (
        <>
          {COLOSSEUM_FLICKER.map((f, i) => (
            // The same picture as the scene's own, so the browser serves it from its cache: no second download.
            <picture key={i}>
              <source srcSet="/colosseum/colosseum-night.avif" type="image/avif" />
              <source srcSet="/colosseum/colosseum-night.webp" type="image/webp" />
              <img className="amb-fl" src="/colosseum/colosseum-night.jpg" alt="" decoding="async" style={{ clipPath: f.clip, animationDuration: s(f.d), animationDelay: s(f.dl) }} data-testid="amb-flicker" />
            </picture>
          ))}
          <div className="amb-haze" />
          {COLOSSEUM_TWINKLES.map((t, i) => (
            <span key={i} className="amb-tw" style={{ left: `${t.x}%`, top: `${t.y}%`, animationDuration: s(t.d), animationDelay: s(t.dl) }} data-testid="amb-twinkle" />
          ))}
        </>
      ) : (
        <>
          <div className="amb-cloud" data-testid="amb-cloud" />
          {COLOSSEUM_MOTES.map((m, i) => (
            <span key={i} className="amb-mote" style={{ left: `${m.x}%`, top: `${m.y}%`, "--dx": `${m.dx}px`, "--dy": `${m.dy}px`, animationDuration: s(m.d), animationDelay: s(m.dl) } as React.CSSProperties} data-testid="amb-mote" />
          ))}
          <Flock scene="co" flights={COLOSSEUM_FLIGHTS} />
        </>
      )}
    </div>
  );
}
