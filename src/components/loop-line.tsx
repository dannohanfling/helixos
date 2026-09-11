"use client";

import { useEffect, useState } from "react";

type Box = { x: number; y: number; w: number; h: number };

/**
 * A drawn line from one element back to another, inside a positioned parent: the loop in a method that is a loop and not a
 * list. Measured from the two elements' boxes, so it follows the grid at every width; redrawn on resize. Decorative to a
 * screen reader: the words that say "go back" are on the step itself.
 */
export function LoopLine({ from, to, label, parent }: { from: string; to: string; label: string; parent: string }) {
  const [boxes, setBoxes] = useState<{ a: Box; b: Box; w: number; h: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const p = document.getElementById(parent);
      const a = document.getElementById(from);
      const b = document.getElementById(to);
      if (!p || !a || !b) return setBoxes(null);
      const pr = p.getBoundingClientRect();
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return { x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height };
      };
      setBoxes({ a: box(a), b: box(b), w: pr.width, h: pr.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    const p = document.getElementById(parent);
    if (p) ro.observe(p);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [from, to, parent]);
  if (!boxes) return null;
  const { a, b, w, h } = boxes;
  // Out of the bottom-left of the "from" step, along the bottom, up the left edge, into the bottom-left of the "to" step.
  const gutter = 10;
  const start = { x: a.x + 18, y: a.y + a.h };
  const end = { x: b.x + 18, y: b.y + b.h };
  const railY = Math.max(start.y, end.y) + gutter;
  const railX = Math.min(a.x, b.x) - gutter;
  const d = a.y === b.y && a.x > b.x ? `M ${start.x} ${start.y} V ${railY} H ${end.x} V ${end.y + 4}` : `M ${start.x} ${start.y} V ${railY} H ${railX} V ${end.y + gutter} H ${end.x} V ${end.y + 4}`;
  const labelPos = a.y === b.y && a.x > b.x ? { x: (start.x + end.x) / 2, y: railY - 3 } : { x: railX + 6, y: (start.y + end.y) / 2 };
  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-testid="loop-line" data-from={from} data-to={to}>
      <defs>
        <marker id="loop-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-accent" />
        </marker>
      </defs>
      <path d={d} className="stroke-accent" fill="none" strokeWidth="2" strokeDasharray="5 4" markerEnd="url(#loop-arrow)" />
      <text x={labelPos.x} y={labelPos.y} className="fill-accent text-[10px] font-semibold" textAnchor="start">
        {label}
      </text>
    </svg>
  );
}
