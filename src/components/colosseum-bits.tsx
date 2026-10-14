"use client";

import { useActionState } from "react";
import { removeWinAction, shareWinAction, type WinFormState } from "@/lib/actions/colosseum";
import { WIN_MAX } from "@/lib/engine/colosseum";
import type { ArenaWin } from "@/lib/colosseum";
import { SubmitButton } from "@/components/submit-button";
import { formatDateTime } from "@/lib/dates";

/** "Share a win" (rev 699 §5): business or community, the member's own words, plain text. */
export function ShareWin() {
  const [state, action] = useActionState<WinFormState, FormData>(shareWinAction, null);
  return (
    <form action={action} className="co-share" data-testid="share-win">
      <label className="co-kind">
        <input type="radio" name="kind" value="business" defaultChecked /> Business win
      </label>
      <label className="co-kind">
        <input type="radio" name="kind" value="community" /> Community win
      </label>
      <input className="field" name="text" maxLength={WIN_MAX} placeholder="Three calls booked from one post" required data-testid="share-win-text" />
      {state?.error ? <p className="co-err" role="alert" data-testid="share-win-error">{state.error}</p> : null}
      {state?.ok ? <p className="co-ok" role="status" data-testid="share-win-ok">Shared.</p> : null}
      <SubmitButton className="co-btn co-primary" pendingText="Sharing…" data-testid="share-win-send">
        Share a win
      </SubmitButton>
    </form>
  );
}

/** The feed, newest first; a member's own win can come down again. */
export function WinList({ wins, tz, removable = false }: { wins: ArenaWin[]; tz: string; removable?: boolean }) {
  if (!wins.length) return <p className="co-quiet" data-testid="no-wins">No wins shared yet. Be the first.</p>;
  return (
    <ul className="co-wins" data-testid="wins">
      {wins.map((w) => (
        <li key={w.id} className="co-win" data-testid="win" data-kind={w.kind}>
          <span className="co-kindtag">{w.kind === "business" ? "Business" : "Community"}</span>
          <span className="co-wintext">
            <b>{w.who}</b> {w.text}
          </span>
          <span className="co-when">{formatDateTime(w.at, tz)}</span>
          {removable && w.mine ? (
            <form action={removeWinAction}>
              <input type="hidden" name="id" value={w.id} />
              <SubmitButton className="co-link" pendingText="Taking it down…" data-testid="win-remove">
                Take it down
              </SubmitButton>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
