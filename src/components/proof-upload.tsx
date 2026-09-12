"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import { checkProofUploadAction, recordProofAttachmentAction } from "@/lib/actions/proof-attachments";
import { ACCEPTED, ACCEPT_ATTRIBUTE, KIND_MAX, OWN_SCREEN_TICK, PERSON_QUESTION, RESULT_QUESTION, VIDEO_MAX_BYTES, likenessSentence, mb, proofKey, refusal, type Sniffed } from "@/lib/engine/proof-attachments";
import type { ProofAttachmentKind } from "@/db/schema";
import { redactUrls } from "@/lib/engine/storage-policy";

type Meta = { width: number | null; height: number | null; durationSeconds: number | null };

/** What the browser's own player knows about a video: the only thing that has read it. Images are measured server-side. */
function videoMeta(file: File): Promise<Meta> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("video/")) return resolve({ width: null, height: null, durationSeconds: null });
    const el = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (m: Meta) => {
      URL.revokeObjectURL(url);
      resolve(m);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done({ width: el.videoWidth || null, height: el.videoHeight || null, durationSeconds: Number.isFinite(el.duration) ? el.duration : null });
    el.onerror = () => done({ width: null, height: null, durationSeconds: null });
    el.src = url;
  });
}

const extOf = (name: string, sniffed: Sniffed | null): string => {
  if (sniffed) return sniffed.ext;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ACCEPTED.some((a) => a.ext === ext) || ext === "jpeg" || ext === "heif" ? ext : "bin";
};

/** The file's first bytes, read here as the server will read them, so the questions, the tick and the cap follow what it is, not what it is called. */
async function sniffFile(file: File): Promise<{ sniffed: Sniffed | null; error: string | null }> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const v = refusal(head, file.size);
  return "error" in v ? { sniffed: null, error: v.error } : { sniffed: v.sniffed, error: null };
}

/**
 * A file joins a proof from the phone's roll or straight from its camera, goes browser-to-bucket into the private store on a
 * token this app issues, and is recorded only after the server has read it back and sniffed it. Two questions are asked
 * while the client is looking straight at the file: does it show a result, and is an identifiable person in it (which asks
 * for the likeness permission). An image or document needs the own-screen tick. Alt text is optional here and warned about
 * later, never demanded at the moment the client is least willing to write a sentence. Progress is real; an upload that dies
 * because the tab went to the background says so, rather than leaving the client thinking their testimonial is saved.
 */
export function ProofUpload({ proofId, workspaceId, enabled, why, full, quotaLine }: { proofId: string; workspaceId: string; enabled: boolean; why?: string; /** Why no more can be added, or null: the quota line already on screen, or the count. */ full: string | null; quotaLine: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [sniffed, setSniffed] = useState<Sniffed | null>(null);
  const [showsAResult, setShowsAResult] = useState<"" | "yes" | "no">("");
  const [showsAPerson, setShowsAPerson] = useState<"" | "yes" | "no">("");
  const [consentName, setConsentName] = useState("");
  const [consentTick, setConsentTick] = useState(false);
  const [ownScreen, setOwnScreen] = useState(false);
  const [altText, setAltText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const hiddenDuring = useRef(false);
  const STALL_MS = 90000;
  const router = useRouter();
  const kind: ProofAttachmentKind = sniffed?.kind ?? (file?.type.startsWith("video/") ? "video" : file?.type === "application/pdf" ? "document" : "image");
  const isVideo = kind === "video";

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && pending) hiddenDuring.current = true;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pending]);

  const pick = async (f: File | null) => {
    setFile(f);
    setSniffed(null);
    setError(null);
    if (f) {
      const s = await sniffFile(f);
      setSniffed(s.sniffed);
      if (s.error) setError(s.error);
    }
    setShowsAResult("");
    setShowsAPerson("");
    setConsentName("");
    setConsentTick(false);
    setOwnScreen(false);
    setAltText("");
  };

  const send = () => {
    if (!file) return setError("Choose a file first.");
    if (!showsAResult || !showsAPerson) return setError("Answer both questions first.");
    if (!isVideo && !ownScreen) return setError("Tick that this is your own screen before attaching it.");
    const cap = KIND_MAX[kind] ?? VIDEO_MAX_BYTES;
    if (file.size > cap) return setError(`That ${kind} is over ${mb(cap)}. Export it smaller and try again.`);
    setError(null);
    hiddenDuring.current = false;
    start(async () => {
      try {
        // The door's own reason, before the bytes move: the upload library swallows it once the transfer has started.
        const room = await checkProofUploadAction(proofId, file.size);
        if (!room.ok) return setError(room.error);
        const meta = await videoMeta(file);
        const key = proofKey(workspaceId, proofId, crypto.randomUUID(), extOf(file.name, sniffed));
        // A transfer that stops reporting progress is dead, on a phone most of all: it is abandoned and said so, not left at "Uploading".
        const ctrl = new AbortController();
        let stall = window.setTimeout(() => ctrl.abort(), STALL_MS);
        const tick = (pct: number) => {
          setProgress(pct);
          window.clearTimeout(stall);
          stall = window.setTimeout(() => ctrl.abort(), STALL_MS);
        };
        let blob;
        try {
          blob = await upload(key, file, { access: "private", contentType: sniffed?.mime ?? file.type ?? undefined, handleUploadUrl: "/api/proofs/upload", clientPayload: JSON.stringify({ proofId, size: file.size }), multipart: file.size > 20 * 1024 * 1024, abortSignal: ctrl.signal, onUploadProgress: (p) => tick(p.percentage) });
        } finally {
          window.clearTimeout(stall);
        }
        const r = await recordProofAttachmentAction({ proofId, key: blob.pathname, originalFilename: file.name, showsAResult: showsAResult === "yes", showsAPerson: showsAPerson === "yes", ownScreen, consentName, consentTick, altText, ...meta });
        if (!r.ok) return setError(r.error);
        pick(null);
        router.push(`/proof/${proofId}?attached=1#att-${r.id}`);
        router.refresh();
      } catch (e) {
        console.error("[proof-upload]", redactUrls(e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
        setError(hiddenDuring.current ? "The upload stopped when this tab went into the background. It is not saved. Keep the app open and try again." : "The upload didn't finish. It is not saved. Try again in a minute.");
        hiddenDuring.current = false;
      } finally {
        setProgress(null);
      }
    });
  };

  if (!enabled) return <p className="text-xs text-warn" data-testid="proof-upload-off">{why}</p>;
  return (
    <div className="space-y-3" data-testid="proof-upload">
      <p className="text-xs text-ink-3">{quotaLine}</p>
      {full ? (
        <p className="text-sm text-danger" data-testid="proof-upload-full">{full}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn btn-soft btn-sm cursor-pointer">
            Choose a file
            <input type="file" className="sr-only" accept={ACCEPT_ATTRIBUTE} disabled={pending} data-testid="proof-file" onChange={(e) => void pick(e.currentTarget.files?.[0] ?? null)} />
          </label>
          <label className="btn btn-soft btn-sm cursor-pointer">
            Take a photo or video
            <input type="file" className="sr-only" accept="image/*,video/*" capture="environment" disabled={pending} data-testid="proof-capture" onChange={(e) => void pick(e.currentTarget.files?.[0] ?? null)} />
          </label>
          {file ? <span className="text-xs text-ink-2" data-testid="proof-file-name">{file.name} · {mb(file.size)}</span> : null}
        </div>
      )}
      {file && sniffed ? (
        <div className="space-y-3 rounded-lg border border-line p-3" data-testid="proof-questions">
          <fieldset>
            <legend className="text-sm font-medium">{RESULT_QUESTION}</legend>
            <div className="mt-1 flex gap-4 text-sm">
              <label className="flex items-center gap-1"><input type="radio" name="showsAResult" value="yes" checked={showsAResult === "yes"} onChange={() => setShowsAResult("yes")} data-testid="result-yes" /> Yes</label>
              <label className="flex items-center gap-1"><input type="radio" name="showsAResult" value="no" checked={showsAResult === "no"} onChange={() => setShowsAResult("no")} data-testid="result-no" /> No</label>
            </div>
            {showsAResult === "yes" ? <p className="mt-1 text-xs text-ink-2">A result shown in a file carries the same hard block in the pre-publish checklist as a typed dollar figure.</p> : null}
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">{PERSON_QUESTION}</legend>
            <div className="mt-1 flex gap-4 text-sm">
              <label className="flex items-center gap-1"><input type="radio" name="showsAPerson" value="yes" checked={showsAPerson === "yes"} onChange={() => setShowsAPerson("yes")} data-testid="person-yes" /> Yes</label>
              <label className="flex items-center gap-1"><input type="radio" name="showsAPerson" value="no" checked={showsAPerson === "no"} onChange={() => setShowsAPerson("no")} data-testid="person-no" /> No</label>
            </div>
            {showsAPerson === "yes" ? (
              <div className="mt-2 space-y-2">
                <input className="field" placeholder="Their name" value={consentName} onChange={(e) => setConsentName(e.currentTarget.value)} data-testid="consent-name" />
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={consentTick} onChange={(e) => setConsentTick(e.currentTarget.checked)} data-testid="consent-tick" />
                  <span>{likenessSentence(consentName, kind)}</span>
                </label>
                <p className="text-xs text-ink-3">You can record this later, but the proof can&apos;t be approved until it is.</p>
              </div>
            ) : null}
          </fieldset>
          {!isVideo ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={ownScreen} onChange={(e) => setOwnScreen(e.currentTarget.checked)} data-testid="own-screen-tick" />
              <span>{OWN_SCREEN_TICK}</span>
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="label">Alt text (optional)</span>
            <input className="field" value={altText} onChange={(e) => setAltText(e.currentTarget.value)} placeholder="What a screen reader should say the image shows" data-testid="alt-text" />
          </label>
          <div className="flex items-center gap-3">
            <button className="btn btn-primary btn-sm" type="button" disabled={pending} aria-busy={pending} onClick={send} data-testid="proof-upload-send">
              {pending ? (progress !== null ? `Uploading ${Math.round(progress)}%` : "Uploading…") : "Attach"}
            </button>
            {pending && progress !== null ? (
              <div className="h-2 w-40 overflow-hidden rounded bg-surface-2" aria-hidden="true">
                <div className="h-full bg-accent" style={{ width: `${Math.round(progress)}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-danger" role="alert" data-testid="proof-upload-error">{error}</p>
      ) : null}
    </div>
  );
}
