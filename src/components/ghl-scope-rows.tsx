"use client";

import { useState } from "react";
import type { GhlScope } from "@/lib/engine/ghl-scopes";
import { ONE_AT_A_TIME, pickerName, searchText } from "@/lib/engine/ghl-scopes";
import { CopyButton } from "@/components/copy-button";

/**
 * The permission list as rows (H-233): GoHighLevel's picker takes permissions one at a time, so one line says so, and each row
 * carries the name as the picker shows it, the text to paste into its search box, its own Copy button, and a tick box the member
 * ticks as they add it ("3 of 21 added"). The ticks live in the page alone: nothing is saved, and nothing is checked against
 * GoHighLevel until Connect. The rows read the one canonical list; no scope name is written here.
 */
export function GhlScopeRows({ scopes }: { scopes: GhlScope[] }) {
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const done = scopes.filter((s) => added[s.scope]).length;
  return (
    <div className="mt-3" data-testid="ghl-scope-rows">
      <p className="text-xs text-ink-2">{ONE_AT_A_TIME}</p>
      <p className="mt-1 text-xs text-ink-3" data-testid="ghl-scope-count" data-done={done}>
        {done} of {scopes.length} added. {scopes.length} permissions, nothing else.
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
              <span className="block text-ink-3">
                search for <span data-testid="ghl-scope-search">{searchText(s)}</span> · <code className="text-[11px]">{s.scope}</code>
              </span>
            </span>
            <CopyButton text={searchText(s)} label="Copy" className="btn btn-ghost btn-xs shrink-0" doneMs={2000} />
          </li>
        ))}
      </ul>
    </div>
  );
}
