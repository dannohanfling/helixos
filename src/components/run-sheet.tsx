import { clock } from "@/lib/engine/webinar";
import { formatPrice } from "@/lib/engine/offer-score";
import { QA_SECTION_KEY, type SectionContext, type WebinarContext } from "@/lib/engine/webinar-context";

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="mt-2 grid grid-cols-[6rem_1fr] gap-2 text-base leading-snug" data-testid={testId}>
      <span className="text-[11px] uppercase tracking-widest text-ink-3 pt-1">{label}</span>
      <div className="whitespace-pre-line">{children}</div>
    </div>
  );
}

function Section({ s }: { s: SectionContext }) {
  return (
    <section className="border-t border-line pt-4" data-testid="runsheet-section" data-key={s.sectionKey}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">
          {s.order} · {s.name}
        </h3>
        <span className="tabular text-sm text-ink-2" data-testid="runsheet-clock">
          {s.durationMin} min · {s.start}
        </span>
      </div>
      {s.transitionIn ? <p className="mt-1 text-sm italic text-ink-2">── in: {s.transitionIn}</p> : null}
      {s.keyPoints.length ? (
        <Row label="Key points">
          <ul className="list-disc pl-5">
            {s.keyPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Row>
      ) : null}
      {s.script ? (
        <Row label="Script">
          <p className="text-xl leading-snug">{s.script}</p>
        </Row>
      ) : (
        <Row label="Script">
          <span className="text-ink-3">Not scripted.</span>
        </Row>
      )}
      {s.deliveryNote ? (
        <Row label="Delivery" testId="runsheet-delivery">
          <span className="rounded bg-accent-soft px-1">{s.deliveryNote}</span>
        </Row>
      ) : null}
      {s.proof ? (
        <Row label="Proof" testId="runsheet-proof">
          {s.proof.who ? `${s.proof.who}: ` : ""}&ldquo;{s.proof.quote}&rdquo; <span className="text-xs text-ink-3">[{s.proof.source === "bank" ? "approved" : "typed, permission ticked"}]</span>
        </Row>
      ) : null}
      {s.evidence ? (
        <Row label="Evidence" testId="runsheet-evidence">
          {s.evidence.claim} <span className="text-sm text-ink-3">({s.evidence.citation})</span>
        </Row>
      ) : null}
      {s.story ? (
        <Row label="Story" testId="runsheet-story">
          <span className="font-medium">{s.story.name}</span>
          <p className="mt-1 text-sm text-ink-2">{s.story.body}</p>
          {s.story.moral ? <p className="mt-1 text-sm text-ink-3">Moral: {s.story.moral}</p> : null}
        </Row>
      ) : null}
      {s.asset ? (
        <Row label={s.asset.type}>
          <span className="font-medium">{s.asset.name}</span>
          <p className="mt-1 text-sm text-ink-2">{s.asset.body}</p>
        </Row>
      ) : null}
      {s.offer && s.sectionKey !== QA_SECTION_KEY ? (
        <Row label="Offer" testId="runsheet-offer">
          <span className="font-medium">{s.offer.name}</span> · {s.offer.container || "container not chosen"} · {formatPrice(s.offer.price, s.offer.currency)}
          {s.offer.components.length ? (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {s.offer.components.map((x, i) => (
                <li key={i}>
                  {x.name}
                  {x.oneLiner ? ` — ${x.oneLiner}` : ""}
                  {x.beliefBreak !== "none" ? <span className="text-ink-3"> · breaks {x.beliefBreak}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {s.offer.guarantee ? <p className="mt-1 text-sm">Guarantee: {s.offer.guarantee}</p> : null}
        </Row>
      ) : null}
      {s.objections.length ? (
        <Row label="Objections" testId="runsheet-objections">
          <ul className="space-y-1 text-sm">
            {s.objections.map((o) => (
              <li key={o.id}>
                <span className="font-medium">{o.name}</span>
                {o.reframe ? <span className="text-ink-2"> — {o.reframe.split("\n")[0]}</span> : null}
              </li>
            ))}
          </ul>
        </Row>
      ) : null}
      {s.placeholders.length ? (
        <Row label="Unfilled" testId="runsheet-unfilled">
          {s.placeholders.map((t) => (
            <span key={t} className="mr-1 rounded bg-warn-soft px-1 text-warn">
              {t}
            </span>
          ))}
        </Row>
      ) : null}
      {s.transitionOut ? <p className="mt-2 text-sm italic text-ink-2">── out: {s.transitionOut}</p> : null}
    </section>
  );
}

/** One column, big type, the clock down the side, everything wired to each section rendered in place. Prints as it reads. */
export function RunSheetView({ c }: { c: WebinarContext }) {
  return (
    <article className="space-y-6 text-ink" data-testid="run-sheet">
      <header>
        <h1 className="text-2xl font-semibold" data-testid="runsheet-title">
          {c.title}
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Presented by {c.presenter} · {c.totalMin} min · scripted ≈ {c.scriptedMin} min
        </p>
        <p className="mt-1 text-xs text-ink-3" data-testid="runsheet-legend">
          Proof marked [approved] is from the bank with permission on record; [typed, permission ticked] was typed here with the same tick. Nothing else reaches this sheet.
        </p>
        {c.placeholders.length ? (
          <p className="mt-2 rounded-lg border border-warn bg-warn-soft p-2 text-sm" data-testid="runsheet-placeholders">
            {c.placeholders.length} {c.placeholders.length === 1 ? "section has" : "sections have"} unfilled slots: {c.placeholders.map((p) => `${p.section} (${p.tokens.join(" ")})`).join("; ")}.
          </p>
        ) : null}
      </header>
      {c.acts.map((a) => (
        <div key={a.key} className="space-y-4" data-testid="runsheet-act" data-act={a.key}>
          <h2 className="flex items-baseline justify-between border-b-2 border-ink pb-1 text-base font-semibold uppercase tracking-wide">
            <span>{a.label}</span>
            <span className="tabular text-sm font-normal text-ink-2">
              {a.durationMin} min · {clock(a.startMin)} → {clock(a.endMin)}
            </span>
          </h2>
          {a.sections.map((s) => (
            <Section key={s.sectionKey} s={s} />
          ))}
        </div>
      ))}
    </article>
  );
}
