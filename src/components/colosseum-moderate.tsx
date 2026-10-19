"use client";

/**
 * Block and Report in the Colosseum (H-735, plan H-745; App Store guideline 1.2): a small ⋯ on each win and each member's
 * standing, and "Block or report" on a seat's card in the arena. Block asks once and the member is gone from the viewer's
 * Colosseum and leaderboard (their seat reads "A member"); they are never told. Report asks for a reason and an optional
 * note and lands in the coach's Issues and ideas as Content; a reported win is gone for the reporter at once. The coach is
 * never blocked, and a report about the coach shows the Support contact instead. Plain words, no alarm.
 */
import Link from "next/link";
import { useActionState, useState } from "react";
import { blockMemberAction, reportContentAction, type BlockState, type ContentReportState } from "@/lib/actions/colosseum";
import { CONTENT_REASONS, NOTE_MAX, REASON_LABEL, REPORTED } from "@/lib/engine/blocks";
import { SubmitButton } from "@/components/submit-button";

/** What can be blocked or reported: a win (its id) or a member (their membership id), with the author's short name. */
export type ModTarget = { kind: "win" | "member"; id: string; membershipId: string; name: string; coach: boolean };

const SUPPORT = (
  <Link href="/support" data-testid="mod-support">
    Help and support
  </Link>
);

/** The steps: choose, then Block (asked once) or Report (reason and note). `onReported` lets a win leave the list at once. */
export function ModeratePanel({ target, onClose, onReported }: { target: ModTarget; onClose: () => void; onReported?: () => void }) {
  const [step, setStep] = useState<"choose" | "block" | "report">("choose");
  const [blockState, blockAction] = useActionState<BlockState, FormData>(blockMemberAction, null);
  const [reportState, reportAction] = useActionState<ContentReportState, FormData>(async (prev, fd) => {
    const r = await reportContentAction(prev, fd);
    if (r?.ok) onReported?.();
    return r;
  }, null);
  const canBlock = !target.coach && Boolean(target.membershipId);
  const what = target.kind === "win" ? "this win" : target.name;

  if (reportState?.ok) {
    return (
      <div className="co-mod" role="status" data-testid="mod-reported">
        <p className="co-ok">{REPORTED}</p>
        <button type="button" className="co-link" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  if (blockState?.ok) {
    return (
      <div className="co-mod" role="status" data-testid="mod-blocked">
        <p className="co-ok">Blocked. Unblock any time in Settings.</p>
        <button type="button" className="co-link" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  return (
    <div className="co-mod" data-testid="mod-panel">
      {step === "choose" ? (
        <div className="co-mod-row">
          <button type="button" className="co-btn" onClick={() => setStep("report")} data-testid="mod-report">
            {target.kind === "win" ? "Report this win" : "Report"}
          </button>
          {canBlock ? (
            <button type="button" className="co-btn" onClick={() => setStep("block")} data-testid="mod-block">
              Block {target.name}
            </button>
          ) : null}
          <button type="button" className="co-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      ) : null}
      {step === "block" && canBlock ? (
        <form action={blockAction} className="co-mod-form" data-testid="mod-block-form">
          <input type="hidden" name="membershipId" value={target.membershipId} />
          <p className="co-line">Block {target.name}? You won&apos;t see their wins or their name. They won&apos;t be told.</p>
          {blockState?.error ? <p className="co-err" role="alert">{blockState.error}</p> : null}
          <div className="co-mod-row">
            <SubmitButton className="co-btn co-primary" pendingText="Blocking…" data-testid="mod-block-confirm">
              Block
            </SubmitButton>
            <button type="button" className="co-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {step === "report" && target.coach ? (
        <div className="co-mod-form" data-testid="mod-coach-support">
          <p className="co-line">Something about your coach goes to Support, not to your coach. {SUPPORT}</p>
          <button type="button" className="co-link" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}
      {step === "report" && !target.coach ? (
        <form action={reportAction} className="co-mod-form" data-testid="mod-report-form">
          <input type="hidden" name="targetKind" value={target.kind} />
          <input type="hidden" name="targetId" value={target.id} />
          <fieldset className="co-mod-reasons">
            <legend className="co-line">What&apos;s wrong with {what}?</legend>
            {CONTENT_REASONS.map((r) => (
              <label key={r} className="co-kind">
                <input type="radio" name="reason" value={r} required data-testid={`mod-reason-${r}`} /> {REASON_LABEL[r]}
              </label>
            ))}
          </fieldset>
          <label className="co-fine">
            A note for your coach (optional)
            <textarea className="field" name="note" rows={2} maxLength={NOTE_MAX} data-testid="mod-note" />
          </label>
          <p className="co-fine">Your coach sees who sent it. The other member isn&apos;t told. Reports are reviewed within 24 hours. {SUPPORT}</p>
          {reportState?.error ? (
            <p className="co-err" role="alert" data-testid="mod-report-error">
              {reportState.error} {reportState.support ? SUPPORT : null}
            </p>
          ) : null}
          <div className="co-mod-row">
            <SubmitButton className="co-btn co-primary" pendingText="Sending…" data-testid="mod-report-send">
              Send report
            </SubmitButton>
            <button type="button" className="co-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** The ⋯ on a win or a standing: the button, and the panel under it while open. Both are grid items of the row. */
export function ModerateMenu({ target, onReported }: { target: ModTarget; onReported?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="co-dots" aria-expanded={open} aria-label={target.kind === "win" ? `Block or report this win by ${target.name}` : `Block or report ${target.name}`} onClick={() => setOpen((o) => !o)} data-testid="mod-open">
        ⋯
      </button>
      {open ? <ModeratePanel target={target} onClose={() => setOpen(false)} onReported={onReported} /> : null}
    </>
  );
}
