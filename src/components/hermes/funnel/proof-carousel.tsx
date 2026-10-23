"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The 3D proof carousel on /start (H-1743, approved in H-1745; block 2 of H-1673). The quotes sit on a gentle ring with
 * arrows, arrow keys and swipe. It is a flat swipe row under 480px, on slow touch phones and with reduced motion, and that
 * flat row is also what the server renders, so the page never waits on this script to show the quotes.
 */
type Quote = { quote: string; who: string };

export function ProofCarousel({ quotes }: { quotes: readonly Quote[] }) {
  const [flat, setFlat] = useState(true);
  const [turn, setTurn] = useState(0);
  const startX = useRef<number | null>(null);
  const n = quotes.length;
  const step = 360 / n;
  // The ring's radius: half a card (150px) over tan(half the angle between cards), so neighbours just touch.
  const radius = Math.round(150 / Math.tan(Math.PI / n));

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 479px), (prefers-reduced-motion: reduce)");
    const nav = navigator as Navigator & { deviceMemory?: number };
    const slow = window.matchMedia("(pointer: coarse)").matches && ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 2);
    const decide = () => setFlat(slow || narrow.matches);
    decide();
    narrow.addEventListener("change", decide);
    return () => narrow.removeEventListener("change", decide);
  }, []);

  const go = (d: number) => setTurn((t) => t + d);
  const front = ((turn % n) + n) % n;

  return (
    <div
      className={`fn-car${flat ? " fn-car-flat" : ""}`}
      data-flat={flat ? "true" : "false"}
      onKeyDown={(e) => {
        if (flat) return;
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      <div
        className="fn-car-stage"
        onPointerDown={(e) => (startX.current = e.clientX)}
        onPointerUp={(e) => {
          const s = startX.current;
          startX.current = null;
          if (flat || s === null || Math.abs(e.clientX - s) < 40) return;
          go(e.clientX < s ? 1 : -1);
        }}
      >
        <ul className="fn-car-ring" style={flat ? undefined : { transform: `translateZ(-${radius}px) rotateY(${-turn * step}deg)` }}>
          {quotes.map((q, i) => {
            const d = Math.min(Math.abs(i - front), n - Math.abs(i - front));
            return (
              <li
                key={q.quote.slice(0, 24)}
                className="fn-car-card"
                style={flat ? undefined : { transform: `rotateY(${i * step}deg) translateZ(${radius}px)`, opacity: d > 1 ? 0.25 : 1 }}
                aria-hidden={flat || d === 0 ? undefined : true}
              >
                <p className="fn-proof-quote">&ldquo;{q.quote}&rdquo;</p>
                <p className="fn-proof-who">{q.who}</p>
              </li>
            );
          })}
        </ul>
      </div>
      {!flat && (
        <div className="fn-car-nav">
          <button type="button" className="fn-car-btn" aria-label="Previous quote" onClick={() => go(-1)}>
            &#8249;
          </button>
          <button type="button" className="fn-car-btn" aria-label="Next quote" onClick={() => go(1)}>
            &#8250;
          </button>
        </div>
      )}
    </div>
  );
}
