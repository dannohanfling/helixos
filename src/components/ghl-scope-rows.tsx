"use client";

import { useState } from "react";
import type { GhlScope } from "@/lib/engine/ghl-scopes";
import { ONE_AT_A_TIME, pickerName, scopeList } from "@/lib/engine/ghl-scopes";
import { CopyButton } from "@/components/copy-button";

/**
 * The permission list as rows (H-233, H-294): GoHighLevel's picker takes permissions one at a time and its search box matches
 * the scope id, so one line says so, and each row carries the readable name, the scope id in monospace, its own Copy (the id
 * alone, exactly as GoHighLevel spells it, nothing else) and a tick box the member ticks as they add it ("3 of 21 added").
 * "Copy the list" puts every id on the clipboard, one a line. The ticks live in the page alone: nothing is saved, and nothing
 * is checked against GoHighLevel until Connect. The rows read the one canonical list; no scope name is written here.
 */
export function GhlScopeRows({ scopes }: { scopes: GhlScope[] }) {
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const done = scopes.filter((s) => added[s.scope]).length;
  return (
    <div className="mt-3" data-testid="ghl-scope-rows">
      <p className="text-xs text-ink-2">{ONE_AT_A_TIME}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span data-testid="ghl-scope-count" data-done={done}>
          {done} of {scopes.length} added. {scopes.length} permissions, nothing else.
        </span>
        <CopyButton text={scopeList(scopes)} label="Copy the list" doneLabel={`Copied ${scopes.length} ids`} className="btn btn-ghost btn-xs" doneMs={2000} testId="ghl-scope-copy-list" />
      </p>
      <ul className="mt-2 divide-y rounded-lg border bg-surface" data-testid="ghl-scope-list">
        {scopes.map((s) => (
          <li key={s.scope} className="flex items-center gap-2 px-2 py-1 text-xs" data-scope={s.scope}>
            <input
              type="checkbox"
              className="shrink-0"
              checked={Boolean(added[s.scope])}
              onChange={(e) => setAdded((a) => ({ ...a, [s.scope]: e.target.checked }))}
              aria-label={`Added ${pickerName(s)}`}
              data-testid="ghl-scope-tick"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{pickerName(s)}</span>
              <code className="ml-2 break-all text-[11px] text-ink-2" data-testid="ghl-scope-id">
                {s.scope}
              </code>
            </span>
            <CopyButton text={s.scope} label="Copy" doneLabel={`Copied ${s.scope}`} className="btn btn-ghost btn-xs shrink-0" doneMs={2000} testId="ghl-scope-copy" />
          </li>
        ))}
      </ul>
    </div>
  );
}
