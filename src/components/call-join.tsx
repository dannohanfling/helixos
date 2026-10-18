"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { joinOpensAt, joinState, type JoinState } from "@/lib/engine/call-join";

/**
 * The Join button for one call (H-828): greyed with "Join opens at 9:50 AM" (the reader's time) until 10 minutes before the
 * start, then a link to the call in a new tab until the end, with "Live now" from the start. It checks the clock every
 * 15 seconds, so a page left open opens on time; crossing into live or over asks the server for the page again, so a live
 * call moves to the top and an ended one leaves.
 */
export function CallJoin({ startIso, endIso, link, tz, initial, badge = true }: { startIso: string; endIso: string; link: string | null; tz: string; /** The server's answer at render, so the first paint matches. */ initial: JoinState; badge?: boolean }) {
  const [state, setState] = useState<JoinState>(initial);
  const router = useRouter();
  const last = useRef(initial);
  useEffect(() => {
    const check = () => {
      const now = joinState({ startIso, endIso }, Date.now());
      if (now === last.current) return;
      const crossed = (now === "live" || now === "over") && last.current !== now;
      last.current = now;
      setState(now);
      if (crossed) router.refresh();
    };
    const first = setTimeout(check, 0);
    const every = setInterval(check, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [startIso, endIso, router]);

  if (state === "over") return <span className="text-xs text-ink-3" data-testid="call-join-over">Ended</span>;
  if (!link) return <span className="text-xs text-ink-3" data-testid="call-join-nolink">Your coach hasn&apos;t set the link yet</span>;
  if (state === "later")
    return (
      <button type="button" className="btn btn-soft btn-sm min-h-11" disabled data-testid="call-join" data-state={state}>
        Join opens at {joinOpensAt({ startIso }, tz)}
      </button>
    );
  return (
    <span className="flex flex-wrap items-center gap-2">
      {badge && state === "live" ? (
        <span className="badge badge-good" data-testid="call-live">
          Live now
        </span>
      ) : null}
      <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm min-h-11" data-testid="call-join" data-state={state}>
        Join ↗
      </a>
    </span>
  );
}
