import { decideTemplateAction } from "@/lib/actions/body";
import { SubmitButton } from "@/components/submit-button";
import { KIND_LABEL, templateSummary, type TemplatePayload } from "@/lib/engine/body-templates";
import type { BodyTemplateSend } from "@/db/schema";

/**
 * "From your coach" (B9a): the templates waiting on the member, each with Accept (their own copy) or Not now. Server component;
 * the same card on Log (every kind) and on the page a kind belongs to. Nothing here is read by the coach.
 */
export function CoachSends({ sends, back, className = "" }: { sends: BodyTemplateSend[]; back: string; className?: string }) {
  if (!sends.length) return null;
  return (
    <section className={`card border-humanos p-4 sm:p-5 ${className}`} data-testid="coach-sends" data-count={sends.length} id="from-your-coach">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-2">From your coach</h2>
      <p className="mb-3 text-xs text-ink-3">A copy of your coach&apos;s own. Accept makes it yours to edit; your coach sees nothing of yours either way.</p>
      <ul className="space-y-2">
        {sends.map((s) => {
          const p = s.payload as unknown as TemplatePayload;
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm" data-testid="coach-send" data-kind={s.kind} data-name={s.name}>
              <div className="min-w-0">
                <div className="font-medium break-words">
                  {KIND_LABEL[s.kind]}: {s.name} <span className="text-xs font-normal text-ink-3">from {s.coachName}</span>
                </div>
                <div className="text-xs text-ink-2 break-words">{templateSummary(p)}</div>
              </div>
              <div className="flex gap-2">
                <form action={decideTemplateAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="decision" value="accept" />
                  <SubmitButton className="btn btn-humanos btn-sm" pendingText="Adding…" data-testid="coach-send-accept">
                    Accept
                  </SubmitButton>
                </form>
                <form action={decideTemplateAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="decision" value="decline" />
                  <SubmitButton className="btn btn-ghost btn-sm" pendingText="…" data-testid="coach-send-decline">
                    Not now
                  </SubmitButton>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
