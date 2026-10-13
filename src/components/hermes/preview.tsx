"use client";

import { useActionState, useState } from "react";
import { previewMfAction, type PreviewResult } from "@/lib/actions/magic-funnel";
import { SubmitButton } from "@/components/submit-button";
import type { MfPitch } from "@/lib/engine/magic-funnel";
import type { CallContext } from "@/lib/hermes/data";
import { Landing } from "@/components/hermes/landing";
import { Confirm } from "@/components/hermes/confirm";
import "@/components/hermes/hermes.css";

/**
 * Preview: a made-up prospect's two HelixOS pages. The engine writes their page exactly as it would for a real one (the Magic
 * funnel's own preview action; nothing is stored), then both pages render here with the personal sections outlined.
 */
export function HermesPreview({ ctx, fonts, defaultPitch }: { ctx: CallContext; fonts: string; defaultPitch: MfPitch }) {
  const [state, action] = useActionState<PreviewResult | null, FormData>(previewMfAction, null);
  const [tab, setTab] = useState<"landing" | "confirm">("landing");
  const [cold, setCold] = useState(false);
  const [now] = useState(() => Date.now());
  const firstName = state?.ok && !cold ? "Sam" : "";
  const pitch = state?.ok && !cold ? state.pitch : defaultPitch;
  return (
    <div className="space-y-3">
      <form action={action} className="grid gap-3 sm:grid-cols-2" data-testid="hm-preview-form">
        <input type="hidden" name="webinarId" value={ctx.webinarId} />
        <input type="hidden" name="firstName" value="Sam" />
        <label className="block">
          <span className="label">Their industry</span>
          <input name="industry" className="input" maxLength={120} placeholder="e.g. a pilates studio" />
        </label>
        <label className="block">
          <span className="label">Biggest pain in business</span>
          <input name="pain" className="input" maxLength={300} placeholder="e.g. reels get likes but no consults" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">A sample conversation (optional)</span>
          <textarea name="summary" className="input" rows={3} maxLength={1000} />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <SubmitButton pendingText="Writing…" data-testid="hm-preview-run">
            {state?.ok ? "Regenerate" : "Write their pages"}
          </SubmitButton>
          {state && !state.ok ? <span className="text-sm text-danger">{state.error}</span> : null}
          {state?.ok ? <span className="text-sm text-ink-3">{state.status === "default" ? `Default copy (${state.note ?? "no profile"})` : `Personal: ${state.status}`}</span> : null}
        </div>
      </form>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which page">
        <button type="button" role="tab" aria-selected={tab === "landing"} className={`btn btn-sm ${tab === "landing" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("landing")}>
          Landing page
        </button>
        <button type="button" role="tab" aria-selected={tab === "confirm"} className={`btn btn-sm ${tab === "confirm" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("confirm")}>
          Confirmation page
        </button>
        <label className="ml-auto flex min-h-[44px] items-center gap-2 text-sm">
          <input type="checkbox" checked={cold} onChange={(e) => setCold(e.target.checked)} /> Cold version (for ads)
        </label>
      </div>
      <div className={`${fonts} max-h-[80vh] overflow-auto rounded-xl border border-line`} data-testid="hm-preview">
        {tab === "landing" ? (
          <Landing ctx={ctx} pitch={pitch} personal={Boolean(firstName)} firstName={firstName} prefill={firstName ? { firstName, email: "sam@example.com", phone: "" } : null} proofs={[]} code={null} formError={null} now={now} preview />
        ) : (
          <Confirm ctx={ctx} firstName={firstName || "Sam"} pitch={firstName ? pitch : null} icsHref="#" preview />
        )}
      </div>
    </div>
  );
}
