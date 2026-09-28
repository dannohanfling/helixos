"use client";

import { useEffect, useRef, useState } from "react";
import { restore, snapshot, type Snapshot } from "@/lib/form-keep";

/**
 * An unsaved draft of the form it sits in, kept in this browser (handoff rev 160), so a refresh or a slip of the thumb doesn't
 * lose the month's eleven answers, the feedback, an Office Hours request, Essence or an offer. It comes back with "Draft
 * restored" and is dropped after a successful save (the shared SubmitButton says so). Credentials are never written to it.
 * `id` names the draft: the form and whose it is, so two members on one computer never see each other's.
 */
export function DraftKeeper({ id }: { id: string }) {
  const here = useRef<HTMLSpanElement>(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const form = here.current?.closest("form");
    if (!form) return;
    const key = `helix.draft.${id}`;
    type Draft = { snap: Snapshot; sent: boolean };
    const read = (): Draft | null => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as Draft) : null;
      } catch {
        return null;
      }
    };
    const write = (d: Draft) => {
      try {
        localStorage.setItem(key, JSON.stringify(d));
      } catch {
        /* storage unavailable: nothing kept */
      }
    };
    // Only a draft never sent is a slip to restore: a sent one was saved, or its refusal put the typing back already.
    const draft = read();
    const t = setTimeout(() => {
      if (draft && !draft.sent && Array.isArray(draft.snap) && restore(form, draft.snap) > 0) setRestored(true);
    }, 0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = (e: Event) => {
      if (!e.isTrusted) return; // a restore's own events are not typing
      clearTimeout(timer);
      timer = setTimeout(() => write({ snap: snapshot(form, { secrets: false }), sent: false }), 300);
    };
    const sending = (e: Event) => {
      if ((e as CustomEvent<{ form: HTMLFormElement }>).detail?.form !== form) return;
      clearTimeout(timer);
      write({ snap: snapshot(form, { secrets: false }), sent: true });
    };
    const saved = (e: Event) => {
      if ((e as CustomEvent<{ form: HTMLFormElement }>).detail?.form !== form) return;
      clearTimeout(timer);
      try {
        localStorage.removeItem(key);
      } catch {
        /* nothing to clear */
      }
      setRestored(false);
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    window.addEventListener("helix:saved", saved);
    window.addEventListener("helix:sending", sending);
    return () => {
      clearTimeout(t);
      clearTimeout(timer);
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
      window.removeEventListener("helix:saved", saved);
      window.removeEventListener("helix:sending", sending);
    };
  }, [id]);
  return (
    <span ref={here} className={restored ? "block rounded-lg bg-surface-2 p-2 text-sm text-ink-2" : "hidden"} role="status" data-testid="draft-restored">
      {restored ? "Draft restored. Nothing was saved yet: press Save when it's ready." : null}
    </span>
  );
}
