"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy", className = "btn btn-soft btn-sm", disabled = false, title }: { text: string; label?: string; className?: string; disabled?: boolean; title?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      title={title}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
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
