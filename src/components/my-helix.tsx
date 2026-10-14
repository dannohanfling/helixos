"use client";

/**
 * The helix (rev 707 §2 and §3, rev 710's geometry): CSS 3D, one turn every 30 seconds, every ball counter-turned so it faces
 * the viewer; done rungs in their phase's colours with a glow, the rest grey, a backbone ball lit only between two done rungs.
 * The first incomplete rung pulses and its card deep-links to where it's done. Tap a phase to expand its rungs and fade the
 * others. Pause is remembered; the tab hidden or reduced motion holds it still. A rung done since the member last looked glows
 * once, then is remembered as seen.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { markHelixSeenAction, setHelixPausedAction, tickRungAction } from "@/lib/actions/my-helix";
import { backboneLit, backbonePlace, BALL_PX, FADE_OPACITY, GREY_BALL, GREY_BAR, PERSPECTIVE_PX, phaseOf, RADIUS_PX, rungPlace, STAGE_PX, TURN_SECONDS } from "@/lib/engine/my-helix";
import { SubmitButton } from "@/components/submit-button";

type Rung = { key: string; phase: number; label: string; done: boolean; tick: boolean; ticked: boolean; href: string; words: string };
type PhaseRow = { n: number; name: string; main: string; dark: string; done: number; total: number };
type Next = { key: string; label: string; phase: number; href: string } | null;

export function MyHelix({ rungs, phases, next, built, total, pct, initialPaused, fresh, own }: { rungs: Rung[]; phases: PhaseRow[]; next: Next; built: number; total: number; pct: number; initialPaused: boolean; fresh: string[]; own: boolean }) {
  const [paused, setPaused] = useState(initialPaused);
  const [hidden, setHidden] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const done = rungs.map((r) => r.done);
  const freshSet = new Set(fresh);

  // The tab hidden holds the helix; the rungs lit since the last look are remembered as seen once they've glowed.
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    if (own && fresh.length) {
      const t = setTimeout(() => void markHelixSeenAction(fresh), 1500);
      return () => clearTimeout(t);
    }
  }, [own, fresh]);

  const still = paused || hidden;
  const ball = (r: Rung, side: -1 | 1, theta: number, isNext: boolean) => {
    const p = phaseOf(r.phase);
    const dim = focus !== null && focus !== r.phase;
    return (
      <span key={side} className="hx-end" style={{ transform: `translateX(${side * RADIUS_PX}px) rotateY(${-theta}deg)` }}>
        <span
          className={`hx-ball${r.done ? " hx-done" : ""}${isNext ? " hx-next" : ""}${freshSet.has(r.key) ? " hx-fresh" : ""}`}
          style={{ width: BALL_PX, height: BALL_PX, background: r.done ? `radial-gradient(circle at 35% 35%, #fff 0%, ${p.main} 45%, ${p.dark} 100%)` : `radial-gradient(circle at 35% 35%, ${GREY_BALL[0]}, ${GREY_BALL[1]})`, boxShadow: r.done ? `0 0 12px ${p.main}` : undefined, opacity: dim ? FADE_OPACITY : 1 }}
          data-testid={isNext ? "helix-next-ball" : undefined}
        />
      </span>
    );
  };
  return (
    <>
      <header className="hx-head">
        <div>
          <p className="hx-eyebrow">Daily</p>
          <h1 className="hx-title">My Helix</h1>
        </div>
        <dl className="hx-stats">
          <div>
            <dd data-testid="helix-built">
              {built} / {total}
            </dd>
            <dt>Rungs built</dt>
          </div>
          <div>
            <dd data-testid="helix-pct">{pct}%</dd>
            <dt>Of your helix</dt>
          </div>
        </dl>
      </header>
      <div className="hx-zone">
        <div className="hx-stagewrap">
          <div className={`hx-stage${still ? " hx-still" : ""}`} style={{ perspective: PERSPECTIVE_PX, height: STAGE_PX }} data-testid="helix-stage" data-paused={still ? "1" : "0"}>
            <div className="hx-helix" style={{ animationDuration: `${TURN_SECONDS}s` }} data-testid="helix">
              {rungs.map((r, i) => {
                const { y, theta } = rungPlace(i);
                const p = phaseOf(r.phase);
                const dim = focus !== null && focus !== r.phase;
                const isNext = next?.key === r.key;
                return (
                  <div key={r.key} className="hx-rung" style={{ bottom: y, transform: `rotateY(${theta}deg)` }} data-testid="helix-rung" data-done={r.done ? "1" : "0"} data-phase={r.phase} data-key={r.key} title={r.label}>
                    <span className="hx-bar" style={{ background: r.done ? p.main : GREY_BAR, opacity: dim ? FADE_OPACITY : 1 }} />
                    {ball(r, -1, theta, isNext)}
                    {ball(r, 1, theta, isNext)}
                  </div>
                );
              })}
              {rungs.slice(0, -1).map((r, i) => {
                const { y, theta } = backbonePlace(i);
                const lit = backboneLit(done, i);
                const p = phaseOf(r.phase);
                const dim = focus !== null && focus !== r.phase;
                return (
                  <div key={`b${i}`} className="hx-rung hx-backbone" style={{ bottom: y, transform: `rotateY(${theta}deg)` }} data-testid="helix-backbone" data-lit={lit ? "1" : "0"}>
                    {([-1, 1] as const).map((side) => (
                      <span key={side} className="hx-end" style={{ transform: `translateX(${side * RADIUS_PX}px) rotateY(${-theta}deg)` }}>
                        <span className="hx-ball hx-small" style={{ background: lit ? `radial-gradient(circle at 35% 35%, #fff 0%, ${p.main} 45%, ${p.dark} 100%)` : `radial-gradient(circle at 35% 35%, ${GREY_BALL[0]}, ${GREY_BALL[1]})`, boxShadow: lit ? `0 0 8px ${p.main}` : undefined, opacity: dim ? FADE_OPACITY : 1 }} />
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="hx-bar-row">
            <button
              type="button"
              className="btn btn-soft btn-sm"
              aria-pressed={paused}
              onClick={() => {
                const n = !paused;
                setPaused(n);
                void setHelixPausedAction(n);
              }}
              data-testid="helix-pause"
            >
              {paused ? "Set the helix turning" : "Pause the helix"}
            </button>
            <p className="hx-fine">One turn every {TURN_SECONDS} seconds. The closer to the top, the further along.</p>
          </div>
        </div>
        <aside className="hx-side">
          <section className="hx-card" data-testid="helix-next">
            <p className="hx-eyebrow">Your next rung</p>
            {next ? (
              <>
                <p className="hx-nextname">{next.label}</p>
                <p className="hx-fine">{phaseOf(next.phase).name}</p>
                <Link href={next.href} className="btn btn-primary btn-sm mt-2" data-testid="helix-work">
                  Work on it now
                </Link>
              </>
            ) : (
              <p className="hx-nextname">Every rung built. Your helix is complete.</p>
            )}
          </section>
          <ol className="hx-phases" aria-label="Phases, bottom to top">
            {phases
              .slice()
              .reverse()
              .map((p) => (
                <li key={p.n} className={`hx-phase${focus === p.n ? " hx-open" : ""}`}>
                  <button type="button" className="hx-phasebtn" aria-expanded={focus === p.n} onClick={() => setFocus((f) => (f === p.n ? null : p.n))} data-testid={`helix-phase-${p.n}`}>
                    <span className="hx-swatch" style={{ background: `linear-gradient(135deg, ${p.main}, ${p.dark})` }} aria-hidden="true" />
                    <span className="hx-phasename">
                      {p.n}. {p.name}
                    </span>
                    <span className="hx-phasecount">
                      {p.done} / {p.total}
                    </span>
                  </button>
                  {focus === p.n ? (
                    <ul className="hx-rungs" data-testid={`helix-rungs-${p.n}`}>
                      {rungs
                        .filter((r) => r.phase === p.n)
                        .map((r) => (
                          <li key={r.key} className="hx-rungrow" data-testid="helix-rung-row" data-done={r.done ? "1" : "0"}>
                            <span className={`hx-mark${r.done ? " hx-tick" : ""}`} aria-hidden="true">
                              {r.done ? "✓" : ""}
                            </span>
                            <span className="hx-rungtext">
                              <Link href={r.href}>{r.label}</Link>
                              <span className="hx-fine">Reads: {r.words}</span>
                            </span>
                            {r.tick ? (
                              <form action={tickRungAction}>
                                <input type="hidden" name="key" value={r.key} />
                                <input type="hidden" name="on" value={r.ticked ? "0" : "1"} />
                                <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="helix-tick">
                                  {r.ticked ? "Undo" : "Done"}
                                </SubmitButton>
                              </form>
                            ) : null}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </li>
              ))}
          </ol>
        </aside>
      </div>
    </>
  );
}
