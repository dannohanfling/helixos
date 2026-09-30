"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

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

export function ChatWidget({ src, userId, name, email, hash, flowNs }: { src: string; userId: string; name: string; email: string; hash: string; flowNs: string | null }) {
  const called = useRef(false);
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
