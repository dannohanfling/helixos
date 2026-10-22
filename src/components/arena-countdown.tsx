"use client";

import { useEffect, useState } from "react";
import { countdown, type Countdown } from "@/lib/engine/arena";

/**
 * The Arena page's countdown (H-1562), its three states as on the approved page: to the start, to the end, then closed. The
 * server renders the first numbers; this keeps them current every 30 seconds. Nothing moves, so reduced motion needs nothing.
 */
export function ArenaCountdown({ initial }: { initial: Countdown }) {
  const [c, setC] = useState(initial);
  useEffect(() => {
    const tick = () => setC(countdown(Date.now()));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      {c.state === "closed" ? null : (
        <div className="ar-count" aria-live="polite" data-testid="arena-count" data-state={c.state}>
          <div>
            <b>{c.days}</b>
            <span>days</span>
          </div>
          <div>
            <b>{c.hours}</b>
            <span>hours</span>
          </div>
          <div>
            <b>{c.minutes}</b>
            <span>min</span>
          </div>
        </div>
      )}
      <p className="ar-count-label">{c.label}</p>
    </>
  );
}
