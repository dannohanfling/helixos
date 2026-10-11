"use client";

import Link from "next/link";
import { useState } from "react";
import type { BoardApplied, BoardProposal } from "@/db/schema";

/** Never ticked for the member: a change to something that exists, or the ask that goes to the coach (engine/board-setup's rule). */
const tickedByDefault = (p: BoardProposal) => !p.before && p.kind !== "office_hours";
import { SubmitButton } from "@/components/submit-button";

/**
 * "Set it up for me" (revs 660, 698): a plain checklist with hairlines under the steps, then "Approve N selected". Something that
 * already exists shows before → after and is never ticked for the member; the Office Hours ask shows its read-back and is never
 * ticked for them either. What's set up shows as done with a link to it. A team member or a coach switched in sees the list only.
 */
export function BoardSetup({ decisionId, back, proposals, applied, canApprove, action }: { decisionId: string; back: string; proposals: BoardProposal[]; applied: BoardApplied[]; canApprove: boolean; action: (fd: FormData) => void | Promise<void> }) {
  const doneOf = (id: string) => applied.find((a) => a.proposalId === id) ?? null;
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(proposals.filter((p) => !doneOf(p.id) && tickedByDefault(p)).map((p) => p.id)));
  if (!proposals.length) return null;
  const open = proposals.filter((p) => !doneOf(p.id));
  const toggle = (id: string) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section aria-label="Set it up for me" id="setup" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="board-setup">
      <div className="br-sechead">
        <h2 className="br-h2">Set it up for me</h2>
        <span className="br-quiet" style={{ fontSize: 13 }}>
          Drafts and private only. Nothing changes until you approve it.
        </span>
      </div>
      <form action={action}>
        <input type="hidden" name="id" value={decisionId} />
        <input type="hidden" name="back" value={back} />
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {proposals.map((p) => {
            const done = doneOf(p.id);
            return (
              <li key={p.id} className="br-setup-row" data-testid="board-setup-item" data-kind={p.kind} data-done={done ? "1" : "0"}>
                {done ? (
                  <span className="br-setup-tick" aria-hidden>
                    ✓
                  </span>
                ) : (
                  <input type="checkbox" name="p" value={p.id} checked={ticked.has(p.id)} onChange={() => toggle(p.id)} disabled={!canApprove} aria-label={p.title} className="br-check" data-testid={`board-setup-check-${p.id}`} />
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontWeight: 600 }}>{p.title}</div>
                  {p.before && p.after ? (
                    <div className="br-muted" style={{ fontSize: 14 }} data-testid="board-setup-change">
                      <span style={{ textDecoration: "line-through" }}>{p.before}</span> → {p.after}
                    </div>
                  ) : (
                    <div className="br-muted" style={{ fontSize: 14, whiteSpace: "pre-line" }}>
                      {p.detail}
                    </div>
                  )}
                  {done ? (
                    <div className="br-goldtext" style={{ fontSize: 13 }} data-testid="board-setup-done">
                      Set up{done.href ? (
                        <>
                          {" · "}
                          <Link href={done.href}>Open it</Link>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {canApprove && open.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginTop: 16 }}>
            <SubmitButton className="br-pill" pendingText="Setting it up…" disabled={!ticked.size} data-testid="board-setup-approve">
              {`Approve ${ticked.size} selected`}
            </SubmitButton>
          </div>
        ) : null}
        {!canApprove && open.length ? <p className="br-quiet" style={{ fontSize: 13 }}>Only the member can approve these.</p> : null}
      </form>
    </section>
  );
}
