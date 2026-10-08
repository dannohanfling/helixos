"use client";

import { useState, useTransition } from "react";
import { setSlideChoiceAction } from "@/lib/actions/deck-images";
import { LAYOUT_LABEL, type SlideLayout } from "@/lib/engine/deck";

/**
 * The coach's two choices on a slide (deck layouts 10): the layout, among the ones the slide may take ("Auto" is the engine's
 * pick, named), and the one phrase in the accent, picked by tapping the headline's words: the first tap starts the phrase, a
 * tap further along extends it (one contiguous run), a tap inside it starts again there; Clear takes the accent off the slide.
 * The thumbnail above shows the result the moment it is saved.
 */
export function SlideChoices({ webinarId, slideKey, headline, auto, options, layout, phrase, cleared }: { webinarId: string; slideKey: string; headline: string; /** The engine's own layout for this slide. */ auto: SlideLayout; options: SlideLayout[]; /** The coach's layout, or null for Auto. */ layout: SlideLayout | null; /** The phrase the slide carries now, or null. */ phrase: string | null; /** The coach cleared the phrase. */ cleared: boolean }) {
  const words = headline.split(/(\s+)/);
  const tokens = words.map((w, i) => ({ w, i, word: !/^\s*$/.test(w) }));
  const range = (() => {
    if (!phrase) return null;
    const at = headline.indexOf(phrase);
    if (at < 0) return null;
    let pos = 0;
    let from = -1, to = -1;
    for (const t of tokens) {
      const end = pos + t.w.length;
      if (t.word && end > at && pos < at + phrase.length) { if (from < 0) from = t.i; to = t.i; }
      pos = end;
    }
    return from < 0 ? null : { from, to };
  })();
  const [sel, setSel] = useState<{ from: number; to: number } | null>(range);
  const [pending, start] = useTransition();
  const text = (r: { from: number; to: number }) => tokens.slice(r.from, r.to + 1).map((t) => t.w).join("").trim();
  const save = (fields: Record<string, string>) => start(async () => { const fd = new FormData(); fd.set("webinarId", webinarId); fd.set("slideKey", slideKey); for (const [k, v] of Object.entries(fields)) fd.set(k, v); await setSlideChoiceAction(fd); });
  const tap = (i: number) => {
    const next = !sel || i < sel.from ? { from: i, to: sel ? sel.to : i } : i > sel.to ? { from: sel.from, to: i } : { from: i, to: i };
    setSel(next);
    save({ accentPhrase: text(next) });
  };
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-line p-2 text-[11px]" data-testid="slide-choices" data-slide-key={slideKey}>
      {options.length ? (
        <label className="flex items-center gap-2">
          <span className="text-ink-3">Layout</span>
          <select className="field w-auto py-0.5 text-[11px]" value={layout ?? ""} disabled={pending} onChange={(e) => save({ layout: e.currentTarget.value })} data-testid="slide-layout">
            <option value="">Auto · {LAYOUT_LABEL[auto]}</option>
            {options.map((o) => (
              <option key={o} value={o}>{LAYOUT_LABEL[o]}</option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-1" data-testid="accent-picker" data-phrase={sel ? text(sel) : ""} data-cleared={cleared ? 1 : 0}>
        <span className="mr-1 text-ink-3">Accent</span>
        {tokens.filter((t) => t.word).map((t) => {
          const on = Boolean(sel) && t.i >= sel!.from && t.i <= sel!.to && !cleared;
          return (
            <button key={t.i} type="button" disabled={pending} onClick={() => tap(t.i)} className={`rounded px-1 ${on ? "bg-accent-soft font-semibold text-accent-ink" : "bg-surface-2 text-ink-2"}`} data-testid="accent-word" data-on={on ? 1 : 0}>
              {t.w}
            </button>
          );
        })}
        {sel || !cleared ? (
          <button type="button" disabled={pending} onClick={() => { setSel(null); save({ accentOff: "1" }); }} className="ml-1 underline" data-testid="accent-clear">Clear</button>
        ) : (
          <button type="button" disabled={pending} onClick={() => save({ accentPhrase: "" })} className="ml-1 underline" data-testid="accent-suggest">Suggest again</button>
        )}
      </div>
    </div>
  );
}
