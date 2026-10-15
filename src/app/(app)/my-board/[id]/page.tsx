import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { decisionsFor, ownDecision, stepStatus } from "@/lib/board";
import { applySetupAction, askBoardAction, checkinAction, shareDecisionAction } from "@/lib/actions/board";
import { BoardSetup } from "@/components/board-setup";
import { forRoom, seatsOfDecision, type Mode } from "@/lib/engine/board";
import { BoardCouncilNote } from "@/components/board-council-note";
import { Boardroom } from "@/components/boardroom";
import { councilClipFiles } from "@/lib/board-clips";
import { sceneLookFor } from "@/lib/engine/board-view";
import { SubmitButton } from "@/components/submit-button";
import { formatDate } from "@/lib/dates";
import "../boardroom.css";
import { ItemGone } from "@/components/item-gone";

export const metadata = { title: "A Board decision" };

/**
 * One decision in the Boardroom: its latest answer played back (on arrival from an ask, or with "Run the discussion"), the
 * earlier answers on it below, and the box to ask more. An answer that didn't pass the checks shows why, with Ask again.
 */
export default async function DecisionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; play?: string; setUp?: string; setupError?: string; skipped?: string; checkinError?: string; shared?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const d = await ownDecision(v, id);
  if (!d || d.parentId) return <ItemGone what="This decision" href="/my-board#decisions" list="your decisions" />;
  const thread = (await decisionsFor(v, 200)).find((x) => x.decision.id === d.id);
  const all = [d, ...(thread?.followUps ?? [])];
  const latest = [...all].reverse().find((x) => x.answer) ?? null;
  const failed = all.at(-1)!.answer ? null : all.at(-1)!;
  const earlier = all.filter((x) => x.answer && x.id !== latest?.id);
  // The seats the shown answer sat with (rev 756): a changed council never rewrites a past discussion.
  const seats = forRoom(seatsOfDecision(latest ?? d));
  const canAsk = !v.switchedInto && !v.team;
  // The check-in reads the latest answer that has steps; each step's state is its task's, live.
  const withSteps = [...all].reverse().find((x) => x.answer?.steps.length) ?? null;
  const states = withSteps ? await stepStatus(v.user.id, withSteps) : [];
  const checkins = all.flatMap((x) => x.checkins);
  return (
    <div className="br-page" data-testid="board-page">
      <div className="br-wrap" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <Link href="/my-board#decisions" style={{ fontSize: 13 }}>
            ← My Board
          </Link>
          {canAsk ? (
            <form action={shareDecisionAction} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="on" value={d.sharedAt ? "0" : "1"} />
              {d.sharedAt ? (
                <span className="br-goldtext" data-testid="board-shared">
                  Shared with your coach on {formatDate(d.sharedAt.slice(0, 10))}
                </span>
              ) : (
                <span className="br-quiet">Private to you.</span>
              )}
              <SubmitButton className="br-tab" pendingText="…" data-testid={d.sharedAt ? "board-unshare" : "board-share"}>
                {d.sharedAt ? "Stop sharing" : "Share with my coach"}
              </SubmitButton>
            </form>
          ) : d.sharedAt ? (
            <span className="br-quiet" style={{ fontSize: 13 }}>
              Shared with the coach
            </span>
          ) : null}
        </div>
      </div>
      {sp.error ? (
        <p className="br-wrap" role="alert" data-testid="board-error" style={{ color: "#f5b0a0", marginBottom: 24 }}>
          {sp.error}
        </p>
      ) : null}
      {sp.setUp || sp.setupError || sp.skipped ? (
        <div className="br-wrap" role="status" style={{ marginBottom: 24, fontSize: 14 }} data-testid="board-setup-result">
          {sp.setUp ? <p className="br-goldtext" style={{ margin: 0 }}>{`Set up ${sp.setUp} ${sp.setUp === "1" ? "change" : "changes"}. Each links back to this decision.`}</p> : null}
          {sp.skipped ? <p className="br-muted" style={{ margin: "4px 0 0" }}>{`Not set up: ${sp.skipped.split(" | ").join("; ")}.`}</p> : null}
          {sp.setupError ? <p style={{ margin: 0, color: "#f5b0a0" }}>{sp.setupError}</p> : null}
        </div>
      ) : null}
      {failed ? (
        <div className="br-wrap" style={{ marginBottom: 32 }} data-testid="board-problem">
          <p className="br-muted" style={{ margin: 0 }}>
            &ldquo;{failed.question}&rdquo;: {failed.notes[0] ?? "The Board didn't answer."}
          </p>
          {canAsk ? (
            <form action={askBoardAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="question" value={failed.question} />
              <input type="hidden" name="mode" value={failed.mode} />
              <input type="hidden" name="focus" value={failed.focus ?? ""} />
              {failed.parentId ? <input type="hidden" name="parentId" value={failed.parentId} /> : null}
              <SubmitButton className="br-pill" pendingText="Asking again…" data-testid="board-ask-again">
                Ask again
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}
      {latest ? (
        <>
          <p className="br-wrap br-serif" style={{ fontSize: 22, textAlign: "center", marginBottom: 24 }} data-testid="board-decision">
            {latest.answer!.decision}
          </p>
          <Boardroom
            key={latest.id}
            initialLook={sceneLookFor(v.membership.sceneLook, v.hour)}
            clips={councilClipFiles()}
            seats={seats}
            answer={latest.answer}
            question={latest.question}
            used={latest.used}
            notes={latest.notes}
            hours={v.membership.boardHours}
            autoplay={sp.play === "1"}
            action={askBoardAction}
            parentId={d.id}
            canAsk={canAsk}
            decisionView
            initialMode={(latest.mode as Mode) ?? "board"}
            stepStates={latest.id === withSteps?.id ? states : []}
            setup={latest.proposals.length ? <BoardSetup key={`${latest.id}-${latest.applied.length}`} decisionId={latest.id} back={d.id} proposals={latest.proposals} applied={latest.applied} canApprove={canAsk} action={applySetupAction} /> : null}
          />
          <BoardCouncilNote seats={seats} past={Boolean(latest.seats?.length)} />
        </>
      ) : null}
      {withSteps?.answer ? (
        <section className="br-wrap" style={{ marginTop: 44 }} aria-label="Check in" id="checkin" data-testid="board-checkin">
          <div className="br-sechead">
            <h2 className="br-h2">Check in</h2>
            <span className="br-quiet" style={{ fontSize: 13 }}>
              How did the steps go? Jordan shrinks a stuck one; Morgan asks about a dropped one.
            </span>
          </div>
          {sp.checkinError ? (
            <p role="alert" style={{ color: "#f5b0a0", margin: "0 0 12px" }} data-testid="board-checkin-error">
              {sp.checkinError}
            </p>
          ) : null}
          {canAsk ? (
            <form action={checkinAction} style={{ display: "flex", flexDirection: "column" }}>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="steps" value={withSteps.answer.steps.length} />
              {withSteps.answer.steps.map((s, i) => (
                <fieldset key={i} className="br-setup-row" style={{ border: 0, margin: 0, gridTemplateColumns: "minmax(0, 1fr)" }} data-testid="board-checkin-step">
                  <legend style={{ fontWeight: 600, padding: 0, marginBottom: 8 }}>
                    {i + 1}. {s.do}
                    {states[i] === "done" ? <span className="br-goldtext" style={{ fontWeight: 400, fontSize: 13 }}> · done on Tasks</span> : null}
                  </legend>
                  <div className="br-tabs" style={{ justifyContent: "flex-start" }}>
                    {(["done", "stuck", "dropped"] as const).map((st) => (
                      <label key={st} className="br-tab" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input type="radio" name={`s${i}`} value={st} defaultChecked={states[i] === "done" ? st === "done" : false} required data-testid={`board-checkin-${st}-${i}`} />
                        {st === "done" ? "Done" : st === "stuck" ? "Stuck" : "Dropped"}
                      </label>
                    ))}
                  </div>
                  <input name={`n${i}`} className="br-field" placeholder="What happened (optional)" style={{ width: "100%" }} maxLength={500} />
                </fieldset>
              ))}
              <input name="note" className="br-field" placeholder="Anything else the Board should know (optional)" style={{ marginTop: 12 }} maxLength={1000} />
              <div style={{ marginTop: 16 }}>
                <SubmitButton className="br-pill" pendingText="The Board is thinking…" data-testid="board-checkin-submit">
                  Check in with the Board
                </SubmitButton>
              </div>
            </form>
          ) : null}
          {checkins.length ? (
            <ul className="br-quiet" style={{ listStyle: "none", margin: "16px 0 0", padding: 0, fontSize: 13 }} data-testid="board-checkins">
              {checkins.map((c) => (
                <li key={c.at}>
                  Checked in {formatDate(c.at.slice(0, 10))}: {(["done", "stuck", "dropped"] as const).map((st) => `${c.steps.filter((x) => x.state === st).length} ${st}`).join(", ")}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {earlier.length ? (
        <section className="br-wrap" style={{ marginTop: 44 }} aria-label="Earlier on this decision">
          <h2 className="br-h2">Earlier on this decision</h2>
          <ul className="br-log" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {earlier.map((x) => (
              <li key={x.id} id={`d-${x.id}`}>
                <details>
                  <summary style={{ cursor: "pointer" }}>
                    <span className="br-serif" style={{ fontSize: 18 }}>
                      {x.question}
                    </span>{" "}
                    <span className="br-quiet" style={{ fontSize: 13 }}>
                      {formatDate(x.createdAt.slice(0, 10))}
                    </span>
                  </summary>
                  <p className="br-goldtext">The Board recommended: {x.answer!.recommendation}</p>
                  {x.answer!.advisors.map((c) => (
                    <p key={c.seat} className="br-muted" style={{ margin: "6px 0" }}>
                      <b>{seats.find((s) => s.key === c.seat)?.short}:</b> {c.text}
                    </p>
                  ))}
                </details>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
