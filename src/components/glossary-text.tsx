"use client";

/**
 * A line of agent text with its glossary words underlined (rev 768 §1): tap or press Enter on one for the short meaning and a
 * "More" link to its entry. Escape or a second tap closes it. The text itself is always plain text.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { GlossaryMark } from "@/lib/engine/glossary";

export function GlossaryText({ marks }: { marks: GlossaryMark[] }) {
  return (
    <>
      {marks.map((m, i) => (m.slug ? <GlossaryWord key={i} mark={m} /> : <span key={i}>{m.text}</span>))}
    </>
  );
}

function GlossaryWord({ mark }: { mark: GlossaryMark }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={box} className="gl-word">
      <button type="button" className="gl-mark" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="glossary-mark">
        {mark.text}
      </button>
      {open ? (
        <span role="note" className="gl-pop" data-testid="glossary-pop">
          <b>{mark.term}</b> {(mark.meaning ?? "").split(/(?<=[.!?])\s/)[0]}{" "}
          <Link href={`/glossary#${mark.slug}`} className="gl-more">
            More
          </Link>
        </span>
      ) : null}
    </span>
  );
}
