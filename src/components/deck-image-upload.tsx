"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import { recordDeckImageAction } from "@/lib/actions/deck-images";
import { DECK_IMAGE_MIME, consentRequired, deckImageKey, deckImageSniff } from "@/lib/engine/deck-image";
import { DECK_IMAGE_KINDS, type DeckImageKind } from "@/db/schema";
import { redactUrls } from "@/lib/engine/storage-policy";

const KIND_LABEL: Record<DeckImageKind, string> = { photo: "Photo", screenshot: "Screenshot", proof: "Proof (a result or testimonial image)", logo: "Logo" };
const extFromMime: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/**
 * One image joins the coach's own library, straight from the file picker into the private store on a token this app issues, and
 * is recorded only after the server reads it back and sniffs it. The coach tags it (photo, screenshot, proof, logo) and may
 * caption it. A screenshot or a proof image must first affirm that anyone shown who hasn't agreed has had their name, email or
 * number hidden, with who is in it — the same tick the proof store already asks for, stored with who and when.
 */
export function DeckImageUpload({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DeckImageKind>("photo");
  const [caption, setCaption] = useState("");
  const [consentTick, setConsentTick] = useState(false);
  const [consentName, setConsentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const needsConsent = consentRequired(kind);

  const pick = (f: File | null) => {
    setFile(f);
    setError(null);
    setConsentTick(false);
    setConsentName("");
  };

  const send = () => {
    if (!file) return setError("Choose an image first.");
    if (needsConsent && (!consentTick || !consentName.trim())) return setError("Tick the sentence and write who's in it before adding a screenshot or proof.");
    setError(null);
    start(async () => {
      try {
        const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        const sniffed = deckImageSniff(head);
        if (!sniffed) return setError("That file isn't an image the deck can use. Upload a PNG, JPEG, WebP or GIF.");
        const key = deckImageKey(workspaceId, userId, crypto.randomUUID(), extFromMime[sniffed.mime] ?? "png");
        const blob = await upload(key, file, { access: "private", contentType: sniffed.mime, handleUploadUrl: "/api/deck-images/upload", onUploadProgress: (p) => setProgress(p.percentage) });
        const r = await recordDeckImageAction({ key: blob.pathname, kind, caption, consentTick, consentName });
        if (!r.ok) return setError(r.error);
        pick(null);
        setCaption("");
        setKind("photo");
        router.refresh();
      } catch (e) {
        console.error("[deck-image-upload]", redactUrls(e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
        setError("The upload didn't finish. It is not saved. Try again in a minute.");
      } finally {
        setProgress(null);
      }
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-line p-3" data-testid="deck-image-upload">
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn btn-soft btn-sm cursor-pointer">
          Choose an image
          <input type="file" className="sr-only" accept={DECK_IMAGE_MIME.join(",")} disabled={pending} data-testid="deck-image-file" onChange={(e) => pick(e.currentTarget.files?.[0] ?? null)} />
        </label>
        {file ? <span className="text-xs text-ink-2" data-testid="deck-image-name">{file.name}</span> : null}
      </div>
      {file ? (
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="label">What is it?</span>
            <select className="field" value={kind} disabled={pending} data-testid="deck-image-kind" onChange={(e) => setKind(e.currentTarget.value as DeckImageKind)}>
              {DECK_IMAGE_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="label">Caption (optional)</span>
            <input className="field" value={caption} disabled={pending} data-testid="deck-image-caption" onChange={(e) => setCaption(e.currentTarget.value)} placeholder="So you can find it again" />
          </label>
          {needsConsent ? (
            <div className="space-y-2 rounded-lg bg-warn-soft p-2" data-testid="deck-image-consent">
              <input className="field" value={consentName} disabled={pending} data-testid="deck-image-consent-name" onChange={(e) => setConsentName(e.currentTarget.value)} placeholder="Who's in it" />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={consentTick} disabled={pending} data-testid="deck-image-consent-tick" onChange={(e) => setConsentTick(e.currentTarget.checked)} />
                <span>I&apos;ve hidden anyone&apos;s name, email or number who hasn&apos;t agreed to be shown.</span>
              </label>
            </div>
          ) : null}
          <button className="btn btn-primary btn-sm" type="button" disabled={pending} aria-busy={pending} onClick={send} data-testid="deck-image-send">
            {pending ? (progress !== null ? `Uploading ${Math.round(progress)}%` : "Uploading…") : "Add to library"}
          </button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-danger" role="alert" data-testid="deck-image-error">{error}</p> : null}
    </div>
  );
}
