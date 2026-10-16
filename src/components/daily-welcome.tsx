"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { FIRE_STAGES, FLAME_GLOW, FLAME_SCALE, SPARKS_FROM_STAGE, arenaProgress, type WelcomeCard } from "@/lib/engine/welcome";
import { lbSerif } from "@/components/leaderboard/fonts";
import "./daily-welcome.css";

/** The sequence's length (docs/welcome/daily-welcome-v1.dc.html): 3.3 s, 4 s on a milestone day. */
const SEQUENCE_MS = 3300;
const MILESTONE_SEQUENCE_MS = 4000;

const MOTION = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const q = window.matchMedia(MOTION);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
};
const readMotion = () => window.matchMedia(MOTION).matches;

const Laurel = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M18 42C8 37 4 26 9 13" />
      <path d="M30 42C40 37 44 26 39 13" />
    </g>
    <g fill="currentColor">
      {[
        [10, 15, -35], [7, 21.5, -15], [7.5, 28.5, 10], [10.5, 34.5, 35], [15.5, 39, 60],
        [38, 15, 35], [41, 21.5, 15], [40.5, 28.5, -10], [37.5, 34.5, -35], [32.5, 39, -60],
      ].map(([cx, cy, r]) => (
        <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx="1.8" ry="3.6" transform={`rotate(${r} ${cx} ${cy})`} />
      ))}
    </g>
  </svg>
);

/** The flame: three layers under a wavering filter, a blue base, sparks from stage 5 (docs/welcome/daily-welcome-flame-v1.dc.html). */
function Flame({ stage, stageOld }: { stage: number; stageOld: number }) {
  return (
    <div className="dw-fl" style={{ "--f0": FLAME_SCALE[stageOld], "--f1": FLAME_SCALE[stage] } as React.CSSProperties} data-testid="welcome-flame" data-stage={stage}>
      <div className="dw-glow" style={{ opacity: FLAME_GLOW[stage] }} />
      <svg className="dw-flame" viewBox="0 0 80 96" aria-hidden="true">
        <defs>
          <linearGradient id="dwOuter" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#8E2F0C" />
            <stop offset=".25" stopColor="#D2531A" />
            <stop offset=".6" stopColor="#F28C2E" />
            <stop offset="1" stopColor="#FFB040" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dwMid" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#F59A34" />
            <stop offset=".5" stopColor="#FFC45C" />
            <stop offset="1" stopColor="#FFD98A" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="dwCore" cx=".5" cy=".7" r=".5">
            <stop offset="0" stopColor="#FFFBEF" />
            <stop offset=".5" stopColor="#FFE7A8" />
            <stop offset="1" stopColor="#FFD27A" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="dwBlue" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#6F8CFF" stopOpacity=".55" />
            <stop offset="1" stopColor="#6F8CFF" stopOpacity="0" />
          </radialGradient>
          <filter id="dwWisp" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.06 0.12" numOctaves="2" seed="3" result="n">
              <animate attributeName="baseFrequency" dur="3s" values="0.06 0.12;0.07 0.16;0.06 0.12" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="0.9" />
          </filter>
          <filter id="dwSoft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        <g className="dw-lv dw-l1">
          <path d="M40 4C43 17 58 26 63 42C68 60 63 76 53 85C47 91 33 91 27 85C17 76 12 60 17 44C20 34 29 28 32 18C35 26 36 31 38 34C39 24 37 13 40 4Z" fill="url(#dwOuter)" filter="url(#dwWisp)" />
        </g>
        <g className="dw-lv dw-l2">
          <path d="M40 28C43 38 53 45 55 58C57 71 51 81 40 86C29 81 23 71 25 58C27 49 33 45 35 39C37 43 38 45 39 47C39 41 39 34 40 28Z" fill="url(#dwMid)" filter="url(#dwWisp)" />
        </g>
        <g className="dw-lv dw-l3">
          <ellipse cx="40" cy="72" rx="13" ry="14" fill="url(#dwCore)" filter="url(#dwSoft)" />
        </g>
        <ellipse cx="40" cy="86" rx="12" ry="4" fill="url(#dwBlue)" />
      </svg>
      <div className="dw-sparks" style={{ opacity: stage >= SPARKS_FROM_STAGE ? 1 : 0 }}>
        <span className="dw-spark dw-lv" style={{ left: "40%", "--sx": "-6px", animationDelay: ".2s" } as React.CSSProperties} />
        <span className="dw-spark dw-lv" style={{ left: "56%", "--sx": "5px", animationDelay: ".9s" } as React.CSSProperties} />
        <span className="dw-spark dw-lv" style={{ left: "48%", "--sx": "-2px", animationDelay: "1.4s" } as React.CSSProperties} />
      </div>
    </div>
  );
}

/** Where the arena bar starts its fill: yesterday's fraction of today's, 0 when a milestone was crossed today. */
function fillFrom(card: WelcomeCard): string {
  const old = arenaProgress(card.daysOld);
  if (!card.progress.fraction || old.prev !== card.progress.prev) return "0";
  return Math.max(0, Math.min(1, old.fraction / card.progress.fraction)).toFixed(3);
}

const Roll = ({ from, to, delay, className = "" }: { from: number | string; to: number | string; delay: string; className?: string }) => (
  <span className={`dw-roll ${className}`} style={{ "--d": delay } as React.CSSProperties}>
    {String(from) !== String(to) ? (
      <span className="dw-o" aria-hidden="true">
        {from}
      </span>
    ) : null}
    <span className="dw-n">{to}</span>
  </span>
);

/**
 * The Daily welcome (H-312): a full-screen dialog over the page, the sequence timed by the CSS of the design; Skip, Escape or a
 * tap on the scrim jump to the finished state, a second tap closes it; reduced motion shows it finished. The button goes to
 * Today's lock-in. Nothing here writes: the server marked the open and paid the day before it rendered.
 */
export function DailyWelcome({ card }: { card: WelcomeCard }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [done, setDone] = useState(false);
  const [ended, setEnded] = useState(false);
  const skipRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const total = card.milestone ? MILESTONE_SEQUENCE_MS : SEQUENCE_MS;
  // Reduced motion: the finished state straight away, no motion at all.
  const quiet = useSyncExternalStore(subscribeMotion, readMotion, () => false);
  const finished = done || ended || quiet;
  useEffect(() => {
    if (quiet) return;
    skipRef.current?.focus();
    const t = setTimeout(() => setEnded(true), total);
    return () => clearTimeout(t);
  }, [quiet, total]);
  useEffect(() => {
    if (finished) ctaRef.current?.focus();
  }, [finished]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (finished) setOpen(false);
      else setDone(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finished]);
  if (!open) return null;
  const finish = () => {
    if (finished) setOpen(false);
    else setDone(true);
  };
  const go = () => {
    setOpen(false);
    router.push("/today#checkin");
  };
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className={`dw ${lbSerif.variable} dw-${card.look}${done || quiet ? " dw-done" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dw-title" data-testid="daily-welcome" data-state={done || quiet ? "done" : ended ? "ended" : "playing"} data-look={card.look}>
      <picture>
        <source srcSet={`/colosseum/colosseum-${card.look}.webp`} type="image/webp" />
        <img className="dw-bg" src={`/colosseum/colosseum-${card.look}.jpg`} alt="" />
      </picture>
      <div className="dw-scrim" onClick={finish} data-testid="welcome-scrim" />
      <p className="sr-only" aria-live="polite" data-testid="welcome-summary">
        {card.summary}
      </p>
      <button type="button" className="dw-skip" onClick={finish} ref={skipRef} data-testid="welcome-skip">
        Skip
      </button>
      <div className="dw-card">
        <div className="dw-head">
          <div className="dw-eb" data-testid="welcome-eyebrow">{card.copy.eyebrow}</div>
          <h2 className="dw-ttl" id="dw-title" data-testid="welcome-title">
            {card.copy.title}
          </h2>
          <p className="dw-ln">{card.copy.line}</p>
        </div>
        <div className="dw-stats">
          <Flame stage={card.stage} stageOld={card.stageOld} />
          <div className="dw-st">
            <div className="dw-num" data-testid="welcome-streak" data-value={card.streak}>
              <Roll from={card.streakOld} to={card.streak} delay="2.0s" />
            </div>
            <div className="dw-lb">Day streak · {FIRE_STAGES[Math.max(0, card.stage - 1)]}</div>
          </div>
          <div className="dw-pt">
            <div className="dw-num dw-gold" data-testid="welcome-points" data-value={card.points}>
              <Roll from={fmt(card.pointsOld)} to={fmt(card.points)} delay="1.9s" />
            </div>
            <div className="dw-lb">Points</div>
          </div>
        </div>
        <div className="dw-wk">
          <div className="dw-wk-top">
            <span className="dw-lb">This week</span>
            <span className="dw-lb dw-gold" data-testid="welcome-gain">
              {card.todayBonus ? `+${card.todayBonus} today` : "Your fire is lit"}
            </span>
          </div>
          <div className="dw-coins" data-testid="welcome-coins">
            {card.coins.map((c, i) => (
              <div key={c.date} className={`dw-cn dw-s-${c.state}`} data-testid="welcome-coin" data-state={c.state} data-amount={c.amount ?? ""}>
                <div className="dw-cd">{c.label}</div>
                <div className="dw-coin" style={{ "--d": c.state === "today" ? "1.35s" : `${(0.85 + i * 0.07).toFixed(2)}s` } as React.CSSProperties}>
                  <span className="dw-cv">{c.state === "missed" || c.state === "off" || c.amount === null ? "" : c.amount}</span>
                  {c.state === "today" ? (
                    <>
                      <span className="dw-bz" />
                      <span className="dw-shine" />
                      <Laurel className="dw-seal" />
                      <span className="dw-burst">
                        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                          <span key={a} className="dw-ray" style={{ "--a": `${a}deg` } as React.CSSProperties} />
                        ))}
                      </span>
                      {card.todayBonus ? <span className="dw-fly">+{card.todayBonus}</span> : null}
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="dw-life">
          <div className="dw-life-top">
            <span className="dw-lb">Days in the arena</span>
            <span className="dw-num" data-testid="welcome-days" data-value={card.daysInArena}>
              <Roll from={card.daysOld} to={card.daysInArena} delay="2.3s" />
            </span>
          </div>
          <div className="dw-bar">
            <div className="dw-fill" style={{ width: `${Math.round(card.progress.fraction * 100)}%`, "--from": fillFrom(card) } as React.CSSProperties} />
          </div>
          <div className="dw-cap">{card.progress.caption}</div>
        </div>
        {card.milestone ? (
          <div className="dw-ms" data-testid="welcome-milestone">
            <div className="dw-ms-w">
              <Laurel />
              <span className="dw-ms-n">{card.milestone.days}</span>
            </div>
            <div>
              <div className="dw-ms-t">{card.milestone.laurel ? `${card.milestone.laurel[0].toUpperCase()}${card.milestone.laurel.slice(1)} laurel earned` : `Day ${card.milestone.days}`}</div>
              <div className="dw-ms-l">
                {card.milestone.bonus ? `+${card.milestone.bonus} bonus points.` : ""} {card.milestone.laurel ? "It now shows on your seat in the Colosseum." : ""}
              </div>
            </div>
          </div>
        ) : null}
        <button type="button" className="dw-cta" style={{ animationDelay: card.milestone ? "3.5s" : "2.8s" }} onClick={go} ref={ctaRef} data-testid="welcome-cta">
          {card.lockedIn ? "Open today" : "Lock in today"}
        </button>
      </div>
    </div>
  );
}
