"use client";

import { useState, useTransition } from "react";
import { startHereWatchedAction, tickSetupAction } from "@/lib/actions/setup";
import { playableVideo } from "@/lib/engine/setup";
import { SubmitButton } from "@/components/submit-button";

/**
 * S1a, the Start Here orientation (H-270 §1): the coach's welcome video. A link HelixOS can play (mp4, webm) plays here and the
 * end of it marks the step; any other link (a Recordings share) opens in a new tab and the member ticks "I watched it". No
 * video set shows "Coming soon". Never autoplays; the controls are the browser's own, so the keyboard reaches them.
 */
export function StartHere({ url, watched, canMark }: { url: string | null; watched: boolean; canMark: boolean }) {
  const [done, setDone] = useState(watched);
  const [, start] = useTransition();
  if (!url) {
    return (
      <p className="text-sm text-ink-2" id="start-here" data-testid="start-here-soon">
        <b>Start Here:</b> your coach&rsquo;s welcome video is coming soon. Carry on with the steps below.
      </p>
    );
  }
  if (playableVideo(url)) {
    return (
      <div id="start-here" data-testid="start-here" data-watched={done ? "1" : "0"}>
        <div className="text-sm font-semibold">Start Here: what HelixOS is, setup first, then the pathway</div>
        <video
          className="mt-2 w-full rounded-lg bg-black"
          controls
          preload="metadata"
          playsInline
          src={url}
          data-testid="start-here-video"
          onEnded={() => {
            if (done || !canMark) return;
            setDone(true);
            start(() => startHereWatchedAction());
          }}
        />
        {done ? (
          <p className="mt-1 text-xs text-ink-2" data-testid="start-here-done">
            Watched ✓
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink-2">About 10 minutes. It ticks itself off when it reaches the end.</p>
        )}
      </div>
    );
  }
  return (
    <div id="start-here" data-testid="start-here" data-watched={done ? "1" : "0"}>
      <div className="text-sm font-semibold">Start Here: what HelixOS is, setup first, then the pathway</div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm" data-testid="start-here-open">
          Watch Start Here ↗
        </a>
        {done ? (
          <span className="text-xs text-ink-2" data-testid="start-here-done">
            Watched ✓
          </span>
        ) : canMark ? (
          <form action={tickSetupAction} onSubmit={() => setDone(true)}>
            <input type="hidden" name="key" value="s1a" />
            <input type="hidden" name="on" value="1" />
            <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="start-here-tick">
              I watched it
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}
