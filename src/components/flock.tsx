/**
 * The birds over a golden-hour scene (H-966, plan H-971), shared by the Colosseum and the Forum. Each bird's path, heading, fade
 * and wing poses are CSS keyframes built by the engine (flightCss), so it runs on transforms and opacity with no script loop.
 * Each bird has a soft shadow on the ground below it, which flaps and turns with it.
 * The scene's own layer holds them: `.amb-still` pauses them, and under reduced motion the layer, birds and all, is not drawn.
 */
import { BIRD_BODY, BIRD_LOOK, BIRD_POSES, BIRD_SHADOW, flightCss, type FlightPlan } from "@/lib/engine/ambience";

const POSES = [
  ["up", "up"],
  ["lv", "level"],
  ["dn", "down"],
] as const;

export function Flock({ scene, flights }: { scene: string; flights: FlightPlan[] }) {
  const ids = flights.map((_, i) => `amb-${scene}-b${i}`);
  const css = flights.map((f, i) => flightCss(ids[i], f)).join("\n");
  return (
    <>
      <style>{css}</style>
      {flights.map((f, i) => {
        const id = ids[i];
        // The wings start part-way into their cycle too, so no two birds beat together.
        const wingDelay = -((i * 0.53) % f.cycle).toFixed(2);
        return (
          <div key={id} className="amb-flight" style={{ animation: `${id}-p ${f.d}s linear ${f.dl}s infinite` }} data-testid="amb-flight" data-flight-d={f.d} data-flight-k={f.k}>
            {(["shadow", "bird"] as const).map((part) => {
              const shadow = part === "shadow";
              return (
                <span
                  key={part}
                  className={shadow ? "amb-bird amb-bird-shadow" : "amb-bird"}
                  style={{
                    width: `clamp(${Math.round(16 * f.k)}px, ${(1.8 * f.k).toFixed(2)}vw, ${f.w}px)`,
                    animation: `${id}-h ${f.d}s linear ${f.dl}s infinite`,
                    ...(shadow ? { left: `${BIRD_SHADOW.dx}%`, top: `${BIRD_SHADOW.dy}%` } : {}),
                  }}
                  data-testid={shadow ? "amb-bird-shadow" : "amb-bird"}
                  data-cycle={f.cycle}
                >
                  <svg viewBox="0 0 40 40">
                    <g
                      fill={shadow ? BIRD_SHADOW.fill : BIRD_LOOK.fill}
                      fillOpacity={shadow ? BIRD_SHADOW.opacity : BIRD_LOOK.opacity}
                      stroke={shadow ? undefined : BIRD_LOOK.rim}
                      strokeOpacity={shadow ? undefined : BIRD_LOOK.rimOpacity}
                      strokeWidth={shadow ? undefined : BIRD_LOOK.rimWidth}
                      strokeLinejoin="round"
                      style={{ filter: `blur(${shadow ? BIRD_SHADOW.blur : BIRD_LOOK.blur}px)` }}
                    >
                      <path d={BIRD_BODY} />
                      {POSES.map(([short, pose]) => (
                        <path key={short} className="amb-pose" d={BIRD_POSES[pose]} style={{ animation: `${id}-${short} ${f.cycle}s step-end ${wingDelay}s infinite` }} data-pose={pose} />
                      ))}
                    </g>
                  </svg>
                </span>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
