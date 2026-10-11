import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { decisionsFor, stepStatus } from "@/lib/board";
import { askBoardAction, setBoardHoursAction, setBoardPresetAction } from "@/lib/actions/board";
import { seatsFor } from "@/lib/engine/board";
import { Boardroom } from "@/components/boardroom";
import { SubmitButton } from "@/components/submit-button";
import { formatDate } from "@/lib/dates";
import "./boardroom.css";

export const metadata = { title: "My Board" };

/** My Board, the Boardroom (revs 664, 698): five advisors on a decision, grounded in the member's own HelixOS. */
export default async function MyBoardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const hours = v.membership.boardHours;
  const preset = v.role === "coach" && !v.switchedInto && v.membership.boardPreset === "edge" ? "edge" : "standard";
  const seats = seatsFor(preset);
  const canAsk = !v.switchedInto && !v.team;
  const decisions = await decisionsFor(v, 20);
  const statuses = await Promise.all(decisions.map((x) => stepStatus(v.user.id, x.decision)));
  return (
    <div className="br-page" data-testid="board-page">
      {sp.error ? (
        <p className="br-wrap" role="alert" data-testid="board-error" style={{ color: "#f5b0a0", marginBottom: 24 }}>
          {sp.error}
        </p>
      ) : null}
      {canAsk && !hours ? (
        <div className="br-wrap">
          <form action={setBoardHoursAction} className="br-head" id="hours">
            <div className="br-eyebrow">MY BOARD</div>
            <label htmlFor="br-hours" className="br-question">
              How many hours a week can you give your business?
            </label>
            <p className="br-muted" style={{ margin: 0 }}>
              Jordan keeps every plan inside this.
            </p>
            <div className="br-askrow">
              <input id="br-hours" name="hours" type="number" min={1} max={80} required className="br-input" style={{ flex: "0 1 160px" }} data-testid="board-hours" />
              <SubmitButton className="br-pill" pendingText="Saving…" data-testid="board-hours-save">
                Save
              </SubmitButton>
            </div>
          </form>
        </div>
      ) : (
        <Boardroom seats={seats} answer={null} question="" used={[]} notes={[]} hours={hours} autoplay={false} action={askBoardAction} canAsk={canAsk} decisionView={false} />
      )}
      {!canAsk ? <p className="br-wrap br-muted">The Board answers {v.user.name.split(" ")[0]} on their own AI key, so only they can ask it. Their decisions are below.</p> : null}

      <section className="br-wrap" id="decisions" style={{ marginTop: 44 }} aria-label="Decisions">
        <div className="br-sechead">
          <h2 className="br-h2">Decisions</h2>
          <span style={{ display: "flex", gap: 4 }} aria-hidden>
            {seats.map((s) =>
              s.icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- a static seat icon from public/board
                <img key={s.key} src={s.icon} alt="" width={22} height={22} />
              ) : (
                <span key={s.key}>{s.emoji}</span>
              ),
            )}
          </span>
        </div>
        {decisions.length ? (
          <ul className="br-log" style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="board-decisions">
            {decisions.map(({ decision: d, followUps }, i) => {
              const done = statuses[i].filter((x) => x === "done").length;
              return (
                <li key={d.id}>
                  <Link href={`/my-board/${d.id}`} className="br-serif" style={{ fontSize: 20, fontWeight: 600 }}>
                    {d.answer?.decision ?? d.question}
                  </Link>
                  <span className="br-quiet" style={{ fontSize: 13 }}>
                    {formatDate(d.createdAt.slice(0, 10))}
                    {d.answer ? ` · ${done} of ${d.answer.steps.length} steps done` : " · no answer yet"}
                    {followUps.length ? ` · ${followUps.length} follow-up${followUps.length === 1 ? "" : "s"}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="br-muted">No decisions yet.</p>
        )}
      </section>

      {canAsk && hours ? (
        <details className="br-wrap" style={{ marginTop: 32, fontSize: 14 }} id="hours-edit">
          <summary className="br-muted" style={{ cursor: "pointer" }}>
            Your Board: {hours} hours a week{v.role === "coach" ? `, ${preset === "edge" ? "Edge Preset" : "the standard five"}` : ""}
          </summary>
          <form action={setBoardHoursAction} style={{ display: "flex", gap: 12, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
            <label className="br-muted" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              Hours I can give my business each week
              <input className="br-field" name="hours" type="number" min={1} max={80} defaultValue={hours} required />
            </label>
            <SubmitButton className="br-pill" pendingText="Saving…">
              Save
            </SubmitButton>
          </form>
          {v.role === "coach" ? (
            <form action={setBoardPresetAction} style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }} data-testid="board-preset">
              <span className="br-muted">Your own Board:</span>
              <select className="br-field" name="preset" defaultValue={preset}>
                <option value="standard">The standard five</option>
                <option value="edge">Edge Preset (yours only, never offered to clients)</option>
              </select>
              <SubmitButton className="br-pill" pendingText="Saving…">
                Save
              </SubmitButton>
            </form>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
