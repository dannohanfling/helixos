"use client";

import { useState } from "react";
import { generateBackgroundAction, makeGraphicAction } from "@/lib/actions/ladders";
import { ANTHROPIC_NO_IMAGES, FACEBOOK_NOTE } from "@/lib/engine/graphic";
import { DeckImageUpload } from "@/components/deck-image-upload";
import { SubmitButton } from "@/components/submit-button";

export type PhotoChoice = { id: string; caption: string | null; kind: string; source: string; width: number; height: number };
/**
 * Make the graphic, the step (rev 513, 524): the photo (the suggestion first, any of the member's own, or one uploaded here),
 * the headline (the ladder's or an alternate), a stronger fade, and AI backgrounds for this one graphic when the kit allows.
 * The render is the server's; this holds only what was picked.
 */
export function GraphicMaker({ ladderId, choices, suggestedId, preselectId, headlines, options, aiAllowed, canGenerate, aiNote, badgeReady, owner }: { ladderId: string; choices: PhotoChoice[]; suggestedId: string | null; preselectId: string | null; headlines: string[]; options: { photoImageId: string | null; headline: string; strongFade: boolean; aiBackground: boolean } | null; aiAllowed: boolean; canGenerate: boolean; aiNote: "none" | "anthropic" | "broken" | null; badgeReady: boolean; owner: { workspaceId: string; userId: string } }) {
  const [photos, setPhotos] = useState<PhotoChoice[]>(choices);
  const [photoId, setPhotoId] = useState<string>(preselectId ?? options?.photoImageId ?? suggestedId ?? "");
  const [headline, setHeadline] = useState<string>(headlines.includes(options?.headline ?? "") ? (options?.headline ?? headlines[0] ?? "") : (headlines[0] ?? ""));
  const [strongFade, setStrongFade] = useState(options?.strongFade ?? false);
  const [aiBackground, setAiBackground] = useState(options?.aiBackground ?? aiAllowed);
  const picked = photos.find((p) => p.id === photoId) ?? null;
  return (
    <div className="space-y-3" data-testid="graphic-maker">
      <form action={makeGraphicAction} className="grid gap-3 sm:grid-cols-2" data-testid="graphic-form">
        <input type="hidden" name="id" value={ladderId} />
        <label className="block sm:col-span-2">
          <span className="label">Photo</span>
          <select className="field text-sm" name="photoImageId" value={photoId} onChange={(e) => setPhotoId(e.target.value)} data-testid="graphic-photo">
            <option value="">No photo: a plain dark ground</option>
            {photos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === suggestedId ? "Suggested · " : ""}{p.caption?.trim() || p.kind}{p.source === "ai" ? " (AI background)" : ""} · {p.width}×{p.height}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] text-ink-3">{suggestedId ? "The suggestion matches the headline's words against your Images captions. " : "Nothing in your Images fits yet. "}Any person in it is you, in your own photo; a face is never generated.</span>
        </label>
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in route; next/image cannot fetch it */}
        {picked ? <img src={`/api/deck-images/${picked.id}`} alt={picked.caption ?? ""} className="max-h-40 rounded-lg object-cover sm:col-span-2" data-testid="graphic-photo-preview" /> : null}
        <label className="block sm:col-span-2">
          <span className="label">Headline</span>
          <select className="field text-sm" name="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} data-testid="graphic-headline">
            {headlines.map((h, i) => (
              <option key={h} value={h}>{i === 0 ? "" : "Alternate · "}{h}</option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="strongFade" value="1" checked={strongFade} onChange={(e) => setStrongFade(e.target.checked)} className="mt-1" data-testid="graphic-strong-fade" />
          <span>
            Stronger fade
            <span className="block text-xs text-ink-3">For a bright or busy photo, so the words stay clear.</span>
          </span>
        </label>
        {aiAllowed ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="aiBackground" value="1" checked={aiBackground} onChange={(e) => setAiBackground(e.target.checked)} className="mt-1" data-testid="graphic-ai-toggle" />
            <span>
              Allow an AI background for this graphic
              <span className="block text-xs text-ink-3">Backgrounds only, never a person. Off for everything in Settings → Brand kit.</span>
            </span>
          </label>
        ) : (
          <p className="text-xs text-ink-3" data-testid="graphic-ai-off">AI backgrounds are off in your Brand kit: your own photos only, or a plain ground.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Drawing…" data-testid="graphic-make">{options ? "Remake the graphic" : "Make the graphic"}</SubmitButton>
          {!badgeReady ? <span className="text-xs text-ink-3">Your name, @handle and avatar for the badge are on Settings → Brand kit.</span> : null}
        </div>
      </form>
      {aiAllowed && aiBackground ? (
        <form action={generateBackgroundAction} className="flex flex-wrap items-center gap-2" data-testid="graphic-background-form">
          <input type="hidden" name="id" value={ladderId} />
          <SubmitButton className="btn btn-soft btn-sm" pendingText="Making a scene…" disabled={!canGenerate} data-testid="graphic-generate">Generate a background</SubmitButton>
          <span className="text-xs text-ink-3">{canGenerate ? "A scene from the headline's words, with your own OpenAI key. No people, no text. It joins your Images as an AI background." : aiNote === "anthropic" ? ANTHROPIC_NO_IMAGES : aiNote === "broken" ? "Your AI key needs attention on Settings → AI." : "Add an OpenAI key in Settings → AI to make backgrounds."}</span>
        </form>
      ) : null}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-xs font-semibold text-ink-2">Upload a photo for this graphic</summary>
        <div className="mt-2">
          <DeckImageUpload workspaceId={owner.workspaceId} userId={owner.userId} defaultKind="photo" compact onRecorded={(img) => { setPhotos((ps) => [{ id: img.id, caption: img.caption, kind: "photo", source: "upload", width: img.width, height: img.height }, ...ps]); setPhotoId(img.id); }} />
        </div>
      </details>
      <p className="text-[11px] text-ink-3">1080 × 1350, stored once at 2× (2160 × 2700) as a PNG in your Images. {FACEBOOK_NOTE}</p>
    </div>
  );
}
