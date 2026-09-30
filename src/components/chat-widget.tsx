"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

/**
 * The coach's Community Loyalty chat bubble (revs 241, 243), on every signed-in page of a workspace that set it up. Once the
 * widget says it is ready it is told who is signed in: the member's HelixOS user id, name, email and the identifier hash the
 * server computed, so the bot links the chat to the same person across channels. The secret behind the hash never comes here.
 * The sub flow id (`flowNs`) is carried for the walk and the day the widget's own call for it is known; nothing is guessed.
 */
type Chatbot = { setUser?: (id: string, user: { name: string; email: string; identifier_hash: string }) => void };

export function ChatWidget({ src, userId, name, email, hash, flowNs }: { src: string; userId: string; name: string; email: string; hash: string; flowNs: string | null }) {
  const done = useRef(false);
  useEffect(() => {
    const w = window as Window & { $chatbot?: Chatbot };
    const identify = () => {
      if (done.current || !w.$chatbot?.setUser) return;
      done.current = true;
      w.$chatbot.setUser(userId, { name, email, identifier_hash: hash });
    };
    window.addEventListener("chatbot:ready", identify);
    document.addEventListener("chatbot:ready", identify);
    // Some builds of the widget are ready before the listener is; look once a second for a minute, then stop.
    let ticks = 0;
    const timer = setInterval(() => {
      identify();
      if (done.current || ++ticks > 60) clearInterval(timer);
    }, 1000);
    return () => {
      window.removeEventListener("chatbot:ready", identify);
      document.removeEventListener("chatbot:ready", identify);
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
