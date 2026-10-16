"use client";

import { useEffect, useRef, useState } from "react";
import type { CloseScene } from "@/lib/engine/scenes";
import { armSounds, playSound } from "@/lib/sounds";
import { lbSerif } from "@/components/leaderboard/fonts";
import { useHidden, useQuiet } from "./scene-life";
import "./evening-close.css";

/** The sequence's length (docs/scenes/living-scenes-closeout.dc.html): the lamps over 3 s, then the card. */
const SEQUENCE_MS = 4300;
const seenKey = (id: string) => `hx-close-${id}`;

/**
 * The evening close (H-327 §2): after the day's close, the night Colosseum unlit, the lamps lighting one by one around the ring
 * (a conic mask sweep on a registered angle), the torch flicker, then the card: "Day closed. The arena is lit.", the close
 * credit from the ledger row the close just wrote, the line about tomorrow, Good night. Once per close: the browser remembers
 * the close row's id, so a reload after the card shows nothing. Always the night look. Skip and Escape jump to the end.
 */
export function EveningClose({ scene }: { scene: CloseScene }) {
  const quiet = useQuiet();
  const hidden = useHidden();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [ended, setEnded] = useState(false);
  const skipRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const finished = done || ended || quiet;
  useEffect(() => {
    armSounds();
    try {
      if (localStorage.getItem(seenKey(scene.id))) return;
      localStorage.setItem(seenKey(scene.id), "1");
    } catch {
      // No storage (a private window that refuses it): the scene still plays this once.
    }
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, [scene.id]);
  useEffect(() => {
    if (!open || quiet) return;
    skipRef.current?.focus();
    playSound("crowd-murmur", 0.9);
    const t = setTimeout(() => setEnded(true), SEQUENCE_MS);
    return () => clearTimeout(t);
  }, [open, quiet]);
  useEffect(() => {
    if (open && finished) ctaRef.current?.focus();
  }, [open, finished]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (finished) setOpen(false);
      else setDone(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finished]);
  if (!open) return null;
  const finish = () => {
    if (finished) setOpen(false);
    else setDone(true);
  };
  return (
    <div className={`ec ${lbSerif.variable}${done || quiet ? " ec-done" : ""}${hidden ? " sc-paused" : ""}`} role="dialog" aria-modal="true" aria-labelledby="ec-title" data-testid="evening-close" data-state={done || quiet ? "done" : ended ? "ended" : "playing"} data-close={scene.id}>
      <img className="ec-bg" src="/colosseum/colosseum-night.jpg" alt="" />
      <img className="ec-glow sc-live" src="/colosseum/colosseum-night.jpg" alt="" />
      <img className="ec-unlit" src="/colosseum/colosseum-night.jpg" alt="" />
      <div className="ec-top" />
      <p className="sr-only" aria-live="polite" data-testid="evening-summary">
        {scene.summary}
      </p>
      <button type="button" className="ec-skip" onClick={finish} ref={skipRef} data-testid="evening-skip">
        Skip
      </button>
      <div className="ec-card">
        <div>
          <div className="ec-eb">{scene.eyebrow}</div>
          <h2 className="ec-ttl" id="ec-title" data-testid="evening-title">
            {scene.title}
          </h2>
          <p className="ec-ln">{scene.line}</p>
        </div>
        <div className="ec-row">
          <span className="ec-coin" data-testid="evening-credit" data-value={scene.credit}>
            {scene.credit}
          </span>
          <div className="ec-row-t">
            <b>+{scene.credit}</b> for closing out the day
            <div className="ec-row-s" data-testid="evening-tomorrow">{scene.tomorrow}</div>
          </div>
        </div>
        <button type="button" className="ec-cta" onClick={() => setOpen(false)} ref={ctaRef} data-testid="evening-cta">
          Good night
        </button>
      </div>
    </div>
  );
}
