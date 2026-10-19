"use client";

/**
 * The welcome's small flame (docs/welcome/daily-welcome-flame-v1.dc.html), as Roma Vivit draws it on the Forum's centre column
 * and the Council Chamber's candles: three layers, each wavering on its own (amb-l1 to amb-l3 in ambience.css). Each flame gets
 * its own gradient ids, so several on one page never borrow each other's.
 */
import { useId } from "react";

export function AmbienceFlame() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 80 96">
      <defs>
        <linearGradient id={`${id}o`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#8E2F0C" />
          <stop offset=".25" stopColor="#D2531A" />
          <stop offset=".6" stopColor="#F28C2E" />
          <stop offset="1" stopColor="#FFB040" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}m`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#F59A34" />
          <stop offset=".5" stopColor="#FFC45C" />
          <stop offset="1" stopColor="#FFD98A" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}c`} cx=".5" cy=".7" r=".5">
          <stop offset="0" stopColor="#FFFBEF" />
          <stop offset=".5" stopColor="#FFE7A8" />
          <stop offset="1" stopColor="#FFD27A" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="amb-lv amb-l1">
        <path d="M40 4C43 17 58 26 63 42C68 60 63 76 53 85C47 91 33 91 27 85C17 76 12 60 17 44C20 34 29 28 32 18C35 26 36 31 38 34C39 24 37 13 40 4Z" fill={`url(#${id}o)`} />
      </g>
      <g className="amb-lv amb-l2">
        <path d="M40 28C43 38 53 45 55 58C57 71 51 81 40 86C29 81 23 71 25 58C27 49 33 45 35 39C37 43 38 45 39 47C39 41 39 34 40 28Z" fill={`url(#${id}m)`} />
      </g>
      <g className="amb-lv amb-l3">
        <ellipse cx="40" cy="72" rx="13" ry="14" fill={`url(#${id}c)`} />
      </g>
    </svg>
  );
}
