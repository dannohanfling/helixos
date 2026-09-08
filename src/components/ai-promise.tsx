"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useVoice } from "./voice-context";

/**
 * What a ✨ action returns, said before the click: a plain count of the artifacts, derived from the code's return shape.
 * When the member has no AI key it says so instead, with the way to fix it, rather than failing after the click. When their
 * Essence is empty it says the output will read generic until their voice is set up, with the way into the wizard. One line.
 */
export function AiPromise({ enabled, children, needs }: { enabled: boolean; children: ReactNode; needs?: string }) {
  const voice = useVoice();
  return (
    <p className="text-xs text-ink-3" data-testid="ai-promise" data-enabled={enabled ? "1" : "0"} data-voice={voice.ready ? "1" : "0"}>
      {enabled ? (
        <>
          ✨ {children}
          {needs ? <> {needs}</> : null}
          {!voice.ready ? <VoiceLine /> : null}
        </>
      ) : (
        <>
          ✨ With AI needs your own Anthropic or OpenAI key.{" "}
          <Link href="/settings#ai" className="underline">
            Connect it in Settings
          </Link>
          .
        </>
      )}
    </p>
  );
}

/** The one line, said at the point of use and nowhere else. */
export function VoiceLine() {
  return (
    <span data-testid="voice-line">
      {" "}
      Your voice isn&apos;t set up yet, so this will read generic.{" "}
      <Link href="/essence" className="underline">
        Set up your voice
      </Link>
      .
    </span>
  );
}
