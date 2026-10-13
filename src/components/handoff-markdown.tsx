/**
 * An agent's markdown, shown safely (rev 769 §6): read into plain blocks by the engine and rendered as React text, so nothing
 * in a body is ever HTML. No remote images (a picture shows as its address), and every link shows its full address beside it.
 */
import { markdownBlocks, type Inline } from "@/lib/engine/handoff";

function Parts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.t === "b") return <strong key={i}>{p.text}</strong>;
        if (p.t === "i") return <em key={i}>{p.text}</em>;
        if (p.t === "code") return <code key={i} className="rounded bg-surface-2 px-1 text-[0.9em]">{p.text}</code>;
        if (p.t === "image") return <span key={i} className="text-ink-3">{p.text}</span>;
        if (p.t === "link")
          return p.href ? (
            <span key={i}>
              {p.text !== p.href ? `${p.text} ` : ""}
              <a href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline">
                {p.href}
              </a>
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          );
        return <span key={i}>{p.text}</span>;
      })}
    </>
  );
}

export function HandoffMarkdown({ text }: { text: string }) {
  const blocks = markdownBlocks(text);
  return (
    <div className="space-y-2 text-sm [overflow-wrap:anywhere]" data-testid="handoff-body">
      {blocks.map((b, i) => {
        if (b.t === "h") return <p key={i} className={b.level === 1 ? "text-base font-semibold" : "font-semibold"}><Parts parts={b.parts} /></p>;
        if (b.t === "code") return <pre key={i} className="overflow-x-auto rounded bg-surface-2 p-2 text-xs">{b.text}</pre>;
        if (b.t === "quote") return <blockquote key={i} className="border-l-2 pl-3 text-ink-2"><Parts parts={b.parts} /></blockquote>;
        if (b.t === "p") return <p key={i}><Parts parts={b.parts} /></p>;
        const List = b.t === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`${b.t === "ul" ? "list-disc" : "list-decimal"} space-y-1 pl-5`}>
            {b.items.map((it, j) => (
              <li key={j}><Parts parts={it} /></li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
