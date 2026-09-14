"use client";

import { useState } from "react";

/**
 * Copies `text`. With `html` as well, both flavours go to the clipboard, so an editor that prefers HTML (Docs, Word, Notion)
 * keeps italics and indents and everything else falls back to the plain text. The HTML flavour is the caller's to build from
 * block elements only: a <br> becomes a backslash in a Markdown-storing destination, a <p> boundary becomes a blank line.
 */
export function CopyButton({ text, html, label = "Copy", className = "btn btn-soft btn-sm", disabled = false, title }: { text: string; html?: string; label?: string; className?: string; disabled?: boolean; title?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      title={title}
      onClick={async () => {
        try {
          if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
            await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
          } else {
            await navigator.clipboard.writeText(text);
          }
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}
