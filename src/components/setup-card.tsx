import Link from "next/link";
import { tickSetupAction } from "@/lib/actions/setup";
import { minutesWords, nextSetupSteps, setupComplete, setupStats, type SetupStep } from "@/lib/engine/setup";
import { StartHere } from "@/components/start-here";
import { SubmitButton } from "@/components/submit-button";

/**
 * The Setup card on Today (H-270 §1): the next one to three open steps whose needs are met, each with its minutes and link,
 * "N of 20 done", and the Start Here video while it is unwatched. It retires once the first 20 steps are done; the rest stay in
 * Settings → Setup. A step no signal covers carries a tick; a coach's step says it waits on the coach.
 */
export function SetupCard({ steps, video, watched, canTick, coach, withVideo = true }: { steps: SetupStep[]; video: string | null; watched: boolean; canTick: boolean; coach: boolean; withVideo?: boolean }) {
  if (setupComplete(steps)) return null;
  const { done, total } = setupStats(steps);
  const next = nextSetupSteps(steps, 3);
  return (
    <section className="card mb-5 p-5" id="setup" data-testid="setup-card" data-done={done} data-total={total}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Setup</div>
        <div className="text-sm text-ink-2" data-testid="setup-count">
          {done} of {total} done
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} />
      </div>
      {withVideo && !watched && steps.some((s) => s.key === "s1a" && !s.done) ? (
        <div className="mt-3">
          <StartHere url={video} watched={watched} canMark={canTick} />
        </div>
      ) : null}
      <ol className="mt-3 space-y-2" data-testid="setup-next">
        {next.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface p-3 text-sm" data-testid="setup-step" data-key={s.key} data-signal={s.signal}>
            <div className="min-w-0">
              <div className="font-medium" data-testid="setup-step-label">
                {s.label}
              </div>
              <div className="text-xs text-ink-2">
                {s.minutes ? minutesWords(s.minutes) : s.signal === "coach-tick" ? "Your coach confirms this" : "A tick when it's done"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {s.signal === "coach-tick" ? (
                coach && canTick ? (
                  <form action={tickSetupAction}>
                    <input type="hidden" name="key" value={s.key} />
                    <input type="hidden" name="on" value="1" />
                    <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="setup-coach-tick">
                      Confirm as their coach
                    </SubmitButton>
                  </form>
                ) : (
                  <span className="text-xs text-ink-3" data-testid="setup-waits-coach">
                    Waiting on your coach
                  </span>
                )
              ) : s.signal === "tick" && canTick ? (
                <form action={tickSetupAction}>
                  <input type="hidden" name="key" value={s.key} />
                  <input type="hidden" name="on" value="1" />
                  <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="setup-tick">
                    Done
                  </SubmitButton>
                </form>
              ) : null}
              {s.key === "s1a" ? null : (
                <Link href={s.href} className="btn btn-primary btn-sm" data-testid="setup-step-open">
                  Open →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-2">
        Each step opens once what it needs is done.{" "}
        <Link href="/settings#setup" className="underline" data-testid="setup-all">
          Every setup step
        </Link>
      </p>
    </section>
  );
}

/** Settings → Setup: every step by group with its tick, the link, and who confirms it; folded. */
export function SetupList({ steps, video, canTick, coach }: { steps: SetupStep[]; video: string | null; canTick: boolean; coach: boolean }) {
  const { done, total } = setupStats(steps);
  return (
    <details className="card mb-4 p-4" id="setup" data-testid="setup-list" open={setupComplete(steps) ? undefined : undefined}>
      <summary className="cursor-pointer text-sm font-semibold">
        Setup: {done} of {total} done{setupComplete(steps) ? " · the rest when you need them" : ""}
      </summary>
      <div className="mt-3 space-y-4">
        {groupsOf(steps).map((g) => (
          <div key={g.key}>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">{g.name}</div>
            <ul className="mt-1 divide-y">
              {g.steps.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="setup-list-step" data-key={s.key} data-done={s.done ? "1" : "0"}>
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className={s.done ? "text-good" : "text-ink-3"}>
                      {s.done ? "✓" : "○"}
                    </span>
                    <span className={s.done ? "text-ink-2" : ""}>{s.label}</span>
                    {!s.done && !s.ready ? <span className="text-xs text-ink-3">after {s.needsFirst.map((n) => n.label).join(", ")}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    {s.minutes ? <span className="text-xs text-ink-3">{minutesWords(s.minutes)}</span> : null}
                    {s.key === "s1a" && video ? (
                      <a href={s.done ? video : s.href} className="text-xs underline" target={s.done ? "_blank" : undefined} rel="noreferrer">
                        {s.done ? "Watch again ↗" : "Watch"}
                      </a>
                    ) : !s.done && s.signal === "coach-tick" ? (
                      coach && canTick ? (
                        <form action={tickSetupAction}>
                          <input type="hidden" name="key" value={s.key} />
                          <input type="hidden" name="on" value="1" />
                          <SubmitButton className="btn btn-soft btn-xs" pendingText="…">
                            Confirm as their coach
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="text-xs text-ink-3">Your coach confirms</span>
                      )
                    ) : !s.done && s.signal === "tick" && canTick ? (
                      <form action={tickSetupAction}>
                        <input type="hidden" name="key" value={s.key} />
                        <input type="hidden" name="on" value="1" />
                        <SubmitButton className="btn btn-soft btn-xs" pendingText="…">
                          Done
                        </SubmitButton>
                      </form>
                    ) : null}
                    {!s.done && s.key !== "s1a" ? (
                      <Link href={s.href} className="text-xs underline">
                        Open →
                      </Link>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

import { SETUP_GROUPS } from "@/lib/engine/setup";
function groupsOf(steps: SetupStep[]) {
  return SETUP_GROUPS.map((g) => ({ ...g, steps: steps.filter((s) => s.group === g.key) })).filter((g) => g.steps.length);
}
