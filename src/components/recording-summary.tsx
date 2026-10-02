import type { ReactNode } from "react";

/**
 * Fathom's summary is markdown: "## " headings, "- " or "* " bullets, numbered lines and **bold**. This renders those and nothing
 * else; any other syntax shows as the plain text it is. Links are not followed: a summary is a model's reading of a call.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>));
}

export function RecordingSummary({ markdown, className = "" }: { markdown: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items;
    blocks.push(
      list.kind === "ul" ? (
        <ul key={blocks.length} className="list-disc space-y-1 pl-5">
          {items.map((l, j) => (
            <li key={j}>{inline(l)}</li>
          ))}
        </ul>
      ) : (
        <ol key={blocks.length} className="list-decimal space-y-1 pl-5">
          {items.map((l, j) => (
            <li key={j}>{inline(l)}</li>
          ))}
        </ol>
      ),
    );
    list = null;
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push(
        <h4 key={blocks.length} className="mt-3 text-sm font-semibold first:mt-0">
          {inline(h[2])}
        </h4>,
      );
      continue;
    }
    const b = line.match(/^[-*•]\s+(.*)$/);
    if (b) {
      if (!list || list.kind !== "ul") {
        flush();
        list = { kind: "ul", items: [] };
      }
      list.items.push(b[1]);
      continue;
    }
    const n = line.match(/^\d+[.)]\s+(.*)$/);
    if (n) {
      if (!list || list.kind !== "ol") {
        flush();
        list = { kind: "ol", items: [] };
      }
      list.items.push(n[1]);
      continue;
    }
    flush();
    blocks.push(
      <p key={blocks.length} className="break-words">
        {inline(line)}
      </p>,
    );
  }
  flush();
  return <div className={`space-y-2 text-sm text-ink-2 ${className}`}>{blocks}</div>;
}
