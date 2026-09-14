import type { CallSheet } from "@/lib/engine/socrates";
import { UNFILLED_CLOSE, UNFILLED_OPEN } from "@/lib/engine/socrates";

/** A line of the sheet with any unfilled blank shown as such, visibly, never as finished text. */
function Line({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split(new RegExp(`(${UNFILLED_OPEN}.+?${UNFILLED_CLOSE})`, "g"));
  return (
    <p className={`whitespace-pre-line ${className}`}>
      {parts.map((part, i) =>
        part.startsWith(UNFILLED_OPEN) ? (
          <span key={i} className="rounded bg-warn-soft px-1 text-warn" data-testid="sheet-unfilled">
            unfilled: {part.slice(UNFILLED_OPEN.length, -UNFILLED_CLOSE.length)}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

/**
 * The two-sided call sheet, as a client runs a call from it. YOU is the largest text on the sheet and is said as written.
 * "Listen for" is italic, smaller and grey: visibly not something you say. A branch's condition is italic and indented, its
 * line is normal weight in quotes because it is spoken, and the reframe's name follows small and grey. Writing space under
 * each beat, because the client is capturing what the prospect actually said. The framework letters stay in the builder.
 */
export function CallSheetView({ sheet }: { sheet: CallSheet }) {
  return (
    <article className="space-y-6 text-ink" data-testid="call-sheet">
      <header>
        <h1 className="text-lg font-semibold tracking-wide" data-testid="sheet-title">{sheet.title}</h1>
        <p className="text-xs italic text-ink-3">{sheet.subtitle}</p>
      </header>
      {sheet.beats.map((b) => (
        <section key={b.n} className="border-t border-line pt-4" data-testid="sheet-beat" data-n={b.n}>
          <p className="text-[11px] uppercase tracking-widest text-ink-3">{b.n} · {b.name}</p>
          <p className="mt-2 text-[11px] uppercase tracking-widest text-ink-3">You</p>
          {b.you.map((line, i) => (
            <Line key={i} text={line} className="mt-1 text-xl leading-snug" />
          ))}
          {b.followUps.map((line, i) => (
            <div key={i} className="mt-2">
              <p className="text-[11px] uppercase tracking-widest text-ink-3">Follow-up</p>
              <Line text={line} className="text-base leading-snug" />
            </div>
          ))}
          {b.reframes.map((r) => {
            const [said, ...rest] = r.said.split("\n");
            return (
              <div key={r.name} className="mt-2" data-testid="sheet-reframe">
                <p className="text-[11px] uppercase tracking-widest text-ink-3">Reframe</p>
                <p className="text-base leading-snug">&ldquo;{said}&rdquo;</p>
                {rest.map((x, i) => (
                  <p key={i} className="text-xs text-ink-3">{x}</p>
                ))}
                <p className="text-xs text-ink-3">— {r.name}</p>
              </div>
            );
          })}
          {b.listenFor ? <Line text={b.listenFor} className="mt-2 text-sm italic text-ink-3" /> : null}
          {b.branches.map((br) => (
            <div key={br.group} className="mt-3 pl-4" data-testid="sheet-branch" data-group={br.group}>
              <p className="text-sm italic text-ink-2" data-testid="sheet-branch-condition">↳ {br.condition}</p>
              {br.lines.map((l) => {
                const [said, ...rest] = l.said.split("\n");
                return (
                  <div key={l.name} className="mt-1 pl-4">
                    <p className="text-base leading-snug" data-testid="sheet-branch-line">&ldquo;{said}&rdquo;</p>
                    {rest.map((r, i) => (
                      <p key={i} className="text-xs text-ink-3">{r}</p>
                    ))}
                    <p className="text-xs text-ink-3">— {l.name}</p>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="mt-4 space-y-4" aria-hidden="true">
            <div className="border-b border-line" />
            <div className="border-b border-line" />
          </div>
        </section>
      ))}
    </article>
  );
}
