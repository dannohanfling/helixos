"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";
import { PHONE_MAX_WIDTH, isLauncher, liftPx, staysLifted } from "@/lib/engine/chat-lift";
import { IDENTIFY_SETTLE_MS, type ChatCause } from "@/lib/engine/chat-cause";

/**
 * The coach's Community Loyalty chat (revs 241, 243), on the Ask page only (H-693, plan H-700): every other page is the
 * member's own, with no bubble over it. Once the
 * SDK is ready it is told who is signed in: the member's HelixOS user id, name, email and the identifier hash the server
 * computed (HMAC-SHA256 of that same id under the secret, hex), so the bot links the chat to the same person across channels.
 * The secret behind the hash never comes here.
 *
 * When to call (rev 270): on the SDK's own `chatbot:ready` event, and at once if the SDK has already loaded by the time this
 * mounts (`window.$chatbot.hasLoaded`), since the event can fire before React attaches the listener. Never before the SDK says
 * it is loaded: a call the SDK isn't ready for is dropped, and would have been the last one. Once called, the shell carries
 * `data-chat-identified="true"`, a signal anyone can read in the browser without a secret.
 *
 * Identity first (H-1199, plan H-1203): members reached the bot as "Guest" because the chat could start before `setUser` had
 * landed, so the start flow's sign-in steps saw no email. The chat is now opened only after `setUser` has settled (its promise
 * when it returns one, else IDENTIFY_SETTLE_MS), and `setUser` runs again on every `chatbot:ready`, since a reconnect starts
 * the chat afresh. The page reports once which way it went (no id, name or email), so production shows the cause.
 */
type Chatbot = { hasLoaded?: boolean; setUser?: (id: string, user: { name: string; email: string; identifier_hash: string }) => unknown; open?: () => void; close?: () => void };

/** The chat's own hosts, for telling a CSP block of the chat from any other. */
const CHAT_HOST_RE = /(^|\.)(communityloyalty\.io|dfktv2\.com|ipapi\.co)$/;

/** One report a page: how the chat was told who this is, or what stopped it. Fire and forget; a failure changes nothing. */
function reportCause(cause: ChatCause, host?: string) {
  try {
    void fetch("/api/chat-seen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(host ? { cause, host } : { cause }), keepalive: true }).catch(() => undefined);
  } catch {
    /* reporting never gets in the way of the chat */
  }
}

/** Waits for what `setUser` returned when it is a promise (at most a few seconds), else a short settle. */
function settled(result: unknown): Promise<void> {
  const pause = new Promise<void>((r) => setTimeout(r, IDENTIFY_SETTLE_MS));
  if (result && typeof (result as { then?: unknown }).then === "function") {
    const cap = new Promise<void>((r) => setTimeout(r, 4000));
    return Promise.race([Promise.resolve(result as PromiseLike<unknown>).then(() => undefined, () => undefined), cap]);
  }
  return pause;
}

/**
 * On a phone, the bubble sits on HelixOS's bottom bar (rev 468). Whatever the chat script adds to the page outside HelixOS's own
 * shell is looked at whenever it changes: its small fixed launcher is raised clear of the highest bottom bar on screen (the tab
 * bar, a sticky row of buttons) with a small gap; once it opens into the chat, or the screen is wider than a phone, it goes back
 * where the script put it. Only HelixOS's pages change: the widget's own settings, which apply everywhere it is used, are untouched.
 */
function useLiftLauncher() {
  useEffect(() => {
    const LIFTED = "data-helix-lifted";
    let frame = 0;
    const theirs = (): Element[] =>
      Array.from(document.body.children).filter((c) => !c.querySelector("[data-app-shell]") && !c.hasAttribute("data-app-shell") && !c.closest("[data-testid]") && !c.querySelector("[data-testid]") && !c.tagName.includes("-") && c.tagName !== "SCRIPT" && c.tagName !== "STYLE");
    const settle = () => {
      frame = 0;
      const vp = { width: window.innerWidth, height: window.innerHeight };
      const tops = Array.from(document.querySelectorAll<HTMLElement>("[data-bottom-bar]"))
        .filter((b) => b.offsetParent !== null || getComputedStyle(b).position === "fixed")
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.top);
      const lift = vp.width <= PHONE_MAX_WIDTH ? liftPx(vp.height, tops) : null;
      for (const root of theirs()) {
        for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>("div,iframe,button,a,section,aside"))].slice(0, 300) as HTMLElement[]) {
          const box = el.getBoundingClientRect();
          const fixed = getComputedStyle(el).position === "fixed";
          const lifted = el.hasAttribute(LIFTED);
          if (lifted && (lift === null || !fixed || !staysLifted(box))) {
            // Opened into the chat, or no longer on a phone: back where the script put it.
            const was = el.getAttribute(LIFTED);
            if (was) el.style.setProperty("bottom", was);
            else el.style.removeProperty("bottom");
            el.removeAttribute(LIFTED);
          } else if (lift !== null && (lifted || isLauncher(box, vp, fixed))) {
            if (!lifted) el.setAttribute(LIFTED, el.style.getPropertyValue("bottom"));
            const want = `${lift}px`;
            if (el.style.getPropertyValue("bottom") !== want) el.style.setProperty("bottom", want, "important");
          }
        }
      }
    };
    // At most every 150 ms (rev 843): the chat animating fires many changes a second, and reading every box on each one made
    // the chat feel stuck on a phone.
    let last = 0;
    let timer = 0;
    const soon = () => {
      if (frame || timer) return;
      const wait = Math.max(0, 150 - (Date.now() - last));
      timer = window.setTimeout(() => {
        timer = 0;
        last = Date.now();
        frame = requestAnimationFrame(settle);
      }, wait);
    };
    const watch = new MutationObserver(soon);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", soon);
    soon();
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", soon);
      if (frame) cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, []);
}

/** Set on <html> while the Ask page is open; without it, everything the chat script added to the page is hidden (globals.css). */
export const CHAT_HERE = "data-chat-here";
/** Marks what the chat script added to <body>, outside HelixOS's own shell. */
export const CHAT_MARK = "data-helix-chat";

/** Not HelixOS's own: outside the app shell, no walk or app markers, not a custom element, script or style. */
const notOurs = (c: Element): boolean => !c.querySelector("[data-app-shell]") && !c.hasAttribute("data-app-shell") && !c.closest("[data-testid]") && !c.querySelector("[data-testid]") && !c.tagName.includes("-") && c.tagName !== "SCRIPT" && c.tagName !== "STYLE" && c.tagName !== "NOSCRIPT";
/** What a chat launcher or window looks like, for anything the script adds after the member has left the Ask page. */
const looksLikeChat = (c: Element): boolean => Boolean(c.querySelector("iframe")) || c.tagName === "IFRAME" || /chat|bot|widget|launcher/i.test(`${c.id} ${typeof c.className === "string" ? c.className : ""}`);

let marking: MutationObserver | null = null;
/**
 * Leaving the Ask page (H-693): the script puts its launcher and chat window on <body>, outside React, so a client-side move
 * would leave them behind. From the moment the Ask page first mounts, what is added to <body> is watched for the rest of the
 * page's life: on the Ask page anything not HelixOS's own is marked; off it, only what looks like the chat (it may add more
 * after the member has left), so a dialog another page opens is never caught. One CSS rule hides what is marked while <html>
 * lacks CHAT_HERE. Nothing that was on the page before is touched.
 */
function markScriptNodes() {
  if (marking) return;
  marking = new MutationObserver((records) => {
    const here = document.documentElement.hasAttribute(CHAT_HERE);
    for (const r of records)
      for (const n of Array.from(r.addedNodes)) {
        if (!(n instanceof Element) || n.hasAttribute(CHAT_MARK) || !notOurs(n)) continue;
        if (here || looksLikeChat(n)) n.setAttribute(CHAT_MARK, "");
      }
  });
  marking.observe(document.body, { childList: true });
}

/** On the Ask page: the chat shows, and opens on the page when the script can; off it, hidden and closed. */
function useChatHere() {
  useEffect(() => {
    markScriptNodes();
    document.documentElement.setAttribute(CHAT_HERE, "");
    return () => {
      document.documentElement.removeAttribute(CHAT_HERE);
      (window as Window & { $chatbot?: Chatbot }).$chatbot?.close?.();
    };
  }, []);
}

export function ChatWidget({ src, userId, name, email, hash, flowNs }: { src: string; userId: string; name: string; email: string; hash: string; flowNs: string | null }) {
  const called = useRef(false);
  useChatHere();
  useLiftLauncher();
  useEffect(() => {
    const w = window as Window & { $chatbot?: Chatbot };
    let gone = false;
    let reported = false;
    const report = (cause: ChatCause, host?: string) => {
      if (reported) return;
      reported = true;
      reportCause(cause, host);
    };
    const identify = (why: "ready" | "loaded") => {
      const bot = w.$chatbot;
      if (!bot?.setUser) return false;
      if (why !== "ready" && !bot.hasLoaded) return false;
      const result = bot.setUser(userId, { name, email, identifier_hash: hash });
      called.current = true;
      document.documentElement.setAttribute("data-chat-identified", "true");
      document.documentElement.setAttribute("data-chat-identified-by", why);
      report(why === "ready" ? "identified-ready" : "identified-loaded");
      // The page is the chat's (H-693): open it here once the identity has landed, so the start flow sees the member's email.
      void settled(result).then(() => {
        if (gone) return;
        document.documentElement.setAttribute("data-chat-opened", "true");
        w.$chatbot?.open?.();
      });
      return true;
    };
    // Every ready, not only the first: a reconnect starts the chat afresh, as a Guest unless it is told again.
    const onReady = () => identify("ready");
    window.addEventListener("chatbot:ready", onReady);
    document.addEventListener("chatbot:ready", onReady);
    // The browser blocked one of the chat's own hosts: say which, once.
    const onBlocked = (e: SecurityPolicyViolationEvent) => {
      let host = "";
      try {
        host = new URL(e.blockedURI).hostname;
      } catch {
        return;
      }
      if (CHAT_HOST_RE.test(host)) report("csp-blocked", host);
    };
    document.addEventListener("securitypolicyviolation", onBlocked);
    // Already loaded before this mounted: say who this is now. Otherwise look once a second for the SDK's loaded flag, for a
    // minute, in case its event fired between the script's load and the listener above.
    let ticks = 0;
    const timer = setInterval(() => {
      if (called.current || identify("loaded")) return clearInterval(timer);
      if (++ticks > 60) {
        clearInterval(timer);
        report("sdk-never-loaded");
      }
    }, 1000);
    identify("loaded");
    return () => {
      gone = true;
      window.removeEventListener("chatbot:ready", onReady);
      document.removeEventListener("chatbot:ready", onReady);
      document.removeEventListener("securitypolicyviolation", onBlocked);
      clearInterval(timer);
    };
  }, [userId, name, email, hash]);
  return (
    <>
      <Script src={src} strategy="afterInteractive" />
      <span hidden data-testid="chat-widget" data-user-id={userId} data-hash={hash} data-flow={flowNs ?? ""} />
    </>
  );
}
