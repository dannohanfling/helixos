"use client";

import { useEffect, useRef, useState } from "react";
import { restore, snapshot, type Snapshot } from "@/lib/form-keep";
import { sendInFlight } from "@/components/submit-button";
import { newerDraft } from "@/lib/engine/drafts";

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
 *
 * The draft follows the member to another device (rev 444, part two): every copy kept here is also kept on the server, a couple
 * of seconds after the typing stops (never while the form itself is being sent), and a page opening a form puts back the newer of the two, so the
 * month's answers started on the laptop are there on the phone. The server's copy goes when the save is confirmed, like this one.
 */
/** How long typing rests before the server's copy is brought up to date. */
const SERVER_DEBOUNCE_MS = 2000;

/** The server's copy, through /api/drafts: never a POST, so a form's own send is the only one a page makes. Failures are quiet. */
type ServerCopy = { data: string; sent: boolean; at: number } | null;
const readServer = async (key: string): Promise<ServerCopy> => {
  const res = await fetch(`/api/drafts?key=${encodeURIComponent(key)}`, { cache: "no-store", credentials: "same-origin" });
  return res.ok ? ((await res.json()) as ServerCopy) : null;
};
/**
 * One at a time, in order: a confirmed save's delete must never arrive before an earlier copy and bring it back. Each answer is
 * read to its end, so the request is finished, not left open.
 */
let serverQueue: Promise<unknown> = Promise.resolve();
const inOrder = (request: () => Promise<Response>) => {
  serverQueue = serverQueue.then(async () => (await request()).text()).catch(() => undefined);
  return serverQueue;
};
// `keepalive` only for the copy pushed as the page goes away: it is what lets that one outlive the page, and a request made
// with it while the page stays never reports itself done to some browsers' tooling.
const saveServer = (key: string, data: string, sent: boolean, leaving = false) =>
  inOrder(() => fetch("/api/drafts", { method: "PUT", keepalive: leaving, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, data, sent }) }));
const dropServer = (keys: string[]) =>
  inOrder(() => fetch("/api/drafts", { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys }) }));
/** How long a sent draft waits for its save to be confirmed before it is dropped. */
const SENT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** The draft last sent from this browser, so a save confirmed under another name (a new item given its id) drops it. */
const PENDING = "helix.draft.pending";
/** "ooh.<who>.new" and "ooh.<who>.<id>" are one family: the same form for the same member. */
const familyOf = (key: string) => key.slice(0, key.lastIndexOf("."));

/** `legacyId`: the name a draft of this form was kept under before, read once and moved, so renaming a draft never loses one. */
/**
 * `confirms`: a draft the page knows was just saved, though its form isn't here (saving a webinar section moves on to the next
 * one): it is let go, here and on the server, so it never comes back as a save that didn't go through.
 */
export function DraftKeeper({ id, legacyId, confirms }: { id: string; legacyId?: string; confirms?: string }) {
  const here = useRef<HTMLSpanElement>(null);
  const [restored, setRestored] = useState<null | "draft" | "failed">(null);
  useEffect(() => {
    const form = here.current?.closest("form");
    if (!form) return;
    const key = `helix.draft.${id}`;
    type Draft = { snap: Snapshot; sent: boolean; at?: number };
    let serverTimer: ReturnType<typeof setTimeout> | undefined;
    // The copy waiting for the typing to rest: sent at once if the member leaves first, so nothing typed stays behind.
    let waiting: Draft | null = null;
    const pushNow = (leaving = false) => {
      clearTimeout(serverTimer);
      const d = waiting;
      waiting = null;
      if (d) void saveServer(id, JSON.stringify(d.snap), d.sent, leaving);
    };
    const onLeave = () => pushNow(true);
    const toServer = (d: Draft) => {
      waiting = d;
      clearTimeout(serverTimer);
      serverTimer = setTimeout(() => pushNow(), SERVER_DEBOUNCE_MS);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") pushNow(true);
    };
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
    if (confirms && confirms !== id) {
      try {
        localStorage.removeItem(`helix.draft.${confirms}`);
      } catch {
        /* nothing to clear */
      }
      void dropServer([confirms]);
    }
    let gone = false;
    // A save confirmed while the server's copy was on its way: that copy is the one just sent, never one to put back.
    let confirmed = false;
    const t = setTimeout(async () => {
      // The server's copy too, so a draft started on another device comes back here; the newer of the two is the one.
      let server: Draft | null = null;
      try {
        const r = await readServer(id);
        if (r) server = { snap: JSON.parse(r.data) as Snapshot, sent: r.sent, at: r.at };
      } catch {
        /* offline or signed out: this browser's copy alone */
      }
      if (gone || confirmed) return;
      // Read now, not on mount: a save confirmed in between has already dropped it.
      const local = read();
      const draft = newerDraft(local && Array.isArray(local.snap) ? { ...local, at: local.at ?? 0 } : null, server && Array.isArray(server.snap) ? { ...server, at: server.at ?? 0 } : null);
      if (!draft) return;
      if (draft.sent && sendInFlight()) return;
      if (draft.sent && (!draft.at || Date.now() - draft.at > SENT_KEEP_MS)) {
        drop(key);
        void dropServer([id]);
        return;
      }
      if (restore(form, draft.snap) > 0) {
        // A form folded away ("Edit this month") is opened, so what came back is in sight, not hidden behind a summary.
        for (let d = form.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
        setRestored(draft.sent ? "failed" : "draft");
      }
    }, 0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = (e: Event) => {
      if (!e.isTrusted) return; // a restore's own events are not typing
      clearTimeout(timer);
      timer = setTimeout(() => {
        const d = { snap: snapshot(form, { secrets: false }), sent: false, at: Date.now() };
        write(d);
        toServer(d);
      }, 300);
    };
    const sending = (e: Event) => {
      if ((e as CustomEvent<{ form: HTMLFormElement }>).detail?.form !== form) return;
      clearTimeout(timer);
      const d = { snap: snapshot(form, { secrets: false }), sent: true, at: Date.now() };
      write(d);
      // Nothing goes to the server while the form itself is being sent: the waiting copy is let go, and this browser's copy
      // covers a send that doesn't go through. The server's copy is for another device, not for this one's failed save.
      clearTimeout(serverTimer);
      waiting = null;
      try {
        localStorage.setItem(PENDING, key);
      } catch {
        /* storage unavailable */
      }
    };
    const saved = (e: Event) => {
      if ((e as CustomEvent<{ form: HTMLFormElement }>).detail?.form !== form) return;
      clearTimeout(timer);
      clearTimeout(serverTimer);
      waiting = null;
      confirmed = true;
      drop(key);
      const serverKeys = [id];
      // The draft that was sent may have been kept under another name: a new request becomes a saved one with its own id
      // ("ooh.<who>.new" saves as "ooh.<who>.<id>"). The same form, saved, confirms it too.
      try {
        const pending = localStorage.getItem(PENDING);
        if (pending && pending !== key && familyOf(pending) === familyOf(key)) {
          drop(pending);
          serverKeys.push(pending.slice("helix.draft.".length));
        }
        if (pending) localStorage.removeItem(PENDING);
      } catch {
        /* nothing to clear */
      }
      void dropServer(serverKeys);
      setRestored(null);
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    window.addEventListener("helix:saved", saved);
    window.addEventListener("helix:sending", sending);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    return () => {
      gone = true;
      clearTimeout(t);
      clearTimeout(timer);
      pushNow();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
      window.removeEventListener("helix:saved", saved);
      window.removeEventListener("helix:sending", sending);
    };
  }, [id, legacyId, confirms]);
  return (
    <span ref={here} className={restored ? "block rounded-lg bg-surface-2 p-2 text-sm text-ink-2" : "hidden"} role="status" data-testid="draft-restored" data-kind={restored ?? undefined}>
      {restored === "failed" ? "Your last save didn't go through. What you typed is back: press Save again." : restored ? "Draft restored. Nothing was saved yet: press Save when it's ready." : null}
    </span>
  );
}
