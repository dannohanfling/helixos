"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import { recordDeckImageAction } from "@/lib/actions/deck-images";
import { DECK_IMAGE_ACCEPT, DECK_IMAGE_MAX_BYTES, DECK_IMAGE_NOT_IMAGE, consentRequired, consentSatisfied, deckImageKey, deckImageSniff, deckImageTooBig } from "@/lib/engine/deck-image";
import { DECK_IMAGE_KINDS, type DeckImageKind } from "@/db/schema";
import { redactUrls } from "@/lib/engine/storage-policy";
import { FilePicker } from "@/components/file-picker";

const KIND_LABEL: Record<DeckImageKind, string> = {
  photo: "Photo",
  screenshot: "Screenshot",
  proof: "Proof (a result or testimonial image)",
  logo: "Logo",
  graphic: "Graphic / social post (a designed image, shown whole)",
  diagram: "Diagram (your own framework or mechanism, shown whole)",
};
/** A small preview of one chosen image, its object URL let go when it leaves. */
function Thumb({ file }: { file: File }) {
  // A phone's HEIC can't be drawn by most browsers: a camera mark stands in until it's converted on the way in.
  const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
  const url = useMemo(() => (heic ? "" : URL.createObjectURL(file)), [file, heic]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  if (heic) return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-lg" aria-hidden="true" data-testid="deck-image-thumb">📷</span>;
  // eslint-disable-next-line @next/next/no-img-element -- a local preview of the coach's own file, never a remote one
  return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-lg border object-cover" data-testid="deck-image-thumb" />;
}
const extFromMime: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heic" };

/** One chosen file and what the coach says about it, before it is sent. */
type Draft = { id: number; file: File; kind: DeckImageKind; caption: string; consentTick: boolean; consentName: string; noPeople: boolean; error: string | null; state: "waiting" | "uploading" | "added" | "failed"; pct: number | null };
/** A slot on a webinar's Deck step the first picture attaches to as it is recorded (§6.2). */
export type SlotAttach = { webinarId: string; slotKey: string };

/**
 * Images join the coach's own library straight from the file picker into the private store on a token this app issues, and are
 * recorded only after the server reads each back and sniffs it. Several files go at once (§6.2), each with its own kind, caption
 * and consent: a screenshot or a proof image must first affirm that anyone shown who hasn't agreed has had their name, email or
 * number hidden, with who is in it, or say that no people are in it. Files are sent one after another; one that is refused stays
 * in the list with its reason, the rest go. With `attach`, the first picture recorded also fills that slot on the Deck step, so
 * a client never has to leave the step for the Images page; the rest land in the library for reuse.
 */
export function DeckImageUpload({
  workspaceId,
  userId,
  fixedKind,
  defaultKind,
  attach,
  onRecorded,
  compact,
}: {
  workspaceId: string;
  userId: string;
  /** One kind only (the kit's logo upload, §6.1): no kind select, and the kind stays after a send. */
  fixedKind?: DeckImageKind;
  /** The kind a new file starts as (a slot's own kind on the Deck step); the coach may change it. */
  defaultKind?: DeckImageKind;
  /** The slot the first recorded picture fills (§6.2). */
  attach?: SlotAttach;
  /** Told each new row, so a picker beside this can select it at once. */
  onRecorded?: (image: { id: string; caption: string; width: number; height: number }) => void;
  compact?: boolean;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ n: number; of: number; pct: number | null } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const startKind = fixedKind ?? defaultKind ?? "photo";

  const pick = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    setError(null);
    // Too big is said at once, per photo, before anything is sent (rev 843 item 4).
    setDrafts(files.map((file, i) => ({ id: Date.now() + i, file, kind: startKind, caption: "", consentTick: false, consentName: "", noPeople: false, ...(file.size > DECK_IMAGE_MAX_BYTES ? { error: deckImageTooBig(), state: "failed" as const } : { error: null, state: "waiting" as const }), pct: null })));
  };
  const update = (id: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  // What is still to send: everything not yet added and not refused for its size.
  const todo = drafts.filter((d) => d.state !== "added" && !(d.state === "failed" && d.file.size > DECK_IMAGE_MAX_BYTES));
  const send = () => {
    if (!todo.length) return setError(drafts.length ? "Nothing left to add. Choose more images." : "Choose an image first.");
    const unmet = todo.find((d) => !consentSatisfied(d.kind, d.consentTick, d.consentName, d.noPeople));
    if (unmet) return setError(`${drafts.length > 1 ? `"${unmet.file.name}": ` : ""}Tick the sentence and write who's in it, or tick that no people are in it, before adding a screenshot or proof.`);
    setError(null);
    start(async () => {
      let attached = false;
      const done: number[] = [];
      const batch = todo;
      for (let i = 0; i < batch.length; i++) {
        const d = batch[i];
        setProgress({ n: i + 1, of: batch.length, pct: null });
        update(d.id, { state: "uploading", pct: 0, error: null });
        try {
          const head = new Uint8Array(await d.file.slice(0, 4096).arrayBuffer());
          const sniffed = deckImageSniff(head);
          if (!sniffed) {
            update(d.id, { error: DECK_IMAGE_NOT_IMAGE, state: "failed", pct: null });
            continue;
          }
          const key = deckImageKey(workspaceId, userId, crypto.randomUUID(), extFromMime[sniffed.mime] ?? "png");
          const blob = await upload(key, d.file, {
            access: "private",
            contentType: sniffed.mime,
            handleUploadUrl: "/api/deck-images/upload",
            onUploadProgress: (p) => {
              setProgress({ n: i + 1, of: batch.length, pct: p.percentage });
              update(d.id, { pct: p.percentage });
            },
          });
          const r = await recordDeckImageAction({ key: blob.pathname, kind: d.kind, caption: d.caption, consentTick: d.consentTick, consentName: d.consentName, noPeople: d.noPeople, attach: attach && !attached ? attach : undefined });
          if (!r.ok) {
            update(d.id, { error: r.error, state: "failed", pct: null });
            continue;
          }
          update(d.id, { state: "added", pct: null, error: null });
          if (attach && !attached) {
            attached = true;
            // Said, never silent (first-deck §6): the picture is in the library, and the slide says so if it could not take it.
            if (r.attached === false) setError("The picture is in your library, but it couldn't be put on this slide. Pick it from the list above, or reload the page and try again.");
          }
          onRecorded?.({ id: r.id, caption: d.caption.trim(), width: r.width, height: r.height });
          done.push(d.id);
        } catch (e) {
          console.error("[deck-image-upload]", redactUrls(e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
          update(d.id, { error: "The upload didn't finish. It is not saved. Try again in a minute.", state: "failed", pct: null });
        }
      }
      // Each photo keeps its line: "Added" or the reason it failed, until the next choice of files.
      setProgress(null);
      if (done.length) router.refresh();
    });
  };

  const sendLabel = pending
    ? progress
      ? `${progress.of > 1 ? `${progress.n} of ${progress.of}, ` : ""}${progress.pct !== null ? `uploading ${Math.round(progress.pct)}%` : "uploading…"}`
      : "Uploading…"
    : attach
      ? todo.length > 1
        ? `Attach the first, add ${todo.length} to the library`
        : "Attach to this slide"
      : todo.length > 1
        ? `Add ${todo.length} to library`
        : drafts.some((d) => d.state === "failed")
          ? "Try again"
          : "Add to library";

  return (
    <div className={compact ? "space-y-2" : "space-y-3 rounded-lg border border-line p-3"} data-testid="deck-image-upload">
      <FilePicker kind="image" multiple accept={DECK_IMAGE_ACCEPT} files={[]} onChange={(fs) => pick(fs)} disabled={pending} testId="deck-image-file" hideChosen labels={{ upload: fixedKind ? `Upload a ${fixedKind}` : drafts.length ? "Upload other images" : "Upload images" }} />
      {drafts.length === 1 ? <span className="block text-xs text-ink-2" data-testid="deck-image-name">{drafts[0].file.name}</span> : drafts.length > 1 ? <span className="block text-xs text-ink-2" data-testid="deck-image-name">{drafts.length} files, each with its own kind</span> : null}
      {drafts.map((d, i) => {
        const needsConsent = consentRequired(d.kind);
        if (d.state === "added")
          return (
            <div key={d.id} className="flex items-center gap-2 text-sm" data-testid="deck-image-row" data-row={i} data-state="added">
              <Thumb file={d.file} />
              <span className="min-w-0 truncate">{d.file.name}</span>
              <span className="ml-auto shrink-0 font-medium text-good" data-testid="deck-image-row-status">✓ Added</span>
            </div>
          );
        return (
          <div key={d.id} className={drafts.length > 1 ? "space-y-2 rounded-lg border border-line p-2" : "space-y-2"} data-testid="deck-image-row" data-row={i} data-state={d.state}>
            <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
              <span className="flex min-w-0 items-center gap-2">
                <Thumb file={d.file} />
                <span className="truncate">{d.file.name}</span>
                {d.state === "uploading" ? <span className="shrink-0 font-medium" data-testid="deck-image-row-status">{d.pct ? `Uploading ${Math.round(d.pct)}%` : "Uploading…"}</span> : d.state === "waiting" && pending ? <span className="shrink-0" data-testid="deck-image-row-status">Waiting</span> : null}
              </span>
              <button type="button" className="btn btn-ghost btn-xs" aria-label={`Clear ${d.file.name}`} title="Clear" disabled={pending} onClick={() => setDrafts((ds) => ds.filter((x) => x.id !== d.id))} data-testid="deck-image-clear">
                ✕
              </button>
            </div>
            {fixedKind ? null : (
              <label className="block text-sm">
                <span className="label">What is it?</span>
                <select className="field" value={d.kind} disabled={pending} data-testid="deck-image-kind" onChange={(e) => update(d.id, { kind: e.currentTarget.value as DeckImageKind })}>
                  {DECK_IMAGE_KINDS.map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm">
              <span className="label">Caption (optional)</span>
              <input className="field" value={d.caption} disabled={pending} data-testid="deck-image-caption" onChange={(e) => update(d.id, { caption: e.currentTarget.value })} placeholder="So you can find it again; it is the picture's alt text in the file" />
            </label>
            {needsConsent ? (
              <div className="space-y-2 rounded-lg bg-warn-soft p-2" data-testid="deck-image-consent">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={d.noPeople} disabled={pending} data-testid="deck-image-no-people" onChange={(e) => update(d.id, { noPeople: e.currentTarget.checked })} />
                  <span>No people in this: a logo, a chart, a screen with nobody&apos;s details on it.</span>
                </label>
                {d.noPeople ? null : (
                  <>
                    <input className="field" value={d.consentName} disabled={pending} data-testid="deck-image-consent-name" onChange={(e) => update(d.id, { consentName: e.currentTarget.value })} placeholder="Who's in it" />
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={d.consentTick} disabled={pending} data-testid="deck-image-consent-tick" onChange={(e) => update(d.id, { consentTick: e.currentTarget.checked })} />
                      <span>I&apos;ve hidden anyone&apos;s name, email or number who hasn&apos;t agreed to be shown.</span>
                    </label>
                  </>
                )}
              </div>
            ) : null}
            {d.error ? <p className="text-sm text-danger" role="alert" data-testid="deck-image-row-error">{d.error}</p> : null}
          </div>
        );
      })}
      {drafts.length ? (
        <button className="btn btn-primary btn-sm" type="button" disabled={pending} aria-busy={pending} onClick={send} data-testid="deck-image-send">
          {sendLabel}
        </button>
      ) : null}
      {error ? <p className="text-sm text-danger" role="alert" data-testid="deck-image-error">{error}</p> : null}
    </div>
  );
}
