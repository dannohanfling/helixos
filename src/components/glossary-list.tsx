"use client";

import { useMemo, useState } from "react";

type Entry = { slug: string; term: string; meaning: string };

/** The glossary's sections with a search box (rev 768): the term or the meaning, any case; each entry has its own #link. */
export function GlossaryList({ sections }: { sections: { heading: string; entries: Entry[] }[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sections;
    return sections.map((s) => ({ ...s, entries: s.entries.filter((e) => `${e.term} ${e.meaning}`.toLowerCase().includes(needle)) })).filter((s) => s.entries.length);
  }, [q, sections]);
  return (
    <div className="space-y-4">
      <input className="field" type="search" value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search the words" aria-label="Search the words" data-testid="glossary-search" />
      {shown.length ? null : <p className="text-sm text-ink-2" data-testid="glossary-none">No word matches that. Try a shorter one.</p>}
      {shown.map((s) => (
        <section key={s.heading} className="card p-4" data-testid="glossary-section">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">{s.heading}</h2>
          <dl className="space-y-3">
            {s.entries.map((e) => (
              <div key={e.slug} id={e.slug} className="scroll-mt-20" data-testid="glossary-entry" data-slug={e.slug}>
                <dt className="font-semibold">
                  <a href={`#${e.slug}`} className="hover:underline">
                    {e.term}
                  </a>
                </dt>
                <dd className="text-sm text-ink-2 [overflow-wrap:anywhere]">{e.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
