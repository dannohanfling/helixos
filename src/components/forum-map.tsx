"use client";

/**
 * The Forum's map (rev 765, on Danno's 12-plot forum of 13 Oct): the forum photo, golden hour or night, with each agent's
 * building glowing by status on its plot, its name plate, and gold messengers walking door → square → door for live flows.
 * The member is the Rostra in the middle. Free plots show dimmed with no name plate. Past twelve, agents are listed under the
 * map as the Outer districts. Tap a building to light its ledger card; tap two (an outer agent included), or drag one building
 * onto another, to swap plots, saved at once. Reduced motion: no messengers moving and no breathing, dots resting mid-street.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { moveForumAgentAction } from "@/lib/actions/forum";
import { setSceneLookAction } from "@/lib/actions/scene";
import { FORUM_PLOTS } from "@/db/schema";
import { FORUM_BUILDINGS, FORUM_PLOT_XY, ROSTRA_XY, streetPath, type ForumPlot } from "@/lib/engine/forum";

export type MapAgent = { id: string; plot: ForumPlot | null; name: string; status: "working" | "waiting" | "idle" | "done"; now: string | null };
type Flow = { from: ForumPlot | "rostra"; to: ForumPlot | "rostra"; label: string };
type Look = "day" | "night";
type Spot = { agent: string | null; plot: ForumPlot | null };

const SAYS: Record<MapAgent["status"], string> = { working: "working", waiting: "waiting on you", idle: "idle", done: "done" };
const plateWidth = (label: string) => Math.max(150, label.length * 15 + 70);

export function ForumMap({ agents, flows, rostraStatus, initialLook, canMove, ownLook }: { agents: MapAgent[]; flows: Flow[]; rostraStatus: MapAgent["status"]; initialLook: Look; canMove: boolean; ownLook: boolean }) {
  const router = useRouter();
  const [look, setLook] = useState<Look>(initialLook);
  const [selected, setSelected] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [picked, setPicked] = useState<Spot | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const layer = useRef<SVGGElement>(null);
  const drag = useRef<(Spot & { x: number; y: number }) | null>(null);
  const byPlot = useMemo(() => new Map(agents.filter((a) => a.plot).map((a) => [a.plot as ForumPlot, a])), [agents]);
  const outer = agents.filter((a) => !a.plot);

  // The ledger card lights with its building.
  useEffect(() => {
    document.querySelectorAll("[data-forum-card]").forEach((c) => c.classList.toggle("fo-sel", c.getAttribute("data-forum-card") === selected));
    if (selected) document.querySelector(`[data-forum-card="${CSS.escape(selected)}"]`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }, [selected]);

  // Messengers: one per live flow, door → square → door, fading at both ends; at rest mid-street with reduced motion.
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const runners = [...g.querySelectorAll<SVGGElement>("[data-runner]")].map((r, i) => {
      const p = r.querySelector<SVGPathElement>("path")!;
      const len = p.getTotalLength();
      p.setAttribute("stroke-dasharray", `60 ${len + 60}`);
      return { r, p, len, off: i * 0.27, dur: 6000 + i * 500 };
    });
    const put = (x: (typeof runners)[number], u: number) => {
      const pt = x.p.getPointAtLength(x.len * u);
      const o = reduce ? 1 : u < 0.08 ? u / 0.08 : u > 0.92 ? (1 - u) / 0.08 : 1;
      x.r.querySelectorAll<SVGCircleElement>("circle").forEach((c) => {
        c.setAttribute("cx", pt.x.toFixed(1));
        c.setAttribute("cy", pt.y.toFixed(1));
        c.setAttribute("opacity", o.toFixed(2));
      });
      x.r.querySelector("g")?.setAttribute("transform", `translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`);
      x.r.querySelector("g")?.setAttribute("opacity", o.toFixed(2));
      x.p.setAttribute("stroke-dashoffset", (-(x.len * u) + 60).toFixed(1));
      x.p.style.opacity = reduce ? "0" : (0.35 * o).toFixed(2);
    };
    if (reduce) {
      runners.forEach((x) => put(x, 0.5));
      return;
    }
    let raf = 0;
    const tick = (t: number) => {
      runners.forEach((x) => put(x, (t / x.dur + x.off) % 1));
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const wake = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [flows]);

  function chooseLook(k: Look) {
    setLook(k);
    if (ownLook) void setSceneLookAction(k);
  }

  async function swap(a: Spot, b: Spot) {
    setPicked(null);
    if (a.agent === b.agent && a.plot === b.plot) return;
    // Whoever moves is an agent; a free plot only ever receives one.
    const mover = a.agent ? a : b;
    const target = a.agent ? b : a;
    if (!mover.agent) return;
    setBusy(true);
    const r = await moveForumAgentAction(mover.agent, target.plot);
    setBusy(false);
    setNote(r.ok ? "Moved. Saved." : "That move didn't save. Try again.");
    router.refresh();
  }

  function tap(t: Spot) {
    if (!moving) {
      if (t.agent) setSelected((s) => (s === t.agent ? null : t.agent));
      return;
    }
    if (!picked) {
      if (!t.agent && !t.plot) return;
      setPicked(t);
      setNote(t.agent ? "Now tap the plot it should move to." : "Now tap the agent to move here.");
      return;
    }
    void swap(picked, t);
  }

  const targetAt = (x: number, y: number): Spot | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement | SVGElement>("[data-target]");
    if (!el) return null;
    return { agent: el.getAttribute("data-agent") || null, plot: (el.getAttribute("data-plot") || null) as ForumPlot | null };
  };
  const down = (t: Spot) => (e: React.PointerEvent) => {
    if (canMove && t.agent) drag.current = { ...t, x: e.clientX, y: e.clientY };
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 24) return;
    const t = targetAt(e.clientX, e.clientY);
    if (t && (t.agent !== d.agent || t.plot !== d.plot)) void swap(d, t);
  };
  const target = (agent: string | null, plot: ForumPlot | null) => ({
    "data-target": "1",
    "data-agent": agent ?? "",
    "data-plot": plot ?? "",
    tabIndex: 0,
    role: "button" as const,
    onClick: () => tap({ agent, plot }),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tap({ agent, plot });
      }
    },
    onPointerDown: down({ agent, plot }),
  });
  const isPicked = (agent: string | null, plot: ForumPlot | null) => !!picked && picked.agent === agent && picked.plot === plot;

  return (
    <section className="fo-map" aria-label="Map of your agents" data-testid="forum-map" data-look={look}>
      <div className="fo-scene">
        {(["day", "night"] as Look[]).map((k) => (
          <picture key={k}>
            <source type="image/webp" srcSet={`/forum/forum-${k}.webp`} />
            <img src={`/forum/forum-${k}.jpg`} alt="" className="fo-photo" style={{ opacity: look === k ? 1 : 0 }} loading={k === look ? "eager" : "lazy"} decoding="async" data-testid={`forum-photo-${k}`} />
          </picture>
        ))}
        <svg viewBox="0 0 1680 944" role="group" aria-label="The forum: each building is an agent, with messengers on the streets between them" onPointerUp={up} onPointerCancel={() => (drag.current = null)}>
          <defs>
            <radialGradient id="fo-gwork"><stop offset="0" stopColor="#FFD98A" stopOpacity=".75" /><stop offset=".55" stopColor="#E8B24F" stopOpacity=".28" /><stop offset="1" stopColor="#E8B24F" stopOpacity="0" /></radialGradient>
            <radialGradient id="fo-gwait"><stop offset="0" stopColor="#FF9B55" stopOpacity=".7" /><stop offset=".55" stopColor="#E5793A" stopOpacity=".25" /><stop offset="1" stopColor="#E5793A" stopOpacity="0" /></radialGradient>
            <radialGradient id="fo-gdone"><stop offset="0" stopColor="#B9E3A8" stopOpacity=".5" /><stop offset="1" stopColor="#8DB580" stopOpacity="0" /></radialGradient>
            <radialGradient id="fo-gshade"><stop offset="0" stopColor="#05040A" stopOpacity=".55" /><stop offset=".7" stopColor="#05040A" stopOpacity=".3" /><stop offset="1" stopColor="#05040A" stopOpacity="0" /></radialGradient>
            <radialGradient id="fo-mglow"><stop offset="0" stopColor="#FFE6A8" stopOpacity=".95" /><stop offset="1" stopColor="#FFC75A" stopOpacity="0" /></radialGradient>
          </defs>
          <g>
            {FORUM_PLOTS.map((p) => {
              const P = FORUM_PLOT_XY[p];
              const a = byPlot.get(p);
              const st = a?.status ?? "idle";
              return (
                <g key={p} className={`fo-bld fo-${st}${a ? "" : " fo-free"}${a && selected === a.id ? " fo-sel" : ""}${isPicked(a?.id ?? null, p) ? " fo-picked" : ""}`} aria-label={a ? `${a.name}, ${FORUM_BUILDINGS[p].place}, ${SAYS[st]}${a.now ? `. Now: ${a.now}` : ""}` : `${FORUM_BUILDINGS[p].place}, a free plot`} data-testid={`forum-bld-${p}`} data-status={a ? st : "free"} {...target(a?.id ?? null, p)}>
                  <ellipse cx={P.x} cy={P.y} rx={P.rx * 1.15} ry={P.ry * 1.15} fill="url(#fo-gshade)" className="fo-shade" />
                  <ellipse cx={P.x} cy={P.y} rx={P.rx} ry={P.ry} fill={st === "waiting" ? "url(#fo-gwait)" : st === "done" ? "url(#fo-gdone)" : "url(#fo-gwork)"} className="fo-halo" />
                  <ellipse cx={P.x} cy={P.y} rx={P.rx * 0.8} ry={P.ry * 0.8} className="fo-hit" />
                </g>
              );
            })}
            <g className={`fo-bld fo-${rostraStatus}`} aria-label={`You, The Rostra, ${SAYS[rostraStatus]}`} data-testid="forum-rostra" role="img">
              <ellipse cx={ROSTRA_XY.x} cy={ROSTRA_XY.y} rx={ROSTRA_XY.rx} ry={ROSTRA_XY.ry} fill={rostraStatus === "waiting" ? "url(#fo-gwait)" : "url(#fo-gwork)"} className="fo-halo" />
            </g>
          </g>
          <g ref={layer} aria-hidden="true" className="fo-passive">
            {flows.map((f, i) => {
              const w = Math.max(80, f.label.length * 10 + 30);
              return (
                <g key={`${f.from}-${f.to}-${i}`} data-runner="1" data-testid="forum-messenger">
                  <path d={streetPath(f.from, f.to)} className="fo-trail" />
                  <circle r={26} className="fo-msgglow" fill="url(#fo-mglow)" />
                  <circle r={8} className="fo-msg" />
                  {f.label ? (
                    <g className="fo-pill">
                      <rect x={-w / 2} y={-46} width={w} height={30} rx={15} />
                      <text x={0} y={-25}>
                        {f.label}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
          <g aria-hidden="true" className="fo-passive">
            {FORUM_PLOTS.map((p) => {
              const a = byPlot.get(p);
              if (!a) return null;
              const P = FORUM_PLOT_XY[p];
              const w = plateWidth(a.name);
              return (
                <g key={p} className={`fo-plate fo-${a.status}`} transform={`translate(${P.px},${P.py})`} data-testid="forum-plate">
                  <rect x={-w / 2} y={-30} width={w} height={60} rx={30} />
                  <circle cx={-w / 2 + 24} cy={-8} r={6} className="fo-sd" />
                  <text className="fo-pn" x={8} y={-1}>
                    {a.name}
                  </text>
                  <text className="fo-pr" x={0} y={20}>
                    {FORUM_BUILDINGS[p].place.toUpperCase()}
                  </text>
                </g>
              );
            })}
            <g className={`fo-plate fo-${rostraStatus}`} transform={`translate(${ROSTRA_XY.px},${ROSTRA_XY.py})`} data-testid="forum-plate">
              <rect x={-plateWidth("You") / 2} y={-30} width={plateWidth("You")} height={60} rx={30} />
              <circle cx={-plateWidth("You") / 2 + 24} cy={-8} r={6} className="fo-sd" />
              <text className="fo-pn" x={8} y={-1}>
                You
              </text>
              <text className="fo-pr" x={0} y={20}>
                THE ROSTRA
              </text>
            </g>
          </g>
        </svg>
      </div>
      {outer.length ? (
        <div className="fo-outer" data-testid="forum-outer">
          <span className="fo-outer-k">Outer districts</span>
          {outer.map((a) => (
            <button key={a.id} type="button" className={`fo-outer-a fo-${a.status}${selected === a.id ? " fo-sel" : ""}${isPicked(a.id, null) ? " fo-picked" : ""}`} data-testid="forum-outer-agent" aria-label={`${a.name}, in the Outer districts, ${SAYS[a.status]}`} onClick={() => tap({ agent: a.id, plot: null })}>
              <i className="fo-dot fo-sd" aria-hidden="true" />
              {a.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="fo-maptools">
        <div className="fo-legend">
          <span><i className="fo-dot" style={{ background: "var(--fo-work)" }} />Working</span>
          <span><i className="fo-dot" style={{ background: "var(--fo-wait)" }} />Waiting on you</span>
          <span><i className="fo-dot" style={{ background: "var(--fo-idle)" }} />Idle</span>
          <span><i className="fo-dot" style={{ background: "var(--fo-done)" }} />Done</span>
          <span><i className="fo-dot" style={{ background: "var(--fo-gold-hi)" }} />A message on the street</span>
        </div>
        <div className="fo-tools">
          {canMove ? (
            <button type="button" className="fo-btn" aria-pressed={moving} disabled={busy} onClick={() => { setMoving((m) => !m); setPicked(null); setNote(moving ? null : "Tap an agent, then the plot it should move to. You can also drag one building onto another."); }} data-testid="forum-move">
              {moving ? "Done moving" : "Move agents"}
            </button>
          ) : null}
          <div role="group" aria-label="Time of day" className="fo-looks">
            {(["day", "night"] as Look[]).map((k) => (
              <button key={k} type="button" className="fo-btn" aria-pressed={look === k} onClick={() => chooseLook(k)} data-testid={`forum-look-${k}`}>
                {k === "day" ? "Golden hour" : "Night"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {note ? (
        <p className="fo-note" role="status" data-testid="forum-move-note">
          {note}
        </p>
      ) : null}
    </section>
  );
}
