"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";
import { Landing } from "@/components/hermes/landing";
import type { CallContext, Proof } from "@/lib/hermes/data";
import { SECTIONS, allDefault, fallbackInWords, previewPath, type MfPitch, type MfProfile, type MfSection, type SectionSource } from "@/lib/engine/magic-funnel";
import "@/components/hermes/hermes.css";

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

type Event =
  | { kind: "started"; at: number }
  | { kind: "profile"; profile: MfProfile }
  | { kind: "draft"; pitch: MfPitch }
  | { kind: "final"; profile: MfProfile | null; pitch: MfPitch; sources: Record<MfSection, SectionSource>; status: string; note: string | null; failed: Partial<Record<MfSection, string>>; code: string }
  | { kind: "error"; error: string };
type Phase = "idle" | "profile" | "writing" | "checking" | "done" | "error";
/** The sections swap in one after another as the draft lands, so the page reads as written rather than replaced at once. */
const SWAP_MS = 110;

/**
 * The preview (rev 815 §4; demo-proof since H-142): a made-up prospect in, and the page they would get, in the gold design,
 * shown at once with the default copy and rewritten section by section as the writer goes. An honest status line with the
 * seconds, no percentage. The button is off while it writes. Under the page: Open as their page, Copy link, the copy as
 * text, and the reasons any section kept the default copy, for the coach alone. The write counts toward today's cap.
 */
export function MfPreview({ webinarId, ctx, fonts, defaultPitch, pillars, agenda, proofs, now }: { webinarId: string; ctx: CallContext | null; fonts: string; defaultPitch: MfPitch; pillars: { id: string; title: string }[]; agenda: { id: string; line: string }[]; proofs: { id: string; who: string; quote: string; line: string }[]; /** The server's clock, so the countdown's first value matches on both sides of hydration. */ now: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pitch, setPitch] = useState<MfPitch>(defaultPitch);
  const [sources, setSources] = useState<Record<MfSection, SectionSource>>(allDefault());
  const [profile, setProfile] = useState<MfProfile | null>(null);
  const [final, setFinal] = useState<Extract<Event, { kind: "final" }> | null>(null);
  const [firstName, setFirstName] = useState("Sam");
  const [seconds, setSeconds] = useState(0);
  const [runs, setRuns] = useState(0);
  const writing = phase === "profile" || phase === "writing" || phase === "checking";
  const inFlight = useRef(false);
  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };
  useEffect(() => {
    if (!writing) return;
    const started = Date.now();
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(t);
  }, [writing]);
  useEffect(() => clearTimers, []);

  /** Each section of `next` lands SWAP_MS after the one before; `mark` says what the source becomes. */
  const swapIn = (next: MfPitch, mark: (s: MfSection) => SectionSource, after?: () => void) => {
    clearTimers();
    SECTIONS.forEach((s, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setPitch((p) => ({ ...p, [s]: s === "proof_ids" ? next.proof_ids : (next as unknown as Record<string, unknown>)[s] }) as MfPitch);
          setSources((src) => ({ ...src, [s]: mark(s) }));
          if (i === SECTIONS.length - 1) after?.();
        }, SWAP_MS * (i + 1)),
      );
    });
  };

  const run = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (inFlight.current) return; // a second click while it writes starts nothing
    inFlight.current = true;
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("firstName") ?? "").trim() || "Sam";
    setFirstName(name);
    setError(null);
    setFinal(null);
    setProfile(null);
    setSeconds(0);
    setPhase("profile");
    setRuns((n) => n + 1);
    clearTimers();
    setPitch(defaultPitch);
    setSources(allDefault());
    // What the member reads on a failure is one of our own sentences (the route's refusal, or the plain one), never a transport's.
    let problem: string | null = null;
    try {
      const res = await fetch("/api/mf/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ webinarId, firstName: name, industry: fd.get("industry"), pain: fd.get("pain"), summary: fd.get("summary") }) });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        problem = j?.error ?? "The preview couldn't start. Try again.";
      }
      const reader = res.ok && res.body ? res.body.getReader() : null;
      if (reader) await read(reader);
    } catch {
      problem = "The preview lost its connection. Try again.";
    } finally {
      inFlight.current = false;
    }
    if (problem) {
      clearTimers();
      setPhase("error");
      setError(problem);
    }
  };
  /** One JSON event per line as the route streams them. */
  const read = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handle(JSON.parse(line) as Event);
        nl = buf.indexOf("\n");
      }
    }
  };
  const handle = (ev: Event) => {
    if (ev.kind === "profile") {
      setProfile(ev.profile);
      setPhase("writing");
    } else if (ev.kind === "draft") {
      setPhase("checking");
      swapIn(ev.pitch, () => "personal");
    } else if (ev.kind === "final") {
      // Every section lands as the checks left it: personal, or back on the default copy.
      swapIn(ev.pitch, (s) => ev.sources[s], () => {
        setProfile(ev.profile);
        setFinal(ev);
        setPhase("done");
      });
    } else if (ev.kind === "error") {
      clearTimers();
      setPhase("error");
      setError(ev.error);
    }
  };

  const pillarTitle = (id: string) => pillars.find((p) => p.id === id)?.title ?? id;
  const proofLine = (id: string) => proofs.find((p) => p.id === id)?.line ?? id;
  const agendaLine = (id: string) => agenda.find((a) => a.id === id)?.line ?? "";
  const pageProofs: Proof[] = pitch.proof_ids.map((id) => proofs.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => ({ id: p.id, who: p.who, quote: p.quote }));
  const personal = Object.values(sources).some((s) => s === "personal");
  const failed = final ? (Object.keys(final.failed) as MfSection[]).filter((s) => final.failed[s]) : [];
  const status =
    phase === "profile" ? `Reading who they are… ${seconds}s` : phase === "writing" ? `Writing their page, usually about 45 seconds… ${seconds}s` : phase === "checking" ? `Checking every line against the facts… ${seconds}s` : phase === "done" && final ? (final.status === "personal" ? "Every section written for them." : final.status === "partial" ? "Written for them, with some sections on your default copy." : `Your default copy throughout${final.note ? ` (${final.note})` : ""}.`) : "";
  const link = final ? `${typeof window === "undefined" ? "" : window.location.origin}${previewPath(final.code)}` : "";

  return (
    <div className="space-y-3" data-testid="mf-preview" data-phase={phase} data-runs={runs}>
      <form onSubmit={run} className="grid gap-2 sm:grid-cols-2" data-testid="mf-preview-form">
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
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <SubmitButton className="btn btn-primary btn-sm" disabled={writing} aria-disabled={writing} data-testid="mf-preview-run">
            {writing ? "Writing…" : final ? "Write it again" : "Preview their page"}
          </SubmitButton>
          {status ? (
            <span className="text-sm text-ink-3" role="status" aria-live="polite" data-testid="mf-preview-status">
              {status}
            </span>
          ) : null}
          {final ? (
            <>
              <a href={previewPath(final.code)} target="_blank" rel="noopener" className="btn btn-soft btn-sm" data-testid="mf-preview-open">
                Open as their page →
              </a>
              <span data-testid="mf-preview-copy" data-link={link}>
                <CopyButton text={link} label="Copy link" />
              </span>
            </>
          ) : null}
        </div>
      </form>
      {error ? (
        <p className="rounded-lg border border-warn bg-warn-soft p-2 text-sm" role="alert" data-testid="mf-preview-error">
          {error}
        </p>
      ) : null}
      {ctx ? (
        <div className={`${fonts} max-h-[80vh] overflow-auto rounded-xl border border-line`} data-testid="mf-preview-page" data-personal={personal ? "1" : "0"}>
          <Landing ctx={ctx} pitch={pitch} personal={personal} firstName={personal ? firstName : ""} prefill={personal ? { firstName, email: "", phone: "" } : null} proofs={pageProofs} code={null} formError={null} now={now} preview />
        </div>
      ) : (
        <p className="text-sm text-ink-3" data-testid="mf-preview-no-page">
          Give the webinar a date and time (Run it) and the page shows here in the gold design.
        </p>
      )}
      {final ? (
        <div className="space-y-2" data-testid="mf-preview-result" data-status={final.status}>
          {profile ? (
            <p className="rounded-lg bg-surface-2 p-2 text-xs" data-testid="mf-preview-profile">
              Profile: {profile.industry} · serves {profile.who_they_serve} · sells {profile.their_offer} · pain: {profile.main_pain} · {profile.stage} · doubt: {profile.likely_objection}
            </p>
          ) : null}
          {failed.length ? (
            <details className="rounded-lg border p-2 text-sm" data-testid="mf-preview-why">
              <summary className="cursor-pointer text-ink-2">Why some sections used your default copy ({failed.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
                {failed.map((s) => (
                  <li key={s} data-testid="mf-preview-why-line" data-section={s}>
                    <b>{LABEL[s]}</b>: {fallbackInWords(final.failed[s]!)}.
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <details className="rounded-lg border p-2 text-sm" data-testid="mf-preview-copy-list">
            <summary className="cursor-pointer text-ink-2">The copy, section by section</summary>
            <ol className="mt-2 divide-y">
              {SECTIONS.map((s) => (
                <li key={s} className="py-2 text-sm" data-testid="mf-preview-section" data-section={s} data-source={final.sources[s]}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">{LABEL[s]}</span>
                    <span className={final.sources[s] === "personal" ? "text-good" : "text-ink-3"}>{final.sources[s] === "personal" ? "personal" : "your default"}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{sectionText(final.pitch, s, pillarTitle, proofLine, agendaLine)}</p>
                </li>
              ))}
            </ol>
          </details>
        </div>
      ) : null}
    </div>
  );
}
