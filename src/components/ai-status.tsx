"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { NARRATION_STEP_MS, narrationLine } from "@/lib/engine/ai-narration";
import { useVoice } from "./voice-context";

/**
 * The rotating status line under a ✨ action while its call is in flight. Renders nothing when idle, so the page's own
 * result or error takes over the moment the call returns; a failed call never leaves a line stranded.
 */
export function AiStatus({ feature, active }: { feature: string; active: boolean }) {
  const voice = useVoice();
  const [elapsed, setElapsed] = useState(0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const tick = () => {
      setReduced(mq.matches);
      setElapsed(Date.now() - started);
    };
    tick();
    const id = window.setInterval(tick, NARRATION_STEP_MS);
    return () => window.clearInterval(id);
  }, [active]);
  const line = active ? narrationLine(feature, elapsed, reduced, voice.ready) : null;
  if (!line) return null;
  return (
    <p className="mt-2 text-xs text-ink-2" role="status" aria-live="polite" data-testid="ai-status" data-feature={feature}>
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden="true" />
      {line}
    </p>
  );
}

/**
 * The same line for a server-action form: place it inside the form. `onlyWhen` narrates only the submit that actually
 * runs the AI (a form can have a plain button next to the ✨ one); `enabled` is false when the member has no key.
 */
export function AiFormStatus({ feature, enabled = true, onlyWhen }: { feature: string; enabled?: boolean; onlyWhen?: { field: string; value: string } }) {
  const { pending, data } = useFormStatus();
  const isAi = !onlyWhen || data?.get(onlyWhen.field) === onlyWhen.value;
  return <AiStatus feature={feature} active={enabled && pending && isAi} />;
}
