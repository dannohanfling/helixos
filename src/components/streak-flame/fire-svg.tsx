/**
 * The static flame (H-552), for no WebGL or a shader that fails: the SVG flame from the approved mockup, in its tier colours.
 * It doesn't move, so it needs no reduced-motion handling.
 */

import { useId } from "react";
import type { FlameLook } from "@/lib/engine/streak-flame";

type Palette = { o: [string, string, string, string]; m: [string, string, string]; c: [string, string]; glow: string; glowOpacity: number; scale: number; laurel: boolean; body: number };

const PALETTES: Record<FlameLook, Palette> = {
  ember: { o: ["#6E1A0C", "#B23C18", "#E0742A", "#F2A541"], m: ["#C2501E", "#F08A2E", "#FFC35C"], c: ["#FFD27A", "#F08A2E"], glow: "rgba(232,110,40,.8)", glowOpacity: 0.55, scale: 0.8, laurel: false, body: 1 },
  torch: { o: ["#8E220E", "#E0521A", "#F7922C", "#FFD15C"], m: ["#F06A1E", "#FFAA3B", "#FFE08A"], c: ["#FFF0B8", "#FFB547"], glow: "rgba(255,140,40,.9)", glowOpacity: 0.7, scale: 1, laurel: false, body: 1 },
  gold: { o: ["#7E400E", "#D9861E", "#F2C14E", "#FFF0B0"], m: ["#E8A33A", "#FFD36B", "#FFF6D2"], c: ["#FFFBE6", "#FFD36B"], glow: "rgba(255,205,100,.95)", glowOpacity: 0.8, scale: 1, laurel: true, body: 1 },
  risk: { o: ["#2E2018", "#56402F", "#7A5236", "#9A6B44"], m: ["#64412C", "#93602F", "#B9824E"], c: ["#D49A5C", "#93602F"], glow: "rgba(176,110,60,.55)", glowOpacity: 0.3, scale: 0.62, laurel: false, body: 0.85 },
};

const LAUREL = "#D4AE5A";

export function FireSvg({ look, width, height, className = "" }: { look: FlameLook; width: number; height: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const p = PALETTES[look];
  const svgH = Math.round(height * p.scale);
  const svgW = Math.round((svgH * 40) / 56);
  const glow = Math.round(height * 1.35);
  return (
    <span aria-hidden="true" data-flame="fire" data-flame-mode="svg" className={`relative flex items-end justify-center ${className}`} style={{ width, height }}>
      <span className="absolute left-1/2 rounded-full" style={{ bottom: -Math.round(height * 0.18), width: glow, height: glow, marginLeft: -Math.round(glow / 2), background: `radial-gradient(circle, ${p.glow} 0%, rgba(0,0,0,0) 68%)`, opacity: p.glowOpacity, filter: `blur(${Math.max(2, Math.round(height * 0.08))}px)` }} />
      <svg viewBox="0 0 40 56" width={svgW} height={svgH} className="relative overflow-visible">
        <defs>
          <linearGradient id={`go-${id}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={p.o[0]} />
            <stop offset="0.38" stopColor={p.o[1]} />
            <stop offset="0.72" stopColor={p.o[2]} />
            <stop offset="1" stopColor={p.o[3]} stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id={`gm-${id}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={p.m[0]} />
            <stop offset="0.55" stopColor={p.m[1]} />
            <stop offset="1" stopColor={p.m[2]} stopOpacity="0.3" />
          </linearGradient>
          <radialGradient id={`gc-${id}`} cx="0.5" cy="0.74" r="0.62">
            <stop offset="0" stopColor="#FFFDF2" />
            <stop offset="0.45" stopColor={p.c[0]} />
            <stop offset="1" stopColor={p.c[1]} stopOpacity="0" />
          </radialGradient>
        </defs>
        {p.laurel ? (
          <g fill={LAUREL}>
            <path d="M11 55C4.5 50 1.5 40 2.8 27" fill="none" stroke={LAUREL} strokeWidth="1" strokeLinecap="round" />
            <path d="M29 55C35.5 50 38.5 40 37.2 27" fill="none" stroke={LAUREL} strokeWidth="1" strokeLinecap="round" />
            <ellipse cx="5.2" cy="49.4" rx="2.8" ry="1.2" transform="rotate(-40 5.2 49.4)" />
            <ellipse cx="2.7" cy="42.4" rx="2.8" ry="1.2" transform="rotate(-65 2.7 42.4)" />
            <ellipse cx="2" cy="34.7" rx="2.8" ry="1.2" transform="rotate(-80 2 34.7)" />
            <ellipse cx="3.2" cy="28" rx="2.6" ry="1.1" transform="rotate(-95 3.2 28)" />
            <ellipse cx="34.8" cy="49.4" rx="2.8" ry="1.2" transform="rotate(40 34.8 49.4)" />
            <ellipse cx="37.3" cy="42.4" rx="2.8" ry="1.2" transform="rotate(65 37.3 42.4)" />
            <ellipse cx="38" cy="34.7" rx="2.8" ry="1.2" transform="rotate(80 38 34.7)" />
            <ellipse cx="36.8" cy="28" rx="2.6" ry="1.1" transform="rotate(95 36.8 28)" />
          </g>
        ) : null}
        <g opacity={p.body}>
          <path d="M20 2C22 10 26 13 27 19C28.5 15 28 11 27 8C32 13 35 21 34 30C33.5 26 32 24 30.5 23C33 30 33.5 38 31 44C29 50 25 54 20 54C15 54 11 50 9 44C6.5 38 7 30 9.5 23C8 24 6.5 26 6 30C5 21 8 13 13 8C12 11 11.5 15 13 19C14 13 18 10 20 2Z" fill={`url(#go-${id})`} />
          <path d="M20 14C21.5 20 25 23 26 29C27 26 27 24 26.5 22C29.5 26 30.5 32 29.5 38C28.5 46 25 52 20 52C15 52 11.5 46 10.5 38C9.5 32 10.5 26 13.5 22C13 24 13 26 14 29C15 23 18.5 20 20 14Z" fill={`url(#gm-${id})`} />
          <path d="M20 28C21 32 24 34 24.5 39C25 45 23 50.5 20 50.5C17 50.5 15 45 15.5 39C16 34 19 32 20 28Z" fill={`url(#gc-${id})`} />
        </g>
      </svg>
    </span>
  );
}
