"use client";

/**
 * The Aqueduct's repair moment and the full fountain (H-327 §4, plan H-637 PR 2), drawn inside the scene's SVG (viewBox
 * 0 0 1680 944) and timed from docs/scenes/living-scenes-aqueduct.dc.html: a gold burst at the leak (0.3 s); the falling water
 * retracts and the ripples fade (0.5 to 1.8 s); the channel after the leak widens (1.2 s, in the scene); the picture crossfades
 * to the next state (1.6 s, in the scene); the step tag turns from amber "leaking here" to green "repaired" (1.4 to 2.1 s); the
 * card rises (3 s). Amber and green only. With reduced motion only the end state is drawn: the green tag and the card.
 * Falling water is a sheet with streaks, and a splash where it lands (H-966).
 */
import { FALL_STREAKS, FALLS, fallSheet, LEAK_TAG, STEP_TAG_AT } from "@/lib/engine/aqueduct";
import { AQUEDUCT_FOUNTAIN } from "@/lib/engine/ambience";
import { repairLine, type Repair } from "@/lib/engine/aqueduct-repair";
import type { SceneLook } from "@/lib/engine/board-view";
import "@/components/aqueduct-repair.css";

export const REPAIRED_TAG = "rgba(58,92,50,.92)";

/** One step pill in the scene's own style (the scene's pill, H-711), amber or green. */
function Pill({ x, y, text, fill, testId }: { x: number; y: number; text: string; fill: string; testId: string }) {
  const w = Math.round(text.length * 11.5 + 28);
  const h = 34;
  return (
    <g transform={`translate(${x - w / 2}, ${y - h / 2})`} data-testid={testId}>
      <rect width={w} height={h} rx={17} fill={fill} />
      <text x={w / 2} y={h / 2 + 7} textAnchor="middle" fontSize={19} fontWeight={700} fill="#f6f1e4" fontFamily="Manrope, Helvetica Neue, Arial, sans-serif">
        {text}
      </text>
    </g>
  );
}

/** The repair over the old leak: burst, the water retracting, the ripples fading, the tag turning green. */
export function AqueductRepairLayer({ repair, look, quiet, water }: { repair: Repair; look: SceneLook; quiet: boolean; water: string }) {
  const f = FALLS[look][repair.step];
  const [tx, ty] = STEP_TAG_AT[repair.step];
  const green = <Pill x={tx} y={ty} text={`${repair.nowPct}% · repaired`} fill={REPAIRED_TAG} testId="aqueduct-repaired-tag" />;
  if (quiet) return <g className="aq-tags" data-testid="aqueduct-repair-moment" data-step={repair.step}>{green}</g>;
  return (
    <g data-testid="aqueduct-repair-moment" data-step={repair.step}>
      <g className="aq-rep-leak">
        <FallingSheet f={f} color={water} />
      </g>
      <g className="aq-rep-ripples">
        <Splash f={f} color={water} />
      </g>
      <g className="aq-rep-burst" data-testid="aqueduct-burst">
        <circle cx={f[0]} cy={f[1]} r={26} fill="#F0CF86" fillOpacity={0.55} />
        <g stroke="#FFE7A8" strokeWidth={3} strokeLinecap="round">
          {[[0, -40, 0, -56], [0, 40, 0, 56], [-40, 0, -56, 0], [40, 0, 56, 0], [-28, -28, -39, -39], [28, -28, 39, -39], [-28, 28, -39, 39], [28, 28, 39, 39]].map(([a, b, c, d], i) => (
            <path key={i} d={`M${f[0] + a},${f[1] + b} L${f[0] + c},${f[1] + d}`} />
          ))}
        </g>
      </g>
      <g className="aq-tags">
        <g className="aq-rep-amber">
          <Pill x={tx} y={ty} text={`${repair.wasPct}% · leaking here`} fill={LEAK_TAG} testId="aqueduct-leaking-tag" />
        </g>
        <g className="aq-rep-green">{green}</g>
      </g>
    </g>
  );
}

/** The scene's shared gradients: the falling sheet (bright under the lip, thinning as it falls) and the soft mist. */
export function WaterDefs() {
  return (
    <>
      <linearGradient id="aq-sheet" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity={0.6} />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity={0.2} />
      </linearGradient>
      <radialGradient id="aq-mistg">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity={0.6} />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
      </radialGradient>
    </>
  );
}

/** Falling water (H-966): the sheet, widening as it falls and swaying a little, with streaks falling through it. */
export function FallingSheet({ f, color }: { f: number[]; color: string }) {
  const [x, top, bottom] = f;
  return (
    <g className="aq-sway" data-testid="aqueduct-fall-sheet">
      <path d={fallSheet(x, top, bottom)} fill="url(#aq-sheet)" />
      {FALL_STREAKS.map((s, i) => (
        <line key={i} x1={x + s.dx * 0.4} y1={top} x2={x + s.dx} y2={bottom} stroke={color} strokeOpacity={0.75} strokeWidth={s.w} strokeLinecap="round" strokeDasharray={s.array} className="aq-drop" style={{ "--s": `${s.seconds}s` } as React.CSSProperties} data-testid="aqueduct-fall-streak" />
      ))}
    </g>
  );
}

/** Where it lands: a mist that swells and fades, a few drops of spray, and two ripples. */
export function Splash({ f, color }: { f: number[]; color: string }) {
  const [, , , cx, cy, rx, ry] = f;
  const drops = [
    [-8, -4, 2.4, 0],
    [7, -6, 2, 0.35],
    [-2, -9, 1.8, 0.7],
    [11, -3, 2, 1.05],
  ];
  return (
    <g data-testid="aqueduct-splash">
      <ellipse cx={cx} cy={cy - ry * 0.4} rx={rx * 0.8} ry={ry * 1.4} fill="url(#aq-mistg)" className="aq-mist" data-testid="aqueduct-mist" />
      <g fill={color}>
        {drops.map(([dx, dy, r, dl], i) => (
          <circle key={i} cx={cx + dx} cy={cy + dy} r={r} className="aq-spray" style={{ animationDelay: `${dl}s` }} />
        ))}
      </g>
      <g className="aq-ripples">
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={color} strokeOpacity={0.8} strokeWidth={3} className="aq-ripple" />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={color} strokeOpacity={0.8} strokeWidth={3} className="aq-ripple aq-ripple-2" />
      </g>
    </g>
  );
}

/** The full fountain, while nothing leaks: streaks over the painted waterfall, a mist pulse, the spray and its ripple. */
export function AqueductFountain({ look, className = "", style }: { look: SceneLook; className?: string; style?: React.CSSProperties }) {
  const f = AQUEDUCT_FOUNTAIN[look];
  return (
    <g className={`aq-fountain ${className}`} style={style} data-testid="aqueduct-fountain">
      <g className="aq-sway">
        <path d={f.sheet} fill="url(#aq-sheet)" fillOpacity={0.55} data-testid="aqueduct-fountain-sheet" />
        {f.streaks.map((s, i) => (
          <path key={i} d={s.d} className="aq-wf" style={{ animationDelay: `${s.dl}s`, strokeWidth: s.w, "--s": `${s.s}s` } as React.CSSProperties} />
        ))}
      </g>
      <ellipse cx={f.mist.cx} cy={f.mist.cy} rx={f.mist.rx} ry={f.mist.ry * 1.4} fill="url(#aq-mistg)" className="aq-mist" />
      <g fill="#FFFFFF">
        {f.spray.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r={d.r} className="aq-spray" style={{ animationDelay: `${d.dl}s` }} />
        ))}
      </g>
      <ellipse cx={f.ripple.cx} cy={f.ripple.cy} rx={f.ripple.rx} ry={f.ripple.ry} fill="none" stroke="#E6FBFF" strokeWidth={2} className="aq-ripple" />
    </g>
  );
}

/** The card: "Arch repaired. Your water is flowing again." with the rates. */
export function AqueductRepairCard({ repair, onClose }: { repair: Repair; onClose: () => void }) {
  return (
    <div className="aq-repcard" role="status" data-testid="aqueduct-repair-card">
      <p className="aq-repcard-eb">Arch repaired</p>
      <p className="aq-repcard-tt">Your water is flowing again.</p>
      <p className="aq-repcard-tl" data-testid="aqueduct-repair-line">
        {repairLine(repair)}
      </p>
      <div className="aq-repcard-act">
        <a href="#aqueduct-table" className="btn btn-primary btn-sm">
          See what changed
        </a>
        <button type="button" className="btn btn-soft btn-sm" onClick={onClose} data-testid="aqueduct-repair-close">
          Close
        </button>
      </div>
    </div>
  );
}
