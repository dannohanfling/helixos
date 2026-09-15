import { summarize, type ChannelOutcome, type OutcomeState } from "@/lib/engine/channel-outcome";

/**
 * The one component that says what happened per channel: a light for the glance, the word for the state, the time, and on a
 * failure the reason. Used by the content card, the composer after scheduling and the Distribute page; none of them
 * renders a status any other way. Plain props, no server imports, so it renders on either side.
 */
const LIGHT: Record<OutcomeState, string> = { published: "var(--good)", scheduled: "var(--accent)", sending: "var(--ink-3)", failed: "var(--danger)", manual: "transparent", unknown: "var(--warn)" };

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

export function OutcomeRows({ outcomes, checkAction, compact = false }: { outcomes: ChannelOutcome[]; checkAction?: (formData: FormData) => Promise<void>; compact?: boolean }) {
  if (!outcomes.length) return null;
  return (
    <ul className={`divide-y ${compact ? "text-xs" : "text-sm"}`} data-testid="channel-outcomes">
      {outcomes.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5" data-state={o.state} data-channel={o.channel}>
          <OutcomeLight state={o.state} />
          <span className="font-medium">{o.label}</span>
          <span className={o.state === "failed" ? "text-danger" : o.state === "unknown" ? "text-warn" : o.state === "published" ? "text-good" : "text-ink-2"}>{o.word}</span>
          {o.when ? <span className="text-ink-3">{o.when}</span> : null}
          {o.reason ? (
            <span className="basis-full text-ink-2 sm:basis-auto" data-testid="outcome-reason">
              {o.reason}
            </span>
          ) : null}
          {checkAction && o.canCheck ? (
            <form action={checkAction} className="ml-auto">
              <input type="hidden" name="variantId" value={o.id} />
              <button className="btn btn-ghost btn-xs" type="submit">Check status</button>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
