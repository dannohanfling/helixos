"use client";

/**
 * The arena (rev 699 §3 and §4, the photo of rev 720): the overhead photo, golden hour or night, with every member on their
 * tier's ring, slowly circling from one rAF loop (one transform per avatar, back to front), and this week's champions still
 * on the sand. Pause is remembered; reduced motion holds every avatar at its spread position; a hidden tab pauses the loop.
 * Tap an avatar for its card. Avatars are initials, or the member's own photo when they've opted in; never under 44px.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { setArenaPausedAction } from "@/lib/actions/colosseum";
import { setSceneLookAction } from "@/lib/actions/scene";
import { CHAMPION_SPOTS, LAP_SECONDS, RING_WORDS, seatAngle, seatPlace } from "@/lib/engine/colosseum";
import type { ArenaSeat } from "@/lib/colosseum";
import { ColosseumAmbience } from "@/components/colosseum-ambience";
import { top3CheerKey } from "@/lib/engine/ambience";
import { armSounds, playSound } from "@/lib/sounds";

type Look = "day" | "night";
type RingSeat = ArenaSeat & { ring: number; index: number; of: number };

export function ColosseumArena({ rings, champs, more, initialLook, initialPaused, ownLook, cheerWeek }: { rings: RingSeat[][]; champs: ArenaSeat[]; more: number[]; initialLook: Look; initialPaused: boolean; ownLook: boolean; cheerWeek: string | null }) {
  const [look, setLook] = useState<Look>(initialLook);
  const [paused, setPaused] = useState(initialPaused);
  const [picked, setPicked] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<Look>>(() => new Set());
  const photo = useRef<HTMLImageElement>(null);
  // A picture that failed before React attached its handler (the error fires while the HTML loads) is caught here.
  useEffect(() => {
    const el = photo.current;
    if (el && el.complete && el.naturalWidth === 0) setBroken((b) => new Set(b).add(look));
  }, [look]);
  const box = useRef<HTMLDivElement>(null);
  const all = useMemo(() => rings.flat(), [rings]);
  const byId = useMemo(() => new Map([...all, ...champs].map((s) => [s.id, s])), [all, champs]);

  // One loop: each avatar's angle from the page's clock, held when paused, hidden or asked to keep still.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = [...el.querySelectorAll<HTMLButtonElement>("[data-seat]")].map((n) => ({ n, ring: Number(n.dataset.ring), index: Number(n.dataset.index), of: Number(n.dataset.of) }));
    let raf = 0;
    let t0 = performance.now();
    let held = 0;
    const put = (t: number) => {
      const seconds = held + (t - t0) / 1000;
      // Drawn back to front: the lower on the picture, the later in the stack.
      const placed = nodes.map((x) => ({ x, p: seatPlace(x.ring, seatAngle(x.ring, x.index, x.of, seconds)) })).sort((a, b) => a.p.y - b.p.y);
      placed.forEach(({ x, p }, z) => {
        x.n.style.left = `${p.x.toFixed(2)}%`;
        x.n.style.top = `${p.y.toFixed(2)}%`;
        x.n.style.transform = `translate(-50%, -50%) scale(${p.scale.toFixed(3)})`;
        x.n.style.zIndex = String(10 + z);
      });
      return seconds;
    };
    held = put(t0);
    if (reduce || paused) return;
    const tick = (t: number) => {
      put(t);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const wake = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        t0 = performance.now() - 0;
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [rings, paused]);

  // The top-3 cheer (H-637): once a week, the first time the member sees themselves among this week's champions. The mark is
  // this browser's, and it is only set once the cheer has actually started: before the first tap on the page, or with sounds off,
  // it waits, so a cheer nobody heard is never counted.
  const champMe = champs.find((c) => c.isYou)?.membershipId ?? null;
  useEffect(() => {
    if (!cheerWeek || !champMe) return;
    const key = top3CheerKey(champMe, cheerWeek);
    const seen = () => {
      try {
        return localStorage.getItem(key) !== null;
      } catch {
        return true;
      }
    };
    if (seen()) return;
    armSounds();
    const tryCheer = () => {
      if (seen() || !playSound("cheer-top3")) return false;
      try {
        localStorage.setItem(key, "1");
      } catch {}
      return true;
    };
    if (tryCheer()) return;
    // The sounds module unlocks on the same gesture, in an earlier listener; the cheer follows it on the next tick.
    let t = 0;
    const onGesture = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (tryCheer()) off();
      }, 0);
    };
    const evs = ["pointerdown", "keydown"] as const;
    const off = () => evs.forEach((ev) => window.removeEventListener(ev, onGesture, true));
    evs.forEach((ev) => window.addEventListener(ev, onGesture, true));
    return () => {
      window.clearTimeout(t);
      off();
    };
  }, [cheerWeek, champMe]);

  const pick = picked ? byId.get(picked) : null;
  const avatar = (s: ArenaSeat, extra: string, attrs: Record<string, string | number | undefined>) => (
    <button
      key={s.id}
      type="button"
      className={`co-av${s.isYou ? " co-you" : ""}${s.champ ? " co-champ" : ""}${picked === s.id ? " co-sel" : ""}${extra}`}
      aria-label={`${s.name}, ${s.tier.toLowerCase()}, ${s.points.toLocaleString()} points${s.champ ? `, champion ${s.champ} of the week` : ""}`}
      aria-pressed={picked === s.id}
      onClick={() => setPicked((p) => (p === s.id ? null : s.id))}
      data-testid={s.champ ? "arena-champ" : "arena-seat"}
      {...attrs}
    >
      {s.photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in route; next/image cannot fetch it
        <img src={`/api/headshots/${s.membershipId}`} alt="" loading="lazy" decoding="async" />
      ) : (
        <span aria-hidden="true">{s.initials}</span>
      )}
    </button>
  );

  return (
    <div className="co-wrap">
      <div ref={box} className={`co-arena co-${look}`} data-testid="arena" data-look={look} data-paused={paused ? "1" : "0"}>
        {broken.has(look) ? null : (
          <picture>
            <source srcSet={`/colosseum/colosseum-${look}.avif`} type="image/avif" />
            <source srcSet={`/colosseum/colosseum-${look}.webp`} type="image/webp" />
            {/* A picture that fails to load hides itself (H-96): the dark fallback shows, never a broken-image icon. */}
            <img ref={photo} className="co-bg" src={`/colosseum/colosseum-${look}.jpg`} alt="" width={1680} height={944} decoding="async" onError={() => setBroken((b) => new Set(b).add(look))} data-testid="arena-photo" />
          </picture>
        )}
        {broken.has(look) ? null : <ColosseumAmbience look={look} paused={paused} />}
        {rings.map((ring, r) =>
          ring.map((s) => {
            const p = seatPlace(r, seatAngle(r, s.index, s.of, 0));
            return avatar(s, "", { "data-seat": "1", "data-ring": r, "data-index": s.index, "data-of": s.of, style: undefined, ...({ style: { left: `${p.x}%`, top: `${p.y}%` } } as unknown as Record<string, string>) });
          }),
        )}
        {champs.map((c, i) => avatar(c, "", { style: { left: `${CHAMPION_SPOTS[i].x}%`, top: `${CHAMPION_SPOTS[i].y}%` } as unknown as string }))}
        {more.map((n, r) =>
          n > 0 ? (
            <a key={r} href={`/rewards?tab=colosseum&section=standings&tier=ring${r}`} className="co-more" style={{ left: `${seatPlace(r, Math.PI / 2).x}%`, top: `${seatPlace(r, Math.PI / 2).y + 6}%` }} data-testid="arena-more">
              +{n} more
            </a>
          ) : null,
        )}
      </div>
      <div className="co-bar">
        <div className="co-ctrl" role="group" aria-label="Arena controls">
          <button
            type="button"
            className="co-btn"
            aria-pressed={paused}
            onClick={() => {
              const next = !paused;
              setPaused(next);
              void setArenaPausedAction(next);
            }}
            data-testid="arena-pause"
          >
            {paused ? "Set the arena moving" : "Pause the arena"}
          </button>
          {ownLook ? (
            <span className="co-looks" role="group" aria-label="Golden hour or night">
              {(["day", "night"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`co-btn${look === k ? " co-on" : ""}`}
                  aria-pressed={look === k}
                  onClick={() => {
                    setLook(k);
                    void setSceneLookAction(k);
                  }}
                  data-testid={`arena-look-${k}`}
                >
                  {k === "day" ? "Golden hour" : "Night"}
                </button>
              ))}
            </span>
          ) : null}
        </div>
        <p className="co-legend">
          {RING_WORDS.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
          <span>Arena floor: this week&apos;s champions</span>
        </p>
      </div>
      {pick ? (
        <div className="co-card" role="dialog" aria-label={`${pick.name}'s seat`} data-testid="arena-card">
          <b>{pick.name}</b>
          <span className="co-rank">{pick.tier}</span>
          <span>
            {pick.points.toLocaleString()} points · +{pick.week.toLocaleString()} this week{pick.champ ? ` · Champion #${pick.champ} of the week` : ""}
          </span>
          <button type="button" className="co-btn" onClick={() => setPicked(null)} aria-label="Close">
            Close
          </button>
        </div>
      ) : null}
      <p className="sr-only">One lap of the front rows takes {LAP_SECONDS[0]} seconds; the top rows {LAP_SECONDS[3]}.</p>
    </div>
  );
}
