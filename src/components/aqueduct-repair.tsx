"use client";

/**
 * The Aqueduct's repair moment and the full fountain (H-327 §4, plan H-637 PR 2), drawn inside the scene's SVG (viewBox
 * 0 0 1680 944) and timed from docs/scenes/living-scenes-aqueduct.dc.html: a gold burst at the leak (0.3 s); the falling water
 * retracts and the ripples fade (0.5 to 1.8 s); the channel after the leak widens (1.2 s, in the scene); the picture crossfades
 * to the next state (1.6 s, in the scene); the step tag turns from amber "leaking here" to green "repaired" (1.4 to 2.1 s); the
 * card rises (3 s). Amber and green only. With reduced motion only the end state is drawn: the green tag and the card.
 */
import { FALLS, LEAK_TAG, STEP_TAG_AT } from "@/lib/engine/aqueduct";
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
        <line x1={f[0]} y1={f[1]} x2={f[0]} y2={f[2]} stroke={water} strokeOpacity={0.85} strokeWidth={5} strokeLinecap="round" strokeDasharray="9 15" className="aq-falling" />
      </g>
      <g className="aq-rep-ripples">
        <ellipse cx={f[3]} cy={f[4]} rx={f[5]} ry={f[6]} fill="none" stroke={water} strokeOpacity={0.8} strokeWidth={3} className="aq-ripple" />
        <ellipse cx={f[3]} cy={f[4]} rx={f[5]} ry={f[6]} fill="none" stroke={water} strokeOpacity={0.8} strokeWidth={3} className="aq-ripple aq-ripple-2" />
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

/** The full fountain, while nothing leaks: streaks over the painted waterfall, a mist pulse, the spray and its ripple. */
export function AqueductFountain({ look, className = "" }: { look: SceneLook; className?: string }) {
  const f = AQUEDUCT_FOUNTAIN[look];
  return (
    <g className={`aq-fountain ${className}`} data-testid="aqueduct-fountain">
      {f.streaks.map((s, i) => (
        <path key={i} d={s.d} className="aq-wf" style={{ animationDelay: `${s.dl}s` }} />
      ))}
      <ellipse cx={f.mist.cx} cy={f.mist.cy} rx={f.mist.rx} ry={f.mist.ry} fill="#FFFFFF" fillOpacity={0.35} className="aq-mist" />
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
