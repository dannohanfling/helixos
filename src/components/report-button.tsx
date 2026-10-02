"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { sendReportAction, type SendResult } from "@/lib/actions/reports";
import { KIND_LABEL, SCREENSHOT_MAX_BYTES, SEVERITY_LABEL } from "@/lib/engine/reports";
import { MEMBER_REPORT_KINDS, REPORT_SEVERITIES, type MemberReportKind } from "@/db/schema";
import { SubmitButton } from "@/components/submit-button";

/** The refusal goes in the address the way every form's does, so the shared button puts the typing back and marks the field. */
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

/** A picture shrunk in the browser to at most 1600 px wide and re-encoded as JPEG, so it fits a form's send. */
async function shrink(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (out && out.size <= SCREENSHOT_MAX_BYTES) return out;
  }
  throw new Error("too large");
}

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
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  // Read after mounting: the server can't know the browser's features, and a button only the browser draws would make its HTML
  // differ from the server's (a hydration error on every page).
  const [canCapture, setCanCapture] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a browser feature read once after mounting, never during render
    setCanCapture(Boolean(navigator.mediaDevices?.getDisplayMedia));
  }, []);

  const open = () => {
    setResult(null);
    setShotError(null);
    setRefusal(null);
    dialog.current?.showModal();
  };
  const take = async (blob: Blob) => {
    try {
      const small = await shrink(blob);
      setShot((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob: small, url: URL.createObjectURL(small) };
      });
      setShotError(null);
    } catch {
      setShotError("That picture couldn't be read. Try another, or send without one.");
    }
  };
  const capture = async () => {
    // The dialog steps aside so the capture shows the page, then comes back.
    dialog.current?.close();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions);
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 300));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (blob) await take(blob);
    } catch {
      setShotError("The capture was cancelled or isn't allowed here. You can upload a picture instead.");
    } finally {
      dialog.current?.showModal();
    }
  };
  const send = async (fd: FormData) => {
    fd.delete("screenshotFile");
    if (shot) fd.set("screenshot", new File([shot.blob], "screenshot.jpg", { type: "image/jpeg" }));
    let r: SendResult;
    try {
      r = await sendReportAction(fd);
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
            <p className="text-sm text-ink-2">
              It&apos;s in {coachFirst}&apos;s inbox with the page you were on.{result.screenshot === "kept" ? " The screenshot went with it." : result.screenshot === "not-stored" ? " The screenshot couldn't be kept, so it went without one." : ""}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                className="btn btn-primary btn-sm"
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
            <h2 id="report-title" className="text-lg font-semibold">
              Tell {coachFirst}
            </h2>
            <input type="hidden" name="page" value={pathname ?? ""} />
            <fieldset className="space-y-1 text-sm">
              <legend className="font-medium">What is it?</legend>
              {MEMBER_REPORT_KINDS.map((k) => (
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
              <div className="flex flex-wrap items-center gap-2">
                <label className="btn btn-ghost btn-sm cursor-pointer">
                  Upload a picture
                  <input
                    type="file"
                    name="screenshotFile"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    data-testid="report-screenshot"
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      if (f) void take(f);
                    }}
                  />
                </label>
                {canCapture ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void capture()} data-testid="report-capture">
                    Capture this screen
                  </button>
                ) : null}
                {shot ? (
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => {
                      URL.revokeObjectURL(shot.url);
                      setShot(null);
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the member's own picture, never a remote one */}
              {shot ? <img src={shot.url} alt="The screenshot that will be sent" className="max-h-40 rounded-lg border" data-testid="report-preview" /> : null}
              {shotError ? <p className="text-xs text-danger">{shotError}</p> : null}
            </div>
            <p className="text-xs text-ink-3">The page you&apos;re on goes with it: {pathname}</p>
            {result && !result.ok ? (
              <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="report-error">
                {result.error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
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
