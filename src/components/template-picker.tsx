"use client";

import { useMemo, useState } from "react";

export type TemplateLite = { id: string; name: string; sequence: string; step: number; branch: string | null; body: string; whenToSend: string | null };

/** Fills a message textarea from a DM template, swapping [Name] and friends for real values. */
export function TemplatePicker({
  templates,
  values,
  name = "body",
  placeholder = "Write the message you sent (or paste it)…",
  defaultValue = "",
}: {
  templates: TemplateLite[];
  values: Record<string, string>;
  name?: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  const [text, setText] = useState(defaultValue);
  const [templateId, setTemplateId] = useState("");
  const grouped = useMemo(() => {
    const m = new Map<string, TemplateLite[]>();
    for (const t of templates) m.set(t.sequence, [...(m.get(t.sequence) ?? []), t]);
    return [...m.entries()];
  }, [templates]);
  const chosen = templates.find((t) => t.id === templateId);

  function apply(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    let body = t.body;
    for (const [k, val] of Object.entries(values)) body = body.split(`[${k}]`).join(val || `[${k}]`);
    setText(body);
  }

  return (
    <div className="space-y-2">
      <select className="field" value={templateId} onChange={(e) => apply(e.target.value)} aria-label="Start from a template">
        <option value="">Start from a template…</option>
        {grouped.map(([seq, list]) => (
          <optgroup key={seq} label={seq}>
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.step}. {t.name.replace(`${seq} — `, "")}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {chosen?.whenToSend ? <p className="text-xs text-ink-3">When: {chosen.whenToSend}</p> : null}
      <input type="hidden" name="templateId" value={templateId} />
      <textarea className="field min-h-28" name={name} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
