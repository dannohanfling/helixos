"use client";

import { useState, useTransition } from "react";
import { recordMonthShareAction, recordShareAction } from "@/lib/actions/intentions";

/**
 * "Share to the thread" (piece 2): one tap copies the member's 3-1-3 as a ready-made comment and opens this week's Monday post,
 * where they paste it and press Post under their own name. The copy and the new tab both happen inside the tap (a browser only
 * allows a new tab from a tap), then the tap is recorded for the week's points. When this week's post isn't out yet, the
 * button says so and opens nothing: never an older week's post.
 */
export function ShareButton({ text, link, reason, shared, compact = false, scope = "week" }: { text: string; link: string | null; reason: string | null; shared: boolean; compact?: boolean; scope?: "week" | "month" }) {
  // The month's share (1 Oct) is the same tap: the eleven answers copied, this month's post opened, recorded once per month.
  const record = scope === "month" ? recordMonthShareAction : recordShareAction;
  const what = scope === "month" ? "your answers" : "your 3-1-3";
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const [done, setDone] = useState(shared);
  const [pending, start] = useTransition();
  if (!link) {
    return (
      <span className={compact ? "text-xs text-ink-3" : "block text-sm text-ink-2"} data-testid="share-unavailable">
        {reason}
      </span>
    );
  }
  return (
    <span className={compact ? "inline-flex flex-wrap items-center gap-2" : "block"}>
      <button
        type="button"
        // The main button under a set week (rev 176): full width, so it can't be missed.
        className={compact ? "btn btn-soft btn-xs" : done ? "btn btn-soft w-full" : "btn btn-primary w-full"}
        disabled={pending}
        data-testid="share-to-thread"
        data-shared={done ? "yes" : "no"}
        onClick={() => {
          // The copy starts first so pasting works anywhere, even if the new tab is blocked.
          const copied = navigator.clipboard?.writeText(text).then(
            () => true,
            () => false,
          );
          window.open(link, "_blank", "noopener");
          start(async () => {
            const ok = copied ? await copied : false;
            const r = await record();
            if (!r.ok) return setNote({ text: r.error ?? "That didn't work. Try again.", good: false });
            setDone(true);
            const points = r.points ? ` +${r.points} points.` : "";
            setNote(ok ? { text: `Copied! On the post, tap Add a comment, paste, and press Post.${points}`, good: true } : { text: `Couldn't copy it here: select ${what} above and copy it. On the post, tap Add a comment, paste, and press Post.${points}`, good: false });
          });
        }}
      >
        {done ? "Shared ✓, open the thread" : "Share to the thread"}
      </button>
      {note ? (
        <span className={`${compact ? "text-xs" : "mt-2 block text-sm"} ${note.good ? "font-medium text-good" : "text-ink-2"}`} role="status" data-testid="share-note">
          {note.text}
        </span>
      ) : null}
    </span>
  );
}
