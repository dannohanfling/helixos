"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { markRankClipSeenAction, markTierCelebratedAction } from "@/lib/actions/tiers";
import type { RankCard, RankClip } from "@/lib/engine/scenes";
import { armSounds, playSound } from "@/lib/sounds";
import { lbSerif } from "@/components/leaderboard/fonts";
import { useHidden, useQuiet } from "./scene-life";
import "./rank-up.css";

/** The welcome says so when it closes; a rank-up due on the same open waits for it. */
export const WELCOME_CLOSED = "helixos:welcome-closed";
/** The catch-up ceremony says so when it closes; the daily welcome held back for it starts then. */
export const RANK_CLOSED = "helixos:rank-closed";
/** The medal's strike (the design's --t for the second phone), the clip's ceiling, and the card's run from the strike to the last button. */
const MEDAL_MS = 1300;
const CLIP_MAX_MS = 15000;
const CARD_MS = 2000;

/**
 * `catchUp` (H-934): the ceremony for a rank reached before the relic clips, first thing on the open: "first" when the daily
 * welcome waits for it, "alone" when there's none today (its close then tells the streak flame the opening is over).
 */
export type RankUpProps =
  | { stampOnly: true; level: number; clipOnly?: boolean }
  | { stampOnly: false; card: RankCard; clip: RankClip | null; afterWelcome: boolean; catchUp?: "first" | "alone" };

/**
 * The rank-up ceremony (H-327 §1): once per rank, ever, the highest of several at once, after the welcome when both are due.
 * The gold window plays the rank's relic clip once (or the struck medal while the rank has no clip), then the card as drawn:
 * the eyebrow, "You have risen to", the name struck in gold, the points and the seat, the ladder, the next rank. Skip and
 * Escape jump to the end; reduced motion shows the end; a hidden tab pauses it. The one write, the rank seen, lands when the
 * member closes it, so a navigation mid-ceremony never pulls the card away. A member whose seen rank was never recorded is
 * stamped silently at their current rank instead, as before.
 */
export function RankUp(props: RankUpProps) {
  if (props.stampOnly) return <RankStamp level={props.level} clipOnly={props.clipOnly ?? false} />;
  return <Ceremony card={props.card} clip={props.clip} afterWelcome={props.catchUp ? false : props.afterWelcome} catchUp={props.catchUp} />;
}

/** A silent stamp: the rank seen (never recorded before), or only its clip seen (reached after the clips went live, H-934). */
function RankStamp({ level, clipOnly }: { level: number; clipOnly: boolean }) {
  useEffect(() => {
    void (clipOnly ? markRankClipSeenAction(level) : markTierCelebratedAction(level));
  }, [level, clipOnly]);
  return null;
}

const Laurel = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
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

/** The struck gold medal with the laurel and the rank's numeral: every rank has a ceremony before its clip exists. */
const Medal = ({ numeral }: { numeral: string }) => (
  <>
    <div className="rk-mrays sc-live" />
    <div className="rk-medal" data-testid="rank-medal">
      <Laurel />
      <span className="rk-medal-n">{numeral}</span>
    </div>
  </>
);

function Ceremony({ card, clip, afterWelcome, catchUp }: { card: RankCard; clip: RankClip | null; afterWelcome: boolean; catchUp?: "first" | "alone" }) {
  const router = useRouter();
  const quiet = useQuiet();
  const hidden = useHidden();
  const [open, setOpen] = useState(!afterWelcome);
  const [closed, setClosed] = useState(false);
  const [struck, setStruck] = useState(false);
  const [done, setDone] = useState(false);
  const [ended, setEnded] = useState(false);
  const [shared, setShared] = useState<"" | "shared" | "saved">("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const showing = open && !closed;
  const go = struck || quiet;
  const finished = done || ended || quiet;

  useEffect(() => {
    armSounds();
    // Opens on the welcome's word; a layout render after the welcome went (afterWelcome now false) opens it on the next tick.
    const on = () => setOpen(true);
    window.addEventListener(WELCOME_CLOSED, on);
    const t = afterWelcome ? null : setTimeout(on, 0);
    return () => {
      window.removeEventListener(WELCOME_CLOSED, on);
      if (t) clearTimeout(t);
    };
  }, [afterWelcome]);
  // The window: the clip to its end (or its error, or a ceiling), the medal's strike by the clock.
  useEffect(() => {
    if (!showing || quiet) return;
    skipRef.current?.focus();
    const v = videoRef.current;
    if (clip && v) {
      v.src = clip.webm && (v.canPlayType("video/webm") || !clip.mp4) ? clip.webm : (clip.mp4 ?? clip.webm ?? "");
      void v.play().catch(() => {});
    }
    const t = setTimeout(() => setStruck(true), clip ? CLIP_MAX_MS : MEDAL_MS);
    return () => clearTimeout(t);
  }, [showing, quiet, clip]);
  // The strike: the cheer under it, then the card's run to its end.
  useEffect(() => {
    if (!showing || !struck || quiet) return;
    playSound("cheer-rankup");
    const t = setTimeout(() => setEnded(true), CARD_MS);
    return () => clearTimeout(t);
  }, [showing, struck, quiet]);
  useEffect(() => {
    if (showing && finished) ctaRef.current?.focus();
  }, [showing, finished]);
  // A hidden tab pauses the clip; back in view, it goes on unless the window is done.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !showing) return;
    if (hidden) v.pause();
    else if (!go && !done) void v.play().catch(() => {});
  }, [hidden, showing, go, done]);
  const jump = () => {
    videoRef.current?.pause();
    setStruck(true);
    setDone(true);
  };
  const close = () => {
    setClosed(true);
    if (!catchUp) void markTierCelebratedAction(card.level);
    // A clip played: the rank's relic is seen, so no catch-up ever plays it again (H-934).
    if (clip) void markRankClipSeenAction(card.level);
    if (catchUp) {
      window.dispatchEvent(new Event(RANK_CLOSED));
      if (catchUp === "alone") window.dispatchEvent(new Event(WELCOME_CLOSED));
    }
  };
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (finished) close();
      else jump();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, finished, card.level]);
  if (!showing) return null;

  const seat = () => {
    close();
    router.push("/colosseum");
  };
  const share = async () => {
    const blob = await drawCard(card);
    if (!blob) return;
    const file = new File([blob], `helixos-rank-${card.slug}.png`, { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: `New rank: ${card.name}`, text: card.line });
        setShared("shared");
        return;
      } catch {
        // Dismissed, or refused: the image is still theirs to keep.
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setShared("saved");
  };
  const state = done || quiet ? "done" : ended ? "ended" : struck ? "card" : clip ? "clip" : "medal";
  return (
    <div className={`rk ${lbSerif.variable}${go ? " rk-go" : ""}${done || quiet ? " rk-done" : ""}${hidden ? " sc-paused" : ""}`} role="dialog" aria-modal="true" aria-labelledby="rk-title" data-testid="rank-up" data-rank={card.slug} data-level={card.level} data-window={clip ? "clip" : "medal"} data-state={state} data-shared={shared}>
      <p className="sr-only" aria-live="polite" data-testid="rank-summary">
        {card.summary}
      </p>
      <button type="button" className="rk-skip" onClick={finished ? close : jump} ref={skipRef} data-testid="rank-skip">
        {finished ? "Close" : "Skip"}
      </button>
      <div className="rk-col">
        <div className="rk-win">
          <div className="rk-win-in">
            {clip ? (
              quiet ? (
                clip.poster ? <img className="rk-clip" src={clip.poster} alt="" /> : <Medal numeral={card.numeral} />
              ) : (
                <video ref={videoRef} className="rk-clip" playsInline muted preload="auto" poster={clip.poster ?? undefined} onEnded={() => setStruck(true)} onError={() => setStruck(true)} data-testid="rank-clip" />
              )
            ) : (
              <Medal numeral={card.numeral} />
            )}
          </div>
        </div>
        <div className="rk-head">
          <div className="rk-eb rk-a1" data-testid="rank-eyebrow">{card.eyebrow}</div>
          <div className="rk-pre rk-a2">{card.pre}</div>
          <h2 className="rk-rank" id="rk-title">
            <span className="rk-rw" data-testid="rank-name">{card.name}</span>
          </h2>
          <p className="rk-ln rk-a4" data-testid="rank-line">{card.line}</p>
        </div>
        <div className="rk-lad rk-a5">
          <div className="rk-pips" data-testid="rank-ladder">
            {card.pips.map((p, i) => (
              <span key={i} className={`rk-pip rk-${p}`} data-testid="rank-pip" data-state={p} />
            ))}
          </div>
          <div className="rk-lad-l">
            <span>{card.ends[0]}</span>
            <span>{card.ends[1]}</span>
          </div>
        </div>
        <div className="rk-nx rk-a6">
          <div className="rk-nx-top">
            <span data-testid="rank-next">{card.next ? <>Next: <b>{card.next.name}</b> at {card.next.points.toLocaleString("en-US")}</> : card.nextLine}</span>
            {card.next ? <span className="rk-nx-go">{card.next.toGo.toLocaleString("en-US")} to go</span> : null}
          </div>
          <div className="rk-bar">
            <div className="rk-fill" style={{ width: `${Math.max(2, card.next ? card.next.pct : 100)}%` }} />
          </div>
        </div>
        <div className="rk-btns rk-a7">
          <button type="button" className="rk-cta" onClick={seat} ref={ctaRef} data-testid="rank-seat">
            See my seat
          </button>
          <button type="button" className="rk-sec" onClick={() => void share()} data-testid="rank-share">
            {shared === "saved" ? "Saved to your device" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The card as a picture for the share sheet: the gold frame, the rank and the lines, drawn on a canvas. */
async function drawCard(card: RankCard): Promise<Blob | null> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#100d09";
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, H * 0.3, 40, W / 2, H * 0.3, W * 0.8);
  glow.addColorStop(0, "rgba(212,174,90,0.28)");
  glow.addColorStop(1, "rgba(212,174,90,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  // The medal.
  const cx = W / 2;
  const cy = H * 0.33;
  const r = 190;
  const gold = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  gold.addColorStop(0, "#fff3c8");
  gold.addColorStop(0.16, "#f3d47e");
  gold.addColorStop(0.4, "#d9ac4e");
  gold.addColorStop(0.68, "#b07a2c");
  gold.addColorStop(1, "#7e501c");
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = gold;
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = "#8c5a1e";
  g.stroke();
  g.fillStyle = "#4a2e0c";
  g.font = "700 150px 'Cormorant Garamond', Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(card.numeral, cx, cy + 8);
  // The words.
  g.fillStyle = "#f0cf86";
  g.font = "700 30px Manrope, 'Segoe UI', system-ui, sans-serif";
  g.fillText(card.eyebrow.toUpperCase(), cx, H * 0.56);
  g.fillStyle = "#f1e6cf";
  g.font = "italic 500 54px 'Cormorant Garamond', Georgia, serif";
  g.fillText(card.pre, cx, H * 0.62);
  const metal = g.createLinearGradient(0, H * 0.66, 0, H * 0.76);
  metal.addColorStop(0, "#fbe7a6");
  metal.addColorStop(0.38, "#e8c26a");
  metal.addColorStop(0.68, "#c9973f");
  metal.addColorStop(1, "#9a6526");
  g.fillStyle = metal;
  g.font = "700 150px 'Cormorant Garamond', Georgia, serif";
  g.fillText(card.name, cx, H * 0.71);
  g.fillStyle = "#a7997f";
  g.font = "500 34px Manrope, 'Segoe UI', system-ui, sans-serif";
  wrap(g, card.line, cx, H * 0.81, W - 200, 46);
  g.fillStyle = "#f0cf86";
  g.font = "700 30px Manrope, 'Segoe UI', system-ui, sans-serif";
  g.fillText(card.next ? `${card.nextLine} · ${card.next.toGo.toLocaleString("en-US")} to go` : card.nextLine, cx, H * 0.9);
  g.fillStyle = "#5e4c27";
  g.font = "700 26px Manrope, 'Segoe UI', system-ui, sans-serif";
  g.fillText("HELIXOS · THE COLOSSEUM", cx, H * 0.96);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number): void {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > max && line) {
      g.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else line = t;
  }
  if (line) g.fillText(line, x, yy);
}
