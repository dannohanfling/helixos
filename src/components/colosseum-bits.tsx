"use client";

import { useActionState, useState } from "react";
import { applaudAction, removeWinAction, shareWinAction, type ApplaudState, type WinFormState } from "@/lib/actions/colosseum";
import { WIN_MAX } from "@/lib/engine/colosseum";
import { REPORTED } from "@/lib/engine/blocks";
import type { ArenaWin } from "@/lib/colosseum";
import { SubmitButton } from "@/components/submit-button";
import { ModerateMenu } from "@/components/colosseum-moderate";
import { formatDateTime } from "@/lib/dates";

/**
 * "Share a win" (rev 699 §5): business or community, the member's own words, plain text. The words are held here, not in the
 * box alone: React empties a form after its action answers, and a win the word filter held back (H-745) keeps its text to reword.
 */
export function ShareWin() {
  const [kind, setKind] = useState<"business" | "community">("business");
  const [text, setText] = useState("");
  // The box empties only once the server says the win is shared; a refusal leaves the words where they were.
  const [state, action] = useActionState<WinFormState, FormData>(async (prev, fd) => {
    const r = await shareWinAction(prev, fd);
    if (r?.ok) setText("");
    return r;
  }, null);
  return (
    <form action={action} className="co-share" data-testid="share-win">
      <label className="co-kind">
        <input type="radio" name="kind" value="business" checked={kind === "business"} onChange={() => setKind("business")} /> Business win
      </label>
      <label className="co-kind">
        <input type="radio" name="kind" value="community" checked={kind === "community"} onChange={() => setKind("community")} /> Community win
      </label>
      <input className="field" name="text" maxLength={WIN_MAX} placeholder="Three calls booked from one post" required value={text} onChange={(e) => setText(e.target.value)} data-testid="share-win-text" />
      {state?.error ? <p className="co-err" role="alert" data-testid="share-win-error">{state.error}</p> : null}
      {state?.ok ? <p className="co-ok" role="status" data-testid="share-win-ok">Shared.</p> : null}
      <SubmitButton className="co-btn co-primary" pendingText="Sharing…" data-testid="share-win-send">
        Share a win
      </SubmitButton>
    </form>
  );
}

/**
 * The feed, newest first; a member's own win can come down again. With `moderate` (a member in their own account), every
 * other member's win has a ⋯ for Block and Report; a reported win leaves the list at once.
 */
export function WinList({ wins, tz, removable = false, moderate = false, applaud = false }: { wins: ArenaWin[]; tz: string; removable?: boolean; moderate?: boolean; applaud?: boolean }) {
  // The thanks for a report lives here, not on the win's row: the refresh that follows drops the reported win from the list,
  // and the thanks has to outlast it.
  const [reported, setReported] = useState<string[]>([]);
  const shown = wins.filter((w) => !reported.includes(w.id));
  return (
    <>
      {reported.length ? (
        <p className="co-ok" data-testid="win-reported" role="status">
          {REPORTED}
        </p>
      ) : null}
      {shown.length ? (
        <ul className="co-wins" data-testid="wins">
          {shown.map((w) => (
            <WinItem key={w.id} w={w} tz={tz} removable={removable} moderate={moderate && !w.mine} applaud={applaud} onReported={() => setReported((r) => [...r, w.id])} />
          ))}
        </ul>
      ) : reported.length ? null : (
        <p className="co-quiet" data-testid="no-wins">
          No wins shared yet. Be the first.
        </p>
      )}
    </>
  );
}

function WinItem({ w, tz, removable, moderate, applaud, onReported }: { w: ArenaWin; tz: string; removable: boolean; moderate: boolean; applaud: boolean; onReported: () => void }) {
  return (
    <li className={`co-win${moderate ? " co-win-mod" : ""}`} data-testid="win" data-kind={w.kind} data-win={w.id}>
      <span className="co-kindtag">{w.kind === "business" ? "Business" : "Community"}</span>
      <span className="co-wintext">
        <b>{w.who}</b> {w.text}
      </span>
      <span className="co-when">{formatDateTime(w.at, tz)}</span>
      <Applause w={w} can={applaud && !w.mine} />
      {moderate ? <ModerateMenu target={{ kind: "win", id: w.id, membershipId: w.authorId, name: w.who, coach: w.coach }} onReported={onReported} /> : null}
      {removable && w.mine ? (
        <form action={removeWinAction}>
          <input type="hidden" name="id" value={w.id} />
          <SubmitButton className="co-link" pendingText="Taking it down…" data-testid="win-remove">
            Take it down
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

/**
 * 👏 on a win (H-1171): a toggle for anyone but the win's author, and the count; tapping the count shows who applauded, first
 * names by each member's Colosseum setting. The count follows the tap at once and the server's own count after.
 */
export function Applause({ w, can }: { w: ArenaWin; can: boolean }) {
  const [state, action] = useActionState<ApplaudState, FormData>(applaudAction, null);
  const on = state?.on ?? w.applause.mine;
  const count = Math.max(0, w.applause.count + (on ? 1 : 0) - (w.applause.mine ? 1 : 0));
  if (!can && !count) return null;
  return (
    <span className="co-applause" data-testid="win-applause" data-count={count} data-on={on ? "1" : "0"}>
      {can ? (
        <form action={action}>
          <input type="hidden" name="winId" value={w.id} />
          <input type="hidden" name="on" value={on ? "0" : "1"} />
          <SubmitButton className={`co-clap${on ? " co-clap-on" : ""}`} pendingText="👏 …" aria-pressed={on} aria-label={on ? "Take back your applause" : "Applaud this win"} data-testid="win-applaud">
            👏 {on ? "Applauded" : "Applaud"}
          </SubmitButton>
        </form>
      ) : null}
      {count ? (
        <details className="co-clappers">
          <summary data-testid="win-applause-count">
            {count} applause
          </summary>
          <span data-testid="win-applause-who">{(state?.on === undefined ? w.applause.who : on ? (w.applause.mine ? w.applause.who : ["You", ...w.applause.who]) : w.applause.who.filter((n) => n !== "You")).join(", ")}</span>
        </details>
      ) : null}
      {state?.error ? (
        <span className="co-err" role="alert">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}
