"use client";

import { useActionState } from "react";
import { setStartHereVideoAction, type VideoFormState } from "@/lib/actions/setup";
import { playableVideo } from "@/lib/engine/setup";
import { SubmitButton } from "@/components/submit-button";

/** The coach's Start Here slot: a link HelixOS plays itself (mp4, webm) or opens (a Recordings share link); empty shows "Coming soon". */
export function StartHereSlot({ url, recordings }: { url: string | null; recordings: { title: string; url: string }[] }) {
  const [state, action] = useActionState<VideoFormState, FormData>(setStartHereVideoAction, null);
  return (
    <form action={action} className="space-y-2" data-testid="start-here-slot">
      <label className="block text-xs">
        The video link
        <input className="field" name="url" type="text" inputMode="url" defaultValue={url ?? ""} placeholder="https://… .mp4, or a Recordings share link" list="start-here-recordings" data-testid="start-here-url" />
      </label>
      {recordings.length ? (
        <datalist id="start-here-recordings">
          {recordings.map((r) => (
            <option key={r.url} value={r.url}>
              {r.title}
            </option>
          ))}
        </datalist>
      ) : null}
      <p className="text-xs text-ink-2">
        {url ? (playableVideo(url) ? "Plays on Today; it ticks S1a when it reaches the end." : "Opens in a new tab; the member ticks S1a with “I watched it”.") : "Nothing set: members see “Coming soon” and carry on with the other steps."}{" "}
        A direct video file (mp4 or webm, hosted anywhere) plays inside HelixOS; a Recordings share link opens Fathom.
      </p>
      <div className="flex items-center gap-2">
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="start-here-save">
          Save
        </SubmitButton>
        {state?.error ? (
          <span className="text-xs text-danger" role="alert">
            {state.error}
          </span>
        ) : state?.ok ? (
          <span className="text-xs text-good" role="status" data-testid="start-here-saved">
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}
