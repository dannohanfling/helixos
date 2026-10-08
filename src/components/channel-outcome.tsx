import Link from "next/link";
import { summarize, type ChannelOutcome, type OutcomeFix, type OutcomeState } from "@/lib/engine/channel-outcome";
import { SubmitButton } from "@/components/submit-button";

/** Where a Fix it button goes (friction walk C1): the Publishing card, or the post's own Distribute page. */
export const fixHref = (fix: OutcomeFix, contentId: string): string => (fix.where === "publishing" ? "/settings#publishing" : `/content/${contentId}/repurpose`);

/**
 * The plain banner over a post with a channel that did not send (friction walk C1, 7 Oct: the failure hid behind "2 of 3
 * published · 1 didn't send" and its reason read as vendor text): each failed channel in a sentence, and one Fix it button
 * that goes where the fix is. Nothing when every channel is fine.
 */
export function FailedBanner({ outcomes, contentId, title, className = "" }: { outcomes: ChannelOutcome[]; contentId: string; title?: string; className?: string }) {
  const failed = outcomes.filter((o) => o.state === "failed");
  if (!failed.length) return null;
  const fix = failed[0].fix ?? { where: "publishing" as const, label: "Fix it" };
  return (
    <div className={`rounded-lg border border-danger bg-danger-soft p-3 text-sm ${className}`} role="alert" data-testid="failed-banner">
      {title ? <div className="font-semibold">{title}</div> : null}
      <ul className="space-y-0.5">
        {failed.map((o) => (
          <li key={o.id} data-testid="failed-line">
            <span className="font-semibold">{o.label} didn&apos;t send.</span> {o.reason}
          </li>
        ))}
      </ul>
      <Link href={fixHref(fix, contentId)} className="btn btn-primary btn-xs mt-2" data-testid="failed-fix">
        {fix.label} →
      </Link>
    </div>
  );
}

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
export function OutcomeRows({ outcomes, checkAction, repostAction, compact = false, inForm = false, contentId }: { outcomes: ChannelOutcome[]; checkAction?: (formData: FormData) => Promise<void>; /** "Post again to this channel" on a published row (rev 567): a deliberate second post, never the ordinary save. */ repostAction?: (formData: FormData) => Promise<void>; compact?: boolean; inForm?: boolean; /** The post, when known: a failed row then carries its Fix it link (friction walk C1). */ contentId?: string }) {
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
          {o.state === "failed" && o.fix && contentId ? (
            <Link href={fixHref(o.fix, contentId)} className="underline" data-testid="outcome-fix">
              {o.fix.label} →
            </Link>
          ) : null}
          {repostAction && o.canRepost ? (
            <span className={checkAction && o.canCheck ? "" : "ml-auto"}>
              {inForm ? (
                <>
                  <input type="hidden" name="variantId" value={o.id} />
                  <SubmitButton className="btn btn-ghost btn-xs" formAction={repostAction} pendingText="Posting again…" data-testid="repost-channel" title="A second post of this version, now, through the Social Planner">
                    Post again to this channel
                  </SubmitButton>
                </>
              ) : (
                <form action={repostAction}>
                  <input type="hidden" name="variantId" value={o.id} />
                  <SubmitButton className="btn btn-ghost btn-xs" pendingText="Posting again…" data-testid="repost-channel" title="A second post of this version, now, through the Social Planner">
                    Post again to this channel
                  </SubmitButton>
                </form>
              )}
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
