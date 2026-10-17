"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { markFirstArrivalSeenAction } from "@/lib/actions/first-arrival";
import { ARRIVAL_DOORS_MS, ARRIVAL_MS, goldFlakes, wreathLeaves, type ArrivalCard } from "@/lib/engine/first-arrival";
import { armSounds, playSound } from "@/lib/sounds";
import { lbSerif } from "@/components/leaderboard/fonts";
import { useHidden, useQuiet } from "./scene-life";
import "./first-arrival.css";

/** Fired when the first arrival closes, so what waits on it (the streak flame's surge) can play. */
export const ARRIVAL_CLOSED = "helixos:arrival-closed";

const Sky = ({ full }: { full: boolean }) => (
  <svg className="fa-sky" viewBox="0 0 390 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <g fill="#1A120B">
      {full ? (
        <>
          <path d="M14 120V64l18-12 18 12v56z" />
          <rect x="18" y="64" width="4" height="40" fill="#2A1C10" />
        </>
      ) : null}
      <ellipse cx="62" cy="80" rx="6" ry="30" />
      <ellipse cx="74" cy="86" rx="5" ry="24" />
      <path d="M88 40Q195 20 302 40V120H88z" />
      <ellipse cx="318" cy="82" rx="6" ry="28" />
      <ellipse cx="330" cy="88" rx="5" ry="22" />
      {full ? <path d="M340 120V78h50v42z" /> : null}
    </g>
    <rect x="92" y="46" width="206" height="66" fill="url(#fa-arc)" />
    {full ? (
      <g fill="#F3B868" fillOpacity=".6">
        <path d="M346 120v-18a5 5 0 0 1 10 0v18zM362 120v-18a5 5 0 0 1 10 0v18zM378 120v-18a5 5 0 0 1 10 0v18z" />
      </g>
    ) : null}
    <rect x="0" y="112" width="390" height="8" fill="#1A120B" />
  </svg>
);

/**
 * The first arrival (H-472): the triumphal arch at night carved with the person's name, the doors opening onto the Colosseum
 * at golden hour, the pass through the arch, the laurel wreath growing leaf by leaf around the aureus, the lines and the
 * tablets rising, the shine on the button. Skip jumps to the finished screen, Replay plays it again, the button lands on
 * Today. Reduced motion shows the finished screen at once. The seen stamp lands once: at the end, on Skip, or on the button;
 * a replay from Settings stamps nothing.
 */
export function FirstArrival({ card }: { card: ArrivalCard }) {
  const router = useRouter();
  const quiet = useQuiet();
  const hidden = useHidden();
  const [run, setRun] = useState(0);
  const [instant, setInstant] = useState(false);
  const [ended, setEnded] = useState(false);
  const [closed, setClosed] = useState(false);
  const stamped = useRef(false);
  const skipRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const finished = instant || ended || quiet;
  const stamp = () => {
    if (stamped.current || card.replay) return;
    stamped.current = true;
    void markFirstArrivalSeenAction();
  };
  useEffect(() => {
    armSounds();
    if (quiet) return;
    skipRef.current?.focus();
    const doors = setTimeout(() => playSound("applause-milestone", 0.5), ARRIVAL_DOORS_MS);
    const end = setTimeout(() => setEnded(true), ARRIVAL_MS);
    return () => {
      clearTimeout(doors);
      clearTimeout(end);
    };
  }, [quiet, run]);
  useEffect(() => {
    if (!finished) return;
    ctaRef.current?.focus();
    stamp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);
  useEffect(() => {
    if (closed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setInstant(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closed]);
  useEffect(() => {
    if (closed) window.dispatchEvent(new Event(ARRIVAL_CLOSED));
  }, [closed]);
  if (closed) return null;
  const skip = () => setInstant(true);
  const replay = () => {
    setInstant(false);
    setEnded(false);
    setRun((n) => n + 1);
  };
  const go = () => {
    stamp();
    setClosed(true);
    router.push("/today");
  };
  const leaves = wreathLeaves();
  const flakes = goldFlakes();
  return (
    <div key={run} className={`fa ${lbSerif.variable}${finished ? " fa-instant" : ""}${hidden ? " sc-paused" : ""}`} role="dialog" aria-modal="true" aria-labelledby="fa-title" data-testid="first-arrival" data-kind={card.kind} data-state={finished ? "done" : "playing"} data-replay={card.replay ? "1" : "0"}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <pattern id="fa-arc" x="0" y="0" width="16" height="22" patternUnits="userSpaceOnUse">
            <path d="M3 21V11a5 5 0 0 1 10 0v10z" fill="#F3B868" fillOpacity=".75" />
          </pattern>
        </defs>
      </svg>
      <p className="sr-only" aria-live="polite" data-testid="arrival-summary">
        {card.summary}
      </p>
      <div className="fa-stage">
        <div className="fa-col">
          <div className="fa-hero" aria-hidden="true">
            <div className="fa-sun" />
            <Sky full />
            <div className="fa-crest">
              {leaves.map((l, i) => (
                <i key={i} className="fa-leaf" style={{ left: `${l.x}px`, top: `${l.y}px`, "--r": `${l.r}deg`, animationDelay: `${l.delay}s` } as React.CSSProperties} />
              ))}
              <i className="fa-knot" />
              <div className="fa-coinm" data-testid="arrival-initial">
                <span>{card.initial}</span>
              </div>
              {card.kind === "team" ? <span className="fa-tlab">TEAM</span> : null}
            </div>
          </div>
          <div className="fa-txt">
            <div className="fa-eb" data-testid="arrival-eyebrow">{card.eyebrow}</div>
            <h1 className="fa-ttl" id="fa-title" data-testid="arrival-title">
              {card.title}
            </h1>
            <p className="fa-lead">{card.lead}</p>
            <div className={`fa-chip${card.kind === "team" ? " fa-chip-team" : ""}`} data-testid="arrival-chip">
              {card.kind === "team" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F0CF86" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
                  <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
                  <path d="M18.5 14a6.5 6.5 0 0 1 3 6" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#E8873A" aria-hidden="true">
                  <path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2.5 1.4-4 2.5-5.2.3 1.6 1.1 2.5 2 2.7C11 8 11 5 12 2z" />
                </svg>
              )}
              {card.chip}
            </div>
          </div>
          <div className="fa-rule" aria-hidden="true">
            <i />
            <b />
            <i />
          </div>
          <div className={`fa-steps${card.kind === "team" ? " fa-grid" : ""}`} data-testid="arrival-tiles">
            {card.tiles.map((t, k) => (
              <a key={t.href} href={t.href} className={`fa-step${t.wide ? " fa-wide" : ""}`} style={{ animationDelay: `${(3.6 + k * (card.kind === "team" ? 0.1 : 0.12)).toFixed(2)}s` }} onClick={stamp} data-testid="arrival-tile" data-href={t.href}>
                {t.numeral ? (
                  <span className="fa-num">{t.numeral}</span>
                ) : (
                  <span className="fa-ic">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d={t.icon} />
                    </svg>
                  </span>
                )}
                <span className="fa-st">
                  <span className="fa-st-h">{t.label}</span>
                  <span className="fa-st-p">{t.line}</span>
                </span>
              </a>
            ))}
          </div>
          <div className="fa-cta">
            <button type="button" className="fa-coin" onClick={go} ref={ctaRef} data-testid="arrival-cta">
              {card.button}
            </button>
          </div>
        </div>
      </div>
      <div className="fa-flakes" aria-hidden="true">
        {flakes.map((f, j) => (
          <i key={j} className={`fa-fl${f.leaf ? " fa-lf" : " fa-c"}`} style={{ left: `${f.left}%`, width: `${f.w}px`, height: `${f.h}px`, animationDelay: `${f.delay}s`, animationDuration: `${f.dur}s` }} />
        ))}
      </div>
      <div className="fa-gate" aria-hidden="true" data-testid="arrival-gate">
        <div className="fa-wall" />
        <div className="fa-cornice fa-t" />
        <div className="fa-attic">
          <div className="fa-insc">HELIXOS</div>
          <div className="fa-insc2">AVE · {card.nameUp}</div>
        </div>
        <div className="fa-cornice" />
        <div className="fa-colm fa-l">
          <i className="fa-cap" />
          <i className="fa-shaft" />
          <i className="fa-base" />
        </div>
        <div className="fa-colm fa-r">
          <i className="fa-cap" />
          <i className="fa-shaft" />
          <i className="fa-base" />
        </div>
        <div className="fa-torch fa-l">
          <i className="fa-gl" />
          <i className="fa-arm" />
          <i className="fa-cup" />
          <i className="fa-fla" />
        </div>
        <div className="fa-torch fa-r">
          <i className="fa-gl" />
          <i className="fa-arm" />
          <i className="fa-cup" />
          <i className="fa-fla" />
        </div>
        <div className="fa-arch">
          <i className="fa-key" />
          <div className="fa-open">
            <div className="fa-sunin" />
            <Sky full={false} />
            <div className="fa-seam" />
            <div className="fa-door fa-l">
              <i className="fa-boss" />
              <i className="fa-rng" />
            </div>
            <div className="fa-door fa-r">
              <i className="fa-boss" />
              <i className="fa-rng" />
            </div>
          </div>
        </div>
        <div className="fa-stairs" />
      </div>
      <div className="fa-ctl">
        <button type="button" className="fa-cbtn" onClick={replay} aria-label="Play the welcome again" data-testid="arrival-replay">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
        </button>
        <button type="button" className="fa-cbtn" onClick={skip} ref={skipRef} data-testid="arrival-skip">
          Skip
        </button>
      </div>
    </div>
  );
}
