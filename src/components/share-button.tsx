"use client";

import { useState, useTransition } from "react";
import { recordShareAction } from "@/lib/actions/intentions";

/**
 * "Share to the thread" (piece 2): one tap copies the member's 3-1-3 as a ready-made comment and opens this week's Monday post,
 * where they paste it and press Post under their own name. The copy and the new tab both happen inside the tap (a browser only
 * allows a new tab from a tap), then the tap is recorded for the week's points. When this week's post isn't out yet, the
 * button says so and opens nothing: never an older week's post.
 */
export function ShareButton({ text, link, reason, shared, compact = false }: { text: string; link: string | null; reason: string | null; shared: boolean; compact?: boolean }) {
  const [note, setNote] = useState<string | null>(null);
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
        className={compact ? "btn btn-soft btn-xs" : "btn btn-primary btn-sm"}
        disabled={pending}
        data-testid="share-to-thread"
        data-shared={shared ? "yes" : "no"}
        onClick={() => {
          // The copy starts first so pasting works anywhere, even if the new tab is blocked.
          const copied = navigator.clipboard?.writeText(text).then(
            () => true,
            () => false,
          );
          window.open(link, "_blank", "noopener");
          start(async () => {
            const ok = copied ? await copied : false;
            const r = await recordShareAction();
            if (!r.ok) setNote(r.error ?? "That didn't work. Try again.");
            else setNote(`${ok ? "Your 3-1-3 is copied." : "Couldn't copy it here: select it below and copy."} Paste it as a comment on this week's post and press Post.${r.points ? ` +${r.points} points.` : ""}`);
          });
        }}
      >
        {shared ? "Share to the thread again" : "Share to the thread"}
      </button>
      {note ? (
        <span className={compact ? "text-xs text-ink-2" : "mt-2 block text-sm text-ink-2"} role="status" data-testid="share-note">
          {note}
        </span>
      ) : null}
    </span>
  );
}
