import { summarize, type ChannelOutcome, type OutcomeState } from "@/lib/engine/channel-outcome";
import { SubmitButton } from "@/components/submit-button";

/**
 * The one component that says what happened per channel: a light for the glance, the word for the state, the time, and on a
 * failure the reason. Used by the content card, the composer after scheduling and the Distribute page; none of them
 * renders a status any other way. Plain props, no server imports, so it renders on either side.
 */
const LIGHT: Record<OutcomeState, string> = { published: "var(--good)", scheduled: "var(--accent)", sending: "var(--ink-3)", failed: "var(--danger)", manual: "transparent", unknown: "var(--warn)", handed: "var(--accent)", unhanded: "var(--warn)" };

export function OutcomeLight({ state }: { state: OutcomeState }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border" style={{ background: LIGHT[state], borderColor: state === "manual" ? "var(--ink-3)" : LIGHT[state] }} />;
}

export function OutcomeHeadline({ outcomes, className = "" }: { outcomes: ChannelOutcome[]; className?: string }) {
  const s = summarize(outcomes);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} data-testid="outcome-headline" data-worst={s.worst ?? ""}>
      {s.worst ? <OutcomeLight state={s.worst} /> : null}
      <span>{s.headline}</span>
    </span>
  );
}

/**
 * `inForm`: the rows sit inside another form (a version's own), so the check is a button with its own action rather than a
 * nested form, which HTML does not allow and which made the browser re-nest the page and React regenerate it on the client.
 */
export function OutcomeRows({ outcomes, checkAction, compact = false, inForm = false }: { outcomes: ChannelOutcome[]; checkAction?: (formData: FormData) => Promise<void>; compact?: boolean; inForm?: boolean }) {
  if (!outcomes.length) return null;
  return (
    <ul className={`divide-y ${compact ? "text-xs" : "text-sm"}`} data-testid="channel-outcomes">
      {outcomes.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5" data-state={o.state} data-channel={o.channel}>
          <OutcomeLight state={o.state} />
          <span className="font-medium">{o.label}</span>
          <span className={o.state === "failed" ? "text-danger" : o.state === "unknown" || o.state === "unhanded" ? "text-warn" : o.state === "published" ? "text-good" : "text-ink-2"}>{o.word}</span>
          {o.when ? <span className="text-ink-3">{o.when}</span> : null}
          {o.reason ? (
            <span className="basis-full text-ink-2 sm:basis-auto" data-testid="outcome-reason">
              {o.reason}
            </span>
          ) : null}
          {checkAction && o.canCheck && inForm ? (
            <span className="ml-auto">
              <input type="hidden" name="variantId" value={o.id} />
              <SubmitButton className="btn btn-ghost btn-xs" formAction={checkAction} pendingText="Checking…">Check status</SubmitButton>
            </span>
          ) : checkAction && o.canCheck ? (
            <form action={checkAction} className="ml-auto">
              <input type="hidden" name="variantId" value={o.id} />
              <SubmitButton className="btn btn-ghost btn-xs" pendingText="Checking…">Check status</SubmitButton>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
