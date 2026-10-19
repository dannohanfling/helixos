"use client";

/**
 * The Council Chamber, alive (Roma Vivit 2, plan H-1060 PR 4): over the council photo and under the five seats, so every tap
 * still lands. Night: ten candle flames on the painted ones, a warm glow breathing under the braziers and tall candles, a faint
 * moonbeam in the far doorway, motes in the candlelight. Golden hour: light shafts from the right-hand arches, motes drifting
 * through them, a cloud shadow about once a minute. While an advisor's clip plays, the flames, glows, moonbeam, shafts and
 * cloud fade out for the turn (the clip has its own light) and only the motes stay. A hidden tab holds it; reduced motion draws
 * none of it. It only draws.
 */
import { COUNCIL_CLOUD_S, COUNCIL_FLAMES, COUNCIL_GLOWS, COUNCIL_MOONBEAM, COUNCIL_MOTES_DAY, COUNCIL_MOTES_NIGHT, COUNCIL_SHAFTS, type Mote } from "@/lib/engine/ambience";
import { useHidden, useQuiet } from "@/components/scene-life";
import { AmbienceFlame } from "@/components/ambience-flame";
import "@/components/ambience.css";

type Look = "day" | "night";
const s = (n: number) => `${n}s`;

const motes = (list: Mote[]) =>
  list.map((m, i) => (
    <span key={i} className="amb-mote" style={{ left: `${m.x}%`, top: `${m.y}%`, "--dx": `${m.dx}px`, "--dy": `${m.dy}px`, animationDuration: s(m.d), animationDelay: s(m.dl) } as React.CSSProperties} data-testid="amb-mote" />
  ));

export function BoardAmbience({ look, speaking }: { look: Look; speaking: boolean }) {
  const quiet = useQuiet();
  const hidden = useHidden();
  if (quiet) return null;
  return (
    <div className={`amb${hidden ? " amb-still" : ""}`} aria-hidden="true" data-testid="board-ambience" data-look={look} data-speaking={speaking ? "1" : "0"}>
      {/* The lit layer: what the clip already shows in its own light, so it steps aside while a clip plays. */}
      <div className={`amb-lit${speaking ? " amb-lit-off" : ""}`} data-testid="amb-lit">
        {look === "night" ? (
          <>
            <div className="amb-moon" style={{ left: `${COUNCIL_MOONBEAM.x}%`, top: 0, width: `${COUNCIL_MOONBEAM.w}%`, height: `${COUNCIL_MOONBEAM.h}%` }} data-testid="amb-moonbeam" />
            {COUNCIL_GLOWS.map((g, i) => (
              <div key={i} className="amb-cglow" style={{ left: `${g.x - g.r}%`, top: `calc(${g.y}% - ${g.r}cqw)`, width: `${g.r * 2}%`, aspectRatio: "1", animationDuration: s(g.d) }} data-testid="amb-glow" />
            ))}
            {COUNCIL_FLAMES.map((f, i) => (
              <div key={i} className="amb-flame amb-cf" style={{ left: `${f.x - f.w / 2}%`, top: `${f.y - f.h}%`, width: `${f.w}%`, height: `${f.h}%`, ["--fd" as string]: s(f.d), ["--fdl" as string]: s(f.dl) }} data-testid="amb-candle">
                <AmbienceFlame />
              </div>
            ))}
          </>
        ) : (
          <>
            {COUNCIL_SHAFTS.map((sh, i) => (
              <div key={i} className="amb-shaft" style={{ left: `${sh.x}%`, top: `${sh.y}%`, width: `${sh.w}%`, height: `${sh.h}%`, transform: `rotate(${sh.rot}deg)`, animationDuration: s(sh.d), animationDelay: s(sh.dl) }} data-testid="amb-shaft" />
            ))}
            <div className="amb-cloud amb-co-cloud" style={{ animationDuration: s(COUNCIL_CLOUD_S) }} data-testid="amb-cloud" />
          </>
        )}
      </div>
      {motes(look === "night" ? COUNCIL_MOTES_NIGHT : COUNCIL_MOTES_DAY)}
    </div>
  );
}
