"use client";

import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card } from "@/components/ui";
import { POSTURE_GROUP, principleNoteText, reframeCopyText, reframesCopyText, type Reframe } from "@/lib/engine/socrates";

/**
 * The library, grouped by the objection in front of you. A spoken reframe copies clean on its own; tick several and the copy
 * carries each one's objection group and name as a heading. A principle is coaching about posture: it has no copy-to-prospect
 * button, only a note to self. The words are the data file's; nothing here rewrites them.
 */
export function ReframeLibrary({ groups, principles }: { groups: { group: string; reframes: Reframe[] }[]; principles: Reframe[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const all = groups.flatMap((g) => g.reframes);
  const selected = all.filter((r) => picked.includes(r.id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="space-y-6" data-testid="reframe-groups">
      {groups.map((g) => (
        <section key={g.group} data-testid="reframe-group" data-group={g.group}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
            {g.group} <Badge>{g.reframes.length}</Badge>
          </h2>
          <div className="grid gap-3 lg:grid-cols-3">
            {g.reframes.map((r) => (
              <Card
                key={r.id}
                title={r.name}
                action={
                  <span className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-ink-2">
                      <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} data-testid="reframe-pick" />
                      Select
                    </label>
                    <CopyButton text={reframeCopyText(r)} label="Copy" className="btn btn-ghost btn-xs" />
                  </span>
                }
              >
                <article data-testid="reframe" data-id={r.id} data-type={r.type} className="space-y-2 text-sm">
                  <p className="text-base font-semibold leading-snug">{r.memorablePhrase}</p>
                  <p className="leading-relaxed">{r.metaphor}</p>
                  <p className="text-ink-2">{r.simpleExplanation}</p>
                  <p><span className="label">Transition in</span> <span className="italic">{r.transitionIn}</span></p>
                  <p><span className="label">When to use</span> {r.whenToUse}</p>
                  {r.credit ? <p className="text-xs text-ink-3" data-testid="reframe-credit">Credit: {r.credit}</p> : null}
                </article>
              </Card>
            ))}
          </div>
        </section>
      ))}
      {selected.length ? (
        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 shadow" data-testid="reframe-copy-bar">
          <span className="text-sm">{selected.length} selected{selected.length > 1 ? ": each copies under its objection and name" : ""}</span>
          <span className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setPicked([])}>Clear</button>
            <CopyButton text={reframesCopyText(selected)} label={`Copy ${selected.length}`} className="btn btn-primary btn-xs" />
          </span>
        </div>
      ) : null}
      <section data-testid="reframe-principles" data-group={POSTURE_GROUP}>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
          {POSTURE_GROUP} <Badge>{principles.length}</Badge>
        </h2>
        <p className="mb-2 text-xs text-ink-2">How to hold yourself on the call. These are for you, not lines to say to a prospect.</p>
        <div className="grid gap-3 lg:grid-cols-3">
          {principles.map((r) => (
            <Card key={r.id} title={r.name} action={<CopyButton text={principleNoteText(r)} label="Copy note to self" className="btn btn-ghost btn-xs" />}>
              <article data-testid="reframe" data-id={r.id} data-type={r.type} className="space-y-2 text-sm">
                <p className="text-base font-semibold leading-snug">{r.memorablePhrase}</p>
                <p className="leading-relaxed">{r.metaphor}</p>
                <p className="text-ink-2">{r.simpleExplanation}</p>
                <p><span className="label">When to use</span> {r.whenToUse}</p>
                {r.credit ? <p className="text-xs text-ink-3" data-testid="reframe-credit">Credit: {r.credit}</p> : null}
              </article>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
