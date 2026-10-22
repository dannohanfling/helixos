"use client";

/**
 * Birds over a scene (H-1367, plan H-1384): filmed dove and eagle sprites drawn on a transparent canvas laid over a still
 * photo, in the photo's own box. One component for any scene: the Colosseum now, the Forum when it wants it. The numbers
 * (sizes, timings, paths) live in src/lib/engine/scene-birds.ts.
 * - Reduced motion: nothing at all, the photo alone.
 * - The sheets load only once the scene has been on screen (after the photo painted), WebP first, PNG where WebP fails.
 * - It runs only while the box is on screen, the tab shows and the scene isn't held; otherwise it sleeps where it is.
 * - Device pixel ratio capped at 2.
 * `data-birds`: still (asleep or not ready), loading (sheets on their way), flying. `data-crossings`: birds that have crossed.
 */
import { useEffect, useRef, useState } from "react";
import { useHidden, useQuiet } from "@/components/scene-life";
import { MAX_DPR, frameAt, newFlock, placeBird, stepFlock, type Flock, type SpriteMeta } from "@/lib/engine/scene-birds";

export type SpriteSet = { webp: string; png: string; meta: SpriteMeta };
export type BirdSprites = { dove: SpriteSet; eagle: SpriteSet };
type Loaded = { dove: HTMLImageElement; eagle: HTMLImageElement };

function loadSheet(s: SpriteSet): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => {
      const png = new Image();
      png.decoding = "async";
      png.onload = () => resolve(png);
      png.onerror = () => reject(new Error("sheet"));
      png.src = s.png;
    };
    img.src = s.webp;
  });
}

export function SceneBirds({ sprites, held, className = "", testId }: { sprites: BirdSprites; held: boolean; className?: string; testId: string }) {
  const quiet = useQuiet();
  const hidden = useHidden();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [sheets, setSheets] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [crossings, setCrossings] = useState(0);
  const [airborne, setAirborne] = useState(0);
  const onScreen = useRef(false);
  const [visible, setVisible] = useState(false);

  // On screen or not: the sheets are fetched the first time the scene shows, and the sky runs only while it is in view.
  useEffect(() => {
    const c = canvas.current;
    if (!c || quiet) return;
    const io = new IntersectionObserver((entries) => {
      onScreen.current = entries[entries.length - 1].isIntersecting;
      setVisible(onScreen.current);
      if (onScreen.current) setNear(true);
    });
    io.observe(c);
    return () => io.disconnect();
  }, [quiet]);

  useEffect(() => {
    if (!near || quiet || sheets || failed) return;
    let gone = false;
    Promise.all([loadSheet(sprites.dove), loadSheet(sprites.eagle)])
      .then(([dove, eagle]) => {
        if (!gone) setSheets({ dove, eagle });
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
    };
  }, [near, quiet, sheets, failed, sprites]);

  const flock = useRef<Flock | null>(null);
  const run = Boolean(sheets) && visible && !hidden && !held && !quiet;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !sheets || !run) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const rng = Math.random;
    let W = 0;
    let H = 0;
    let dpr = 1;
    const size = () => {
      const r = c.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      W = r.width;
      H = r.height;
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    };
    size();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
    ro?.observe(c);
    flock.current ??= newFlock(rng);
    let last = performance.now();
    let raf = 0;
    let counted = flock.current.crossings;
    let aloft = -1;
    const tick = (now: number) => {
      const f = stepFlock(flock.current!, (now - last) / 1000, rng, W, H);
      last = now;
      flock.current = f;
      ctx.clearRect(0, 0, c.width, c.height);
      for (const b of f.birds) {
        const p = placeBird(b);
        if (!p) continue;
        const img = b.kind === "dove" ? sheets.dove : sheets.eagle;
        const fr = frameAt(p.sheet, b.phase, b.age, b.rate);
        ctx.save();
        ctx.translate(p.x * dpr, p.y * dpr);
        ctx.rotate(p.angle);
        ctx.drawImage(img, fr.sx, fr.sy, p.sheet.frameWidth, p.sheet.frameHeight, (-p.w / 2) * dpr, (-p.h / 2) * dpr, p.w * dpr, p.h * dpr);
        ctx.restore();
      }
      if (f.crossings !== counted) {
        counted = f.crossings;
        setCrossings(counted);
      }
      if (f.birds.length !== aloft) {
        aloft = f.birds.length;
        setAirborne(aloft);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [sheets, run]);

  if (quiet || failed) return null;
  const mode = run ? "flying" : near && !sheets ? "loading" : "still";
  return <canvas ref={canvas} className={className} aria-hidden="true" data-testid={testId} data-birds={mode} data-crossings={crossings} data-airborne={airborne} />;
}
