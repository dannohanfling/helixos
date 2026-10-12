"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";
import { PHONE_MAX_WIDTH, isLauncher, liftPx, staysLifted } from "@/lib/engine/chat-lift";

/**
 * The coach's Community Loyalty chat bubble (revs 241, 243), on every signed-in page of a workspace that set it up. Once the
 * SDK is ready it is told who is signed in: the member's HelixOS user id, name, email and the identifier hash the server
 * computed (HMAC-SHA256 of that same id under the secret, hex), so the bot links the chat to the same person across channels.
 * The secret behind the hash never comes here.
 *
 * When to call (rev 270): on the SDK's own `chatbot:ready` event, and at once if the SDK has already loaded by the time this
 * mounts (`window.$chatbot.hasLoaded`), since the event can fire before React attaches the listener. Never before the SDK says
 * it is loaded: a call the SDK isn't ready for is dropped, and would have been the last one. Once called, the shell carries
 * `data-chat-identified="true"`, a signal anyone can read in the browser without a secret.
 */
type Chatbot = { hasLoaded?: boolean; setUser?: (id: string, user: { name: string; email: string; identifier_hash: string }) => void };

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
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(settle);
    };
    const watch = new MutationObserver(soon);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", soon);
    soon();
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", soon);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}

export function ChatWidget({ src, userId, name, email, hash, flowNs }: { src: string; userId: string; name: string; email: string; hash: string; flowNs: string | null }) {
  const called = useRef(false);
  useLiftLauncher();
  useEffect(() => {
    const w = window as Window & { $chatbot?: Chatbot };
    const identify = (why: string) => {
      const bot = w.$chatbot;
      if (!bot?.setUser) return false;
      if (why !== "ready" && !bot.hasLoaded) return false;
      bot.setUser(userId, { name, email, identifier_hash: hash });
      called.current = true;
      document.documentElement.setAttribute("data-chat-identified", "true");
      document.documentElement.setAttribute("data-chat-identified-by", why);
      return true;
    };
    const onReady = () => identify("ready");
    window.addEventListener("chatbot:ready", onReady);
    document.addEventListener("chatbot:ready", onReady);
    // Already loaded before this mounted: say who this is now. Otherwise look once a second for the SDK's loaded flag, for a
    // minute, in case its event fired between the script's load and the listener above.
    let ticks = 0;
    const timer = setInterval(() => {
      if (called.current || identify("loaded") || ++ticks > 60) clearInterval(timer);
    }, 1000);
    identify("loaded");
    return () => {
      window.removeEventListener("chatbot:ready", onReady);
      document.removeEventListener("chatbot:ready", onReady);
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
