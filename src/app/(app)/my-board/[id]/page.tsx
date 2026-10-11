import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { decisionsFor, ownDecision } from "@/lib/board";
import { askBoardAction } from "@/lib/actions/board";
import { seatsFor, type Mode } from "@/lib/engine/board";
import { Boardroom } from "@/components/boardroom";
import { SubmitButton } from "@/components/submit-button";
import { formatDate } from "@/lib/dates";
import "../boardroom.css";

export const metadata = { title: "A Board decision" };

/**
 * One decision in the Boardroom: its latest answer played back (on arrival from an ask, or with "Run the discussion"), the
 * earlier answers on it below, and the box to ask more. An answer that didn't pass the checks shows why, with Ask again.
 */
export default async function DecisionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; play?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const d = await ownDecision(v, id);
  if (!d || d.parentId) notFound();
  const thread = (await decisionsFor(v, 200)).find((x) => x.decision.id === d.id);
  const all = [d, ...(thread?.followUps ?? [])];
  const latest = [...all].reverse().find((x) => x.answer) ?? null;
  const failed = all.at(-1)!.answer ? null : all.at(-1)!;
  const earlier = all.filter((x) => x.answer && x.id !== latest?.id);
  const seats = seatsFor(d.preset);
  const canAsk = !v.switchedInto && !v.team;
  return (
    <div className="br-page" data-testid="board-page">
      <div className="br-wrap" style={{ marginBottom: 16 }}>
        <Link href="/my-board#decisions" style={{ fontSize: 13 }}>
          ← My Board
        </Link>
      </div>
      {sp.error ? (
        <p className="br-wrap" role="alert" data-testid="board-error" style={{ color: "#f5b0a0", marginBottom: 24 }}>
          {sp.error}
        </p>
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
          />
        </>
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
