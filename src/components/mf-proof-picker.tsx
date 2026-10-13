"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchMfProofsAction, type MfProofHit } from "@/lib/actions/magic-funnel";

/**
 * "Proof it may show" (H-7): one multi-select dropdown. Closed, it shows only the chosen proof as chips (tags read-only, "×" to
 * remove); open, it searches the Proof Bank by name, tag or a few words of the proof, 20 at a time, more on scroll. The form
 * gets one hidden proofIds field per chosen item and nothing else, however big the Proof Bank is.
 */
export function MfProofPicker({ initial, max = 40 }: { initial: MfProofHit[]; max?: number }) {
  const [chosen, setChosen] = useState<MfProofHit[]>(initial);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MfProofHit[]>([]);
  const [more, setMore] = useState(false);
  const [pending, start] = useTransition();
  const asked = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const load = (words: string, offset: number) => {
    const n = ++asked.current;
    start(async () => {
      const r = await searchMfProofsAction(words, offset);
      if (n !== asked.current) return;
      setHits((h) => (offset ? [...h, ...r.hits] : r.hits));
      setMore(r.more);
    });
  };
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(q, 0), 250);
    return () => clearTimeout(t);
  }, [q, open]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const isChosen = (id: string) => chosen.some((c) => c.id === id);
  const toggle = (h: MfProofHit) => setChosen((c) => (isChosen(h.id) ? c.filter((x) => x.id !== h.id) : c.length >= max ? c : [...c, h]));

  return (
    <div ref={box} className="relative" data-testid="mf-proofs">
      {chosen.map((c) => (
        <input key={c.id} type="hidden" name="proofIds" value={c.id} />
      ))}
      <div className="flex flex-wrap gap-1">
        {chosen.length ? (
          chosen.map((c) => (
            <span key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs" data-testid="mf-proof-chip">
              <span className="min-w-0 truncate font-medium">{c.label}</span>
              {c.tags.length ? <span className="min-w-0 truncate text-ink-3">{c.tags.join(", ")}</span> : null}
              <button type="button" className="px-1 text-ink-3 hover:text-ink" aria-label={`Remove ${c.label}`} onClick={() => toggle(c)}>
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="text-sm text-ink-3">None chosen: it picks from all of them.</span>
        )}
      </div>
      <input
        type="search"
        className="field mt-2"
        placeholder="Search proof by name, tag or words"
        role="combobox"
        aria-label="Search proof"
        aria-controls="mf-proof-list"
        aria-expanded={open}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
          if (e.key === "Escape") setOpen(false);
        }}
        data-testid="mf-proof-search"
      />
      {open ? (
        <ul
          id="mf-proof-list"
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (more && !pending && el.scrollTop + el.clientHeight > el.scrollHeight - 40) load(q, hits.length);
          }}
          data-testid="mf-proof-list"
        >
          {hits.map((h) => (
            <li key={h.id} role="option" aria-selected={isChosen(h.id)}>
              <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                <input type="checkbox" checked={isChosen(h.id)} onChange={() => toggle(h)} className="mt-1" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium">{h.label}</span>
                  {h.tags.length ? <span className="block text-xs text-ink-3">{h.tags.join(", ")}</span> : null}
                </span>
              </label>
            </li>
          ))}
          {pending ? <li className="px-2 py-1 text-xs text-ink-3">Loading…</li> : null}
          {!pending && !hits.length ? <li className="px-2 py-1 text-xs text-ink-3">No proof matches.</li> : null}
          {chosen.length >= max ? <li className="px-2 py-1 text-xs text-ink-3">That&apos;s {max}, the most it uses.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
