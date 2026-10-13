"use client";

import { useEffect, useState } from "react";
import { countdown } from "@/lib/hermes/when";

/** "Starts in" days, hours, minutes and seconds to the call, ticking each second; the server's first value until the page wakes. */
export function Countdown({ startsAt, initialNow }: { startsAt: string; initialNow: number }) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const c = countdown(startsAt, now);
  const parts: [string, string][] = [
    [c.d, "Days"],
    [c.h, "Hrs"],
    [c.m, "Min"],
    [c.s, "Sec"],
  ];
  return (
    <div className="hm-countdown" role="timer" aria-label={`Starts in ${c.d} days, ${c.h} hours and ${c.m} minutes`} data-testid="hm-countdown">
      <span className="hm-countdown-label hm-serif">
        Starts
        <br />
        in
      </span>
      <div className="hm-countdown-parts" aria-hidden="true">
        {parts.map(([v, label], i) => (
          <span key={label} style={{ display: "contents" }}>
            {i > 0 ? <span className="hm-countdown-sep">:</span> : null}
            <span className="hm-countdown-part">
              <b>{v}</b>
              <small>{label.toUpperCase()}</small>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
