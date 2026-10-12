"use client";

import { useState } from "react";

export type PickerPhoto = { id: string; caption: string | null; kind: string; source?: string; width: number; height: number };

const describe = (p: PickerPhoto) => `${p.caption?.trim() || p.kind || "photo"}${p.source === "ai" ? " (AI background)" : ""}`;

/**
 * The Photo dropdown with its preview (rev 839). The dropdown stays the real form field; beside it (under it on a phone) a
 * thumbnail of the chosen image in the graphic's own 4:5 frame, its one-line description and its size, updated the moment
 * the choice changes, before anything is saved. "No photo" shows the plain dark ground. Thumbnails come from the member's
 * own Images through the private route, small, never the full file. "See all" opens a grid of them to tap.
 */
export function PhotoPicker({ name, photos, suggestedId, emptyLabel, empty, defaultValue = "", value, onChange, label, hint, testId }: { name: string; photos: PickerPhoto[]; suggestedId?: string | null; emptyLabel: string; empty: "plain" | "suggest"; defaultValue?: string; value?: string; onChange?: (id: string) => void; label: string; hint?: React.ReactNode; testId: string }) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const set = (id: string) => {
    if (value === undefined) setOwn(id);
    onChange?.(id);
  };
  const picked = photos.find((p) => p.id === current) ?? null;
  // Suggested first, the rest as the dropdown lists them.
  const ordered = suggestedId ? [...photos.filter((p) => p.id === suggestedId), ...photos.filter((p) => p.id !== suggestedId)] : photos;
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start" data-testid={`${testId}-picker`}>
      <div className="min-w-0 flex-1">
        <label className="block">
        <span className="label">{label}</span>
        <select className="field w-full text-sm" name={name} value={current} onChange={(e) => set(e.target.value)} data-testid={testId}>
          <option value="">{emptyLabel}</option>
          {ordered.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === suggestedId ? "Suggested · " : ""}
              {describe(p)} · {p.width}×{p.height}
            </option>
          ))}
        </select>
        {hint ? <span className="mt-0.5 block text-[11px] text-ink-3">{hint}</span> : null}
        </label>
        {photos.length ? (
          <details className="mt-2" data-testid={`${testId}-all`}>
            <summary className="cursor-pointer text-xs underline">See all</summary>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Your Images">
              {ordered.map((p) => (
                <button key={p.id} type="button" onClick={() => set(p.id)} aria-pressed={p.id === current} className={`overflow-hidden rounded-md border-2 ${p.id === current ? "border-accent" : "border-transparent"}`} data-testid={`${testId}-tile`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in route; next/image cannot fetch it */}
                  <img src={`/api/deck-images/${p.id}?thumb=1`} alt={describe(p)} className="aspect-[4/5] w-full object-cover" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <figure className="w-40 shrink-0" data-testid={`${testId}-preview`}>
        {picked ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in route; next/image cannot fetch it
          <img key={picked.id} src={`/api/deck-images/${picked.id}?thumb=1`} alt={describe(picked)} className="aspect-[4/5] w-40 rounded-lg border object-cover" data-testid={`${testId}-thumb`} />
        ) : empty === "plain" ? (
          <div className="aspect-[4/5] w-40 rounded-lg border" style={{ background: "linear-gradient(180deg, #2a2a2a 0%, #0a0a0a 100%)" }} role="img" aria-label="A plain dark ground" data-testid={`${testId}-swatch`} />
        ) : (
          <div className="flex aspect-[4/5] w-40 items-center justify-center rounded-lg border border-dashed p-3 text-center text-xs text-ink-3" data-testid={`${testId}-suggest`}>
            HelixOS picks one from your Images by the headline
          </div>
        )}
        <figcaption className="mt-1 text-[11px] leading-snug text-ink-3 [overflow-wrap:anywhere]" data-testid={`${testId}-caption`}>
          {picked ? `${describe(picked)} · ${picked.width}×${picked.height}` : empty === "plain" ? "No photo: a plain dark ground" : "Suggested when it's made"}
        </figcaption>
      </figure>
    </div>
  );
}
