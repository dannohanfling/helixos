"use client";

import { useState } from "react";
import { MAX_FOLLOW_UPS, type QuestionLike } from "@/lib/engine/socrates";

/** What the form says when the cap is reached: nothing extra can be chosen, so nothing is ever silently dropped. */
export const FOLLOW_UP_CAP_LINE = "Two follow-ups per beat. Untick one to swap.";

/**
 * The question and its follow-ups at one beat. The cap is the form's: a third follow-up cannot be ticked, and the line says why;
 * the question itself cannot be its own follow-up. The server checks the same rules again, because a form is not a guarantee.
 */
export function QuestionPicker({ library, primaryId, followUpIds, scriptType }: { library: QuestionLike[]; primaryId: string; followUpIds: string[]; scriptType: string }) {
  const [primary, setPrimary] = useState(primaryId);
  const [follow, setFollow] = useState(followUpIds.filter((id) => id !== primaryId));
  const full = follow.length >= MAX_FOLLOW_UPS;
  const toggle = (id: string) => setFollow((f) => (f.includes(id) ? f.filter((x) => x !== id) : full ? f : [...f, id]));
  const pick = (id: string) => {
    setPrimary(id);
    setFollow((f) => f.filter((x) => x !== id));
  };
  return (
    <>
      <fieldset>
        <legend className="label">The question</legend>
        {library.length ? (
          <ul className="mt-1 space-y-1.5" data-testid="beat-library">
            <li>
              <label className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-3 hover:bg-surface-2">
                <input type="radio" name="primary" value="" checked={!primary} onChange={() => pick("")} className="mt-1" data-testid="pick-none" />
                <span>No library question here; my own words below.</span>
              </label>
            </li>
            {library.map((q) => (
              <li key={q.id}>
                <label className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input type="radio" name="primary" value={q.id} checked={primary === q.id} onChange={() => pick(q.id)} className="mt-1" data-testid="pick" />
                  <span className="min-w-0 flex-1">
                    {q.question}
                    <span className="ml-1 text-[11px] text-ink-3">{q.own ? "yours" : (q.nepqCategory ?? q.source)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-ink-3" data-testid="beat-empty">Nothing tagged for this beat and {scriptType}. Write your own below.</p>
        )}
      </fieldset>
      {library.length > 1 ? (
        <fieldset data-testid="beat-follow-ups" data-full={full ? "1" : "0"}>
          <legend className="label">Follow-ups, up to {MAX_FOLLOW_UPS} (optional)</legend>
          <ul className="mt-1 space-y-1.5">
            {library.map((q) => {
              const isPrimary = q.id === primary;
              const checked = follow.includes(q.id);
              const disabled = isPrimary || (full && !checked);
              return (
                <li key={q.id}>
                  <label className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${disabled ? "text-ink-3" : "hover:bg-surface-2"}`}>
                    <input type="checkbox" name="followUpIds" value={q.id} checked={checked} disabled={disabled} onChange={() => toggle(q.id)} className="mt-1" data-testid="pick-follow" />
                    <span className="min-w-0 flex-1">
                      {q.question}
                      {isPrimary ? <span className="ml-1 text-[11px] text-ink-3">the question itself</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {full ? <p className="mt-1 text-xs text-ink-2" data-testid="follow-up-cap">{FOLLOW_UP_CAP_LINE}</p> : null}
        </fieldset>
      ) : null}
    </>
  );
}
