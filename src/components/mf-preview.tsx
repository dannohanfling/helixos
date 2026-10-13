"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { previewMfAction, type PreviewResult } from "@/lib/actions/magic-funnel";
import { SubmitButton } from "@/components/submit-button";
import { ProgressLine } from "@/components/progress-line";
import { SECTIONS, type MfPitch, type MfSection } from "@/lib/engine/magic-funnel";

const LABEL: Record<MfSection, string> = {
  hero: "Hero",
  why_you: "Why this is for you",
  pillars: "Pillars",
  example: "Example",
  proof_ids: "Proof",
  objection: "Their doubt, answered",
  agenda: "Agenda highlight",
  urgency: "Urgency",
  emotional: "Emotional",
  logical: "Logical",
  confirmation: "Thank-you page",
};

function sectionText(p: MfPitch, s: MfSection, pillarTitle: (id: string) => string, proofLine: (id: string) => string, agendaLine: (id: string) => string): string {
  switch (s) {
    case "hero":
      return `${p.hero.header}\n${p.hero.subheader}\n[${p.hero.cta_label}]`;
    case "why_you":
      return p.why_you.map((b) => `• ${b}`).join("\n");
    case "pillars":
      return p.pillars.order.map((id, i) => `${i + 1}. ${pillarTitle(id)}: ${p.pillars.lines[id] ?? ""}`).join("\n");
    case "example":
      return `Example · ${p.example.title}\n${p.example.text}`;
    case "proof_ids":
      return p.proof_ids.map(proofLine).join("\n") || "(none)";
    case "objection":
      return `${p.objection.objection}\n${p.objection.answer}`;
    case "agenda":
      return [agendaLine(p.agenda.id), p.agenda.why].filter(Boolean).join(" · ");
    case "confirmation":
      return `${p.confirmation.ticket_title}\n${p.confirmation.bring.map((b) => `• ${b}`).join("\n")}`;
    default:
      return p[s];
  }
}

/**
 * The preview (rev 815 §4): a sample conversation in, the whole page that person would get out, section by section, each marked
 * personal or default copy, with the reason a section fell back. Regenerate runs it again. Nothing is stored; it counts toward
 * today's cap.
 */
export function MfPreview({ webinarId, pillars, agenda, proofs }: { webinarId: string; pillars: { id: string; title: string }[]; agenda: { id: string; line: string }[]; proofs: { id: string; line: string }[] }) {
  const [state, act] = useActionState<PreviewResult | null, FormData>(previewMfAction, null);
  const pillarTitle = (id: string) => pillars.find((p) => p.id === id)?.title ?? id;
  const proofLine = (id: string) => proofs.find((p) => p.id === id)?.line ?? id;
  // The agenda item itself, never its id (H-9).
  const agendaLine = (id: string) => agenda.find((a) => a.id === id)?.line ?? "";
  return (
    <div className="space-y-3" data-testid="mf-preview">
      <form action={act} className="grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="webinarId" value={webinarId} />
        <label className="block">
          <span className="label">First name</span>
          <input className="field" name="firstName" defaultValue="Sam" maxLength={40} data-testid="mf-preview-name" />
        </label>
        <label className="block">
          <span className="label">Industry, in their words</span>
          <input className="field" name="industry" maxLength={120} data-testid="mf-preview-industry" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Biggest pain in business, in their words</span>
          <input className="field" name="pain" maxLength={300} data-testid="mf-preview-pain" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">A sample conversation (optional)</span>
          <textarea className="field" name="summary" rows={3} maxLength={1000} data-testid="mf-preview-summary" />
        </label>
        <div className="sm:col-span-2">
          <PreviewProgress error={state && !state.ok ? state.error : null} />
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Writing their page…" data-testid="mf-preview-run">
            {state?.ok ? "Regenerate" : "Preview their page"}
          </SubmitButton>
        </div>
      </form>
      {state && !state.ok ? (
        <p className="rounded-lg border border-warn bg-warn-soft p-2 text-sm" role="status" data-testid="mf-preview-error">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <div className="space-y-2" data-testid="mf-preview-result" data-status={state.status}>
          <p className="text-xs text-ink-3" data-testid="mf-preview-status">
            {state.status === "personal" ? "Every section written for them." : state.status === "partial" ? "Written for them, with some sections on your default copy." : `Your default copy throughout${state.note ? ` (${state.note})` : ""}.`}
          </p>
          {state.profile ? (
            <p className="rounded-lg bg-surface-2 p-2 text-xs" data-testid="mf-preview-profile">
              Profile: {state.profile.industry} · serves {state.profile.who_they_serve} · sells {state.profile.their_offer} · pain: {state.profile.main_pain} · {state.profile.stage} · doubt: {state.profile.likely_objection}
            </p>
          ) : null}
          <ol className="divide-y rounded-lg border">
            {SECTIONS.map((s) => (
              <li key={s} className="p-2 text-sm" data-testid="mf-preview-section" data-section={s} data-source={state.sources[s]}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">{LABEL[s]}</span>
                  <span className={state.sources[s] === "personal" ? "text-good" : "text-ink-3"}>{state.sources[s] === "personal" ? "personal" : "your default"}</span>
                  {state.failed[s] ? <span className="text-warn">fell back: {state.failed[s]}</span> : null}
                </div>
                <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{sectionText(state.pitch, s, pillarTitle, proofLine, agendaLine)}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

const PREVIEW_STEPS = [
  { label: "Building their profile…", until: 30, seconds: 5 },
  { label: "Writing their page…", until: 85, seconds: 25 },
  { label: "Checking it…", until: 100, seconds: 6 },
];
/** The 0 to 100% line for the preview (H-10): the profile, the page, the checks, as estimates; red with the error when it fails. */
function PreviewProgress({ error }: { error: string | null }) {
  const { pending } = useFormStatus();
  const [ran, setRan] = useState(false);
  if (pending && !ran) setRan(true);
  return (
    <ProgressLine
      active={pending}
      done={!pending && ran && !error}
      error={!pending && error ? error : null}
      steps={PREVIEW_STEPS}
      testId="mf-preview-progress"
    />
  );
}
