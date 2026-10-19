"use client";

/**
 * The scene (rev 711 §3 and §4): the picture for the leak and the look, and one SVG in its coordinates (viewBox 0 0 1680 944)
 * on top: the water along the channel, each segment as wide as its stage's count (H-966: a see-through body with ripple bands,
 * streaks and sparkles running over it, and a front that fills the channel when the scene opens); the leak's waterfall, a
 * sheet with falling streaks and a splash in the pool, matched to the one painted in; the stage pills and the step tags (hidden under 760px, the
 * table carries the numbers). Pause is remembered; reduced motion stops everything; the tab hidden pauses it. A picture that
 * fails to load hides itself.
 */
import { useEffect, useRef, useState } from "react";
import { setAqueductPausedAction } from "@/lib/actions/aqueduct";
import { setSceneLookAction } from "@/lib/actions/scene";
import { BODY, CHANNEL, CHANNEL_LENGTH, FALLS, FILL_SECONDS, FLOW, flowWidth, frontReaches, LEAK_TAG, PICTURE, pct, pictureFor, SEGMENTS, STAGE_TAG_AT, STAGES, STEP_TAG_AT, WATER, waterWidth, type Counts, type Leak } from "@/lib/engine/aqueduct";
import type { SceneLook } from "@/lib/engine/board-view";
import type { Repair } from "@/lib/engine/aqueduct-repair";
import { AqueductFountain, AqueductRepairCard, AqueductRepairLayer, FallingSheet, Splash, WaterDefs } from "@/components/aqueduct-repair";
import { useQuiet } from "@/components/scene-life";

type StepRate = { step: number; label: string; rate: number | null; leak: boolean };

export function AqueductScene({ initialLook, initialPaused, ownLook, now, leak, stepRates, repair = null, stamp = false }: { initialLook: SceneLook; initialPaused: boolean; ownLook: boolean; now: Counts; leak: Leak | null; stepRates: StepRate[]; repair?: Repair | null; stamp?: boolean }) {
  const [look, setLook] = useState<SceneLook>(initialLook);
  const [paused, setPaused] = useState(initialPaused);
  const [hidden, setHidden] = useState(false);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const photo = useRef<HTMLImageElement>(null);
  const picture = pictureFor(look, leak);
  const still = paused || hidden;
  const water = WATER[look];
  const fall = leak ? FALLS[look][leak.step] : null;
  // The repair moment (H-637 PR 2): the old leak's picture under the current one while it plays; the card until closed.
  const quiet = useQuiet();
  // The channel fills when the scene opens (H-966): not under a repair (it has its own moment), not when the water was left
  // paused, never under reduced motion. Once the front is through, the mask goes.
  const [filling, setFilling] = useState(!initialPaused && !repair);
  const fill = filling && !quiet;
  const [card, setCard] = useState(Boolean(repair));
  const oldPicture = repair ? pictureFor(look, { step: repair.step, nowRate: 0, wasRate: 0, drop: 0 }) : null;
  const stamped = useRef(false);
  // The "repair seen" marker: written once the repair starts in a tab the member is looking at, or straight away when only
  // the leak moved. The server reads the leak again itself; nothing is sent from here.
  useEffect(() => {
    // document.hidden too: on the first commit the hidden state hasn't caught up with a tab that opened hidden.
    if (stamped.current || (!stamp && !repair) || (repair && (hidden || document.hidden))) return;
    stamped.current = true;
    void fetch("/api/aqueduct/seen", { method: "POST", keepalive: true }).catch(() => undefined);
  }, [stamp, repair, hidden]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    // A tab that opens hidden starts held (H-637 PR 2): the water waits, and so does a repair.
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  // A picture that failed before React attached its handler (the error fires while the HTML loads) is caught here.
  useEffect(() => {
    const el = photo.current;
    if (el && el.complete && el.naturalWidth === 0) setBroken((b) => new Set(b).add(picture));
  }, [picture]);

  const pill = (x: number, y: number, text: string, kind: "stage" | "step" | "leak", testId: string, anchorBottom: boolean) => {
    const w = Math.round(text.length * 11.5 + 28);
    const h = 34;
    const fill = kind === "leak" ? LEAK_TAG : kind === "step" ? "rgba(18,22,30,.82)" : look === "day" ? "rgba(250,243,226,.94)" : "rgba(20,26,48,.74)";
    const ink = kind === "stage" && look === "day" ? "#2a2418" : "#f6f1e4";
    return (
      <g key={testId} transform={`translate(${x - w / 2}, ${anchorBottom ? y - h : y - h / 2})`} data-testid={testId} data-kind={kind}>
        <rect width={w} height={h} rx={17} fill={fill} />
        <text x={w / 2} y={h / 2 + 7} textAnchor="middle" fontSize={19} fontWeight={700} fill={ink} fontFamily="Manrope, Helvetica Neue, Arial, sans-serif">
          {text}
        </text>
      </g>
    );
  };
  return (
    <div className="aq-wrap">
      <div className="aq-stage">
        <div className={`aq-scene aq-${look}${still ? " aq-still" : ""}${repair && !quiet ? ` aq-rep${hidden ? " aq-rep-wait" : ""}` : ""}`} data-testid="aqueduct-scene" data-look={look} data-paused={still ? "1" : "0"} data-picture={picture}>
          {oldPicture && !quiet && !broken.has(oldPicture) ? (
            <picture>
              <source srcSet={`${oldPicture}.avif`} type="image/avif" />
              <source srcSet={`${oldPicture}.webp`} type="image/webp" />
              <img className="aq-bg" src={`${oldPicture}.jpg`} alt="" width={PICTURE.width} height={PICTURE.height} decoding="async" onError={() => setBroken((b) => new Set(b).add(oldPicture))} data-testid="aqueduct-photo-old" />
            </picture>
          ) : null}
          {broken.has(picture) ? null : (
            <picture>
              <source srcSet={`${picture}.avif`} type="image/avif" />
              <source srcSet={`${picture}.webp`} type="image/webp" />
              <img ref={photo} className="aq-bg aq-bg-now" src={`${picture}.jpg`} alt="" width={PICTURE.width} height={PICTURE.height} decoding="async" onError={() => setBroken((b) => new Set(b).add(picture))} data-testid="aqueduct-photo" />
            </picture>
          )}
          {/* The other look, fetched quietly so the toggle swaps without a wait. */}
          <link rel="prefetch" as="image" href={`${pictureFor(look === "day" ? "night" : "day", leak)}.webp`} />
          <svg className="aq-svg" viewBox={`0 0 ${PICTURE.width} ${PICTURE.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <defs>
              <WaterDefs />
              {fill ? (
                <mask id="aq-front" maskUnits="userSpaceOnUse" x={0} y={0} width={PICTURE.width} height={PICTURE.height}>
                  <path d={CHANNEL} fill="none" stroke="#FFFFFF" strokeWidth={44} strokeDasharray={`${CHANNEL_LENGTH} ${CHANNEL_LENGTH}`} className="aq-front" style={{ "--len": CHANNEL_LENGTH, "--fill": `${FILL_SECONDS}s` } as React.CSSProperties} onAnimationEnd={() => setFilling(false)} />
                </mask>
              ) : null}
            </defs>
            <g className="aq-water" style={{ mixBlendMode: water.blend }} mask={fill ? "url(#aq-front)" : undefined} data-testid="aqueduct-water" data-filling={fill ? "1" : "0"}>
              {SEGMENTS.map((seg) => {
                const w = waterWidth(now[seg.stage], now[1]);
                // After a repaired arch the channel widens to its own width (H-637 PR 2): every layer from 60% of its width.
                const widen = repair && seg.stage >= repair.step + 2 ? " aq-widen" : "";
                const grow = (width: number): Record<string, number> => (widen ? { "--w0": width * 0.6, "--w1": width } : {});
                const core = Math.round(w * BODY.core * 100) / 100;
                return (
                  <g key={seg.key} data-testid="aqueduct-segment" data-width={w}>
                    <path d={seg.d} fill="none" stroke={water.edge} strokeOpacity={water.edgeAlpha} strokeWidth={w} strokeLinecap="round" className={`aq-body${widen}`} style={grow(w) as React.CSSProperties} />
                    <path d={seg.d} fill="none" stroke={water.deep} strokeOpacity={water.deepAlpha} strokeWidth={core} strokeLinecap="round" className={`aq-body aq-core${widen}`} style={grow(core) as React.CSSProperties} />
                    {FLOW.map((layer) => {
                      const lw = flowWidth(layer, w);
                      return (
                        <path
                          key={layer.key}
                          d={seg.d}
                          transform={layer.lane ? `translate(0 ${Math.round(layer.lane * w * 100) / 100})` : undefined}
                          fill="none"
                          stroke={water.dash}
                          strokeOpacity={layer.alpha}
                          strokeWidth={lw}
                          strokeLinecap="round"
                          strokeDasharray={layer.array}
                          className={`aq-run aq-${layer.key}${widen}`}
                          style={{ "--s": `${layer.seconds}s`, ...grow(lw) } as React.CSSProperties}
                          data-flow={layer.key}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </g>
            {fall ? (
              <g className={`aq-fall${repair ? " aq-rep-new" : ""}${fill ? " aq-after" : ""}`} style={fill ? ({ "--at": `${frontReaches(fall[0])}s` } as React.CSSProperties) : undefined} data-testid="aqueduct-fall" data-step={leak!.step} data-x={fall[0]}>
                <FallingSheet f={fall} color={water.dash} />
                <Splash f={fall} color={water.dash} />
              </g>
            ) : null}
            {leak ? null : <AqueductFountain look={look} className={repair ? "aq-rep-new" : fill ? "aq-after" : ""} style={fill ? ({ "--at": `${frontReaches(1528)}s` } as React.CSSProperties) : undefined} />}
            <g className="aq-tags">
              {STAGE_TAG_AT.map(([x, y], i) => pill(x, y, `${now[i] === null || now[i] === undefined ? "—" : now[i]!.toLocaleString()} · ${STAGES[i]}`, "stage", `aqueduct-stage-${i}`, true))}
              {STEP_TAG_AT.map(([x, y], b) => {
                const s = stepRates[b];
                if (repair && repair.step === b) return null;
                return pill(x, y, `${pct(s.rate)} ${s.label}`, s.leak ? "leak" : "step", `aqueduct-step-${b}`, false);
              })}
            </g>
            {repair ? <AqueductRepairLayer repair={repair} look={look} quiet={quiet} water={water.dash} /> : null}
          </svg>
        </div>
        {repair && card ? <AqueductRepairCard repair={repair} onClose={() => setCard(false)} /> : null}
      </div>
      <div className="aq-bar">
        <div className="aq-ctrl" role="group" aria-label="Scene controls">
          <button
            type="button"
            className="btn btn-soft btn-sm"
            aria-pressed={paused}
            onClick={() => {
              const n = !paused;
              setPaused(n);
              void setAqueductPausedAction(n);
            }}
            data-testid="aqueduct-pause"
          >
            {paused ? "Set the water moving" : "Pause the water"}
          </button>
          {ownLook ? (
            <span className="aq-looks" role="group" aria-label="Golden hour or night">
              {(["day", "night"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`btn btn-sm ${look === k ? "btn-primary" : "btn-soft"}`}
                  aria-pressed={look === k}
                  onClick={() => {
                    setLook(k);
                    void setSceneLookAction(k);
                  }}
                  data-testid={`aqueduct-look-${k}`}
                >
                  {k === "day" ? "Golden hour" : "Night"}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
