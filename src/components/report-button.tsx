"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { myUnreadRepliesAction, sendReportAction, type SendResult } from "@/lib/actions/reports";
import { FORM_REPORT_KINDS, KIND_LABEL, SEVERITY_LABEL } from "@/lib/engine/reports";
import { REPORT_SEVERITIES, type MemberReportKind } from "@/db/schema";
import { SubmitButton } from "@/components/submit-button";
import { ScreenshotPicker, type Shot } from "@/components/screenshot-picker";

/** The refusal goes in the address the way every form's does, so the shared button puts the typing back and marks the field. */
/** Docket #2: how long a send may take before the form says so and offers Send again; what you typed stays. */
export const SEND_TIMEOUT_MS = 20_000;
export const TOOK_TOO_LONG = "That took too long. Press Send again, or Start over: what you typed is still here.";

function setRefusal(error: string | null, field?: string) {
  const u = new URL(window.location.href);
  u.searchParams.delete("reportError");
  u.searchParams.delete("field");
  if (error) {
    u.searchParams.set("reportError", error);
    if (field) u.searchParams.set("field", field);
  }
  window.history.replaceState(window.history.state, "", u.toString());
}

const DOT: Record<string, string> = { red: "bg-danger", orange: "bg-warn", green: "bg-good" };

/**
 * "I have an issue or a suggestion" (rev 432 items 2 and 3), from the menu on every page: what it is, how much it gets in the
 * way, the words, an optional screenshot (an upload, or a capture of this screen where the browser allows it), and the page
 * it came from, filled in on its own. It lands in the coach's inbox. An Ask Danno answer that was wrong is the third kind,
 * with the question and the answer pasted in, since the chat window is Community Loyalty's and HelixOS can't add a button
 * inside it.
 */
export function ReportButton({ coachFirst, className = "", variant = "sidebar" }: { coachFirst: string; className?: string; variant?: "sidebar" | "row" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  const [kind, setKind] = useState<MemberReportKind>("issue");
  const [shot, setShot] = useState<Shot | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  // New replies on My reports (H-1656): asked when the panel opens, so the menu on every page reads nothing for it.
  const [unread, setUnread] = useState(0);
  const open = () => {
    setResult(null);
    setShotError(null);
    setRefusal(null);
    dialog.current?.showModal();
    myUnreadRepliesAction().then(setUnread, () => setUnread(0));
  };
  const startOver = () => {
    form.current?.reset();
    setKind("issue");
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    setShotError(null);
    setResult(null);
    setRefusal(null);
  };
  // Docket #2 (T.G.): a send that hangs comes back after SEND_TIMEOUT_MS with a plain line, and Start over clears the form.
  const send = async (fd: FormData) => {
    fd.delete("screenshotFile");
    if (shot) fd.set("screenshot", new File([shot.blob], "screenshot.jpg", { type: "image/jpeg" }));
    let r: SendResult;
    try {
      r = await Promise.race([sendReportAction(fd), new Promise<SendResult>((resolve) => setTimeout(() => resolve({ ok: false, error: TOOK_TOO_LONG }), SEND_TIMEOUT_MS))]);
    } catch {
      r = { ok: false, error: "That didn't send. Check your connection and press Send again: what you typed is still here." };
    }
    setRefusal(r.ok ? null : r.error, r.ok ? undefined : r.field);
    setResult(r);
    if (r.ok) {
      setKind("issue");
      if (shot) URL.revokeObjectURL(shot.url);
      setShot(null);
    }
  };

  return (
    <>
      <button type="button" onClick={open} className={variant === "row" ? `flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-surface-2 ${className}` : `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2 hover:text-ink ${className}`} data-testid="report-open">
        <span className={variant === "row" ? "w-6 text-center text-lg" : ""}>🛟</span> I have an issue or a suggestion
      </button>
      <dialog ref={dialog} className="w-[min(34rem,calc(100vw-2rem))] rounded-2xl border bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40" data-testid="report-dialog" aria-labelledby="report-title">
        {result?.ok ? (
          <div className="space-y-3 p-5" data-testid="report-sent">
            <h2 id="report-title" className="text-lg font-semibold">Sent to {coachFirst}</h2>
            {/* The instant receipt (H-202), the same words as on the report. */}
            <p className="font-medium" data-testid="report-receipt">Got it, {coachFirst} will see this soon.</p>
            <p className="text-sm text-ink-2">
              It&apos;s in {coachFirst}&apos;s inbox with the page you were on.{result.screenshot === "kept" ? " The screenshot went with it." : result.screenshot === "not-stored" ? " The screenshot couldn't be kept, so it went without one." : ""}
            </p>
            {/* H-1656: where to see it next is the one clear action here, not a faint link. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a href="/reports" className="btn btn-brand btn-sm" data-testid="report-my-reports">See it in My reports</a>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  dialog.current?.close();
                  setResult(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form ref={form} className="space-y-3 p-5" data-testid="report-form" action={send}>
            {/* H-1656: My reports first and plain to see, so a member checks a reply before writing the same thing again. */}
            <a href="/reports" className="btn btn-soft w-full justify-center" data-testid="report-form-my-reports" data-unread={unread || undefined}>
              <span aria-hidden="true">📬</span> My reports{unread ? ` (${unread} new ${unread === 1 ? "reply" : "replies"})` : ""}
            </a>
            <p className="-mt-1 text-center text-xs text-ink-2">What you sent, and every reply.</p>
            <h2 id="report-title" className="pt-1 text-lg font-semibold">
              Tell {coachFirst}
            </h2>
            <input type="hidden" name="page" value={pathname ?? ""} />
            <fieldset className="space-y-1 text-sm">
              <legend className="font-medium">What is it?</legend>
              {FORM_REPORT_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} data-testid={`report-kind-${k}`} /> {KIND_LABEL[k]}
                </label>
              ))}
            </fieldset>
            <fieldset className="text-sm">
              <legend className="font-medium">How much does it get in your way?</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {REPORT_SEVERITIES.map((s) => (
                  <label key={s} className="flex items-center gap-1.5">
                    <input type="radio" name="severity" value={s} defaultChecked={s === "orange"} data-testid={`report-severity-${s}`} />
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[s]}`} aria-hidden /> {SEVERITY_LABEL[s]}
                  </label>
                ))}
              </div>
            </fieldset>
            {kind === "ask_danno" ? (
              <>
                {/* Rev 843: the chat window is Community Loyalty's; a stuck one comes back with a fresh load of the page, and its conversation with it. Only on the Ask page, the chat's one home (H-693). */}
                {pathname === "/ask" ? (
                <p className="rounded-lg bg-surface-2 p-2 text-xs text-ink-2" data-testid="chat-restart-line">
                  Chat stuck or not answering?{" "}
                  <button type="button" className="underline" data-testid="chat-restart" onClick={() => window.location.reload()}>
                    Restart the chat
                  </button>
                  . Your conversation comes back with it.
                </p>
                ) : null}
                <label className="block text-sm font-medium">
                  The question you asked
                  <textarea className="field mt-1" name="question" rows={2} required data-testid="report-question" />
                </label>
                <label className="block text-sm font-medium">
                  The answer it gave
                  <textarea className="field mt-1" name="answer" rows={3} required data-testid="report-answer" />
                </label>
                <label className="block text-sm font-medium">
                  What&apos;s wrong with it <span className="font-normal text-ink-3">(optional)</span>
                  <textarea className="field mt-1" name="description" rows={2} data-testid="report-description" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="talkToCoach" data-testid="report-talk" /> I&apos;d like to talk to {coachFirst} about it
                </label>
              </>
            ) : (
              <label className="block text-sm font-medium">
                {kind === "issue" ? "What happened?" : "What would you like?"}
                <textarea className="field mt-1" name="description" rows={4} required data-testid="report-description" />
              </label>
            )}
            <div className="space-y-2 text-sm">
              <div className="font-medium">
                A screenshot <span className="font-normal text-ink-3">(optional)</span>
              </div>
              <ScreenshotPicker
                idPrefix="report"
                shot={shot}
                onShot={setShot}
                error={shotError}
                onError={setShotError}
                beforeCapture={() => dialog.current?.close()}
                afterCapture={() => dialog.current?.showModal()}
              />
            </div>
            <p className="text-xs text-ink-3">The page you&apos;re on goes with it: {pathname}</p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
              Need a person?
              <Link href="/support" className="btn btn-ghost btn-sm min-h-11!" data-testid="report-support">
                Help and support
              </Link>
            </p>
            {result && !result.ok ? (
              <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="report-error">
                {result.error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={startOver} data-testid="report-start-over">
                Start over
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
              <SubmitButton className="btn btn-primary btn-sm" data-testid="report-send" pendingText="Sending…">
                Send
              </SubmitButton>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
