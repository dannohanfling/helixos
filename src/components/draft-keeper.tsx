"use client";

import { useEffect, useRef, useState } from "react";
import { restore, snapshot, type Snapshot } from "@/lib/form-keep";
import { sendInFlight } from "@/components/submit-button";

/**
 * An unsaved draft of the form it sits in, kept in this browser (handoff rev 160), so a refresh or a slip of the thumb doesn't
 * lose the month's eleven answers, the feedback, an Office Hours request, Essence or an offer. It comes back with "Draft
 * restored" and is dropped after a successful save (the shared SubmitButton says so). Credentials are never written to it.
 * `id` names the draft: the form and whose it is, so two members on one computer never see each other's.
 *
 * A draft that was sent is kept until the save is confirmed (3 Oct, after a member lost his month's answers to a glitch): a
 * send that never answered (the connection dropped, an error page, a deploy mid-session, a sign-in that had run out) leaves
 * it marked sent, and the next visit puts it back with "Your last save didn't go through". A sent draft that matches what is
 * already saved changes nothing on the page and shows nothing. Sent drafts are kept a week.
 */
/** How long a sent draft waits for its save to be confirmed before it is dropped. */
const SENT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** The draft last sent from this browser, so a save confirmed under another name (a new item given its id) drops it. */
const PENDING = "helix.draft.pending";
/** "ooh.<who>.new" and "ooh.<who>.<id>" are one family: the same form for the same member. */
const familyOf = (key: string) => key.slice(0, key.lastIndexOf("."));

/** `legacyId`: the name a draft of this form was kept under before, read once and moved, so renaming a draft never loses one. */
export function DraftKeeper({ id, legacyId }: { id: string; legacyId?: string }) {
  const here = useRef<HTMLSpanElement>(null);
  const [restored, setRestored] = useState<null | "draft" | "failed">(null);
  useEffect(() => {
    const form = here.current?.closest("form");
    if (!form) return;
    const key = `helix.draft.${id}`;
    type Draft = { snap: Snapshot; sent: boolean; at?: number };
    const read = (k = key): Draft | null => {
      try {
        const raw = localStorage.getItem(k);
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
    const drop = (k: string) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* nothing to clear */
      }
    };
    // A draft never sent is a slip to restore; a sent one, a save that never answered. Either comes back only where it
    // differs from what the page already holds, so a save that did land shows nothing.
    if (legacyId && legacyId !== key.slice("helix.draft.".length)) {
      try {
        const old = localStorage.getItem(`helix.draft.${legacyId}`);
        if (old && !localStorage.getItem(key)) localStorage.setItem(key, old);
        if (old) localStorage.removeItem(`helix.draft.${legacyId}`);
      } catch {
        /* storage unavailable */
      }
    }
    const t = setTimeout(() => {
      // Read now, not on mount: a save confirmed in between has already dropped it.
      const draft = read();
      if (!draft || !Array.isArray(draft.snap)) return;
      if (draft.sent && sendInFlight()) return;
      if (draft.sent && (!draft.at || Date.now() - draft.at > SENT_KEEP_MS)) {
        drop(key);
        return;
      }
      if (restore(form, draft.snap) > 0) setRestored(draft.sent ? "failed" : "draft");
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
      write({ snap: snapshot(form, { secrets: false }), sent: true, at: Date.now() });
      try {
        localStorage.setItem(PENDING, key);
      } catch {
        /* storage unavailable */
      }
    };
    const saved = (e: Event) => {
      if ((e as CustomEvent<{ form: HTMLFormElement }>).detail?.form !== form) return;
      clearTimeout(timer);
      drop(key);
      // The draft that was sent may have been kept under another name: a new request becomes a saved one with its own id
      // ("ooh.<who>.new" saves as "ooh.<who>.<id>"). The same form, saved, confirms it too.
      try {
        const pending = localStorage.getItem(PENDING);
        if (pending && pending !== key && familyOf(pending) === familyOf(key)) drop(pending);
        if (pending) localStorage.removeItem(PENDING);
      } catch {
        /* nothing to clear */
      }
      setRestored(null);
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
  }, [id, legacyId]);
  return (
    <span ref={here} className={restored ? "block rounded-lg bg-surface-2 p-2 text-sm text-ink-2" : "hidden"} role="status" data-testid="draft-restored" data-kind={restored ?? undefined}>
      {restored === "failed" ? "Your last save didn't go through. What you typed is back: press Save again." : restored ? "Draft restored. Nothing was saved yet: press Save when it's ready." : null}
    </span>
  );
}
