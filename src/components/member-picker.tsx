"use client";

import { useState } from "react";

/**
 * Named members for a recording (rev 488): a search box over the workspace's members instead of a long list, the members on the
 * call ticked and shown first. Every member stays in the form (hidden when the search leaves them out), so a tick is never lost.
 */
export function MemberPicker({ members, ticked, onCall }: { members: { userId: string; name: string }[]; ticked: string[]; onCall: string[] }) {
  const [q, setQ] = useState("");
  const order = [...members].sort((a, b) => Number(onCall.includes(b.userId)) - Number(onCall.includes(a.userId)) || a.name.localeCompare(b.name));
  const match = (name: string) => !q.trim() || name.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <div className="space-y-2">
      <input type="search" className="field py-1 text-sm" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" data-testid="member-search" />
      <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2" data-testid="recording-member-picks">
        {order.map((m) => (
          <label key={m.userId} className={`flex items-center gap-2 text-xs ${match(m.name) ? "" : "hidden"}`}>
            <input type="checkbox" name="members" value={m.userId} defaultChecked={ticked.includes(m.userId)} data-testid="recording-member" data-on-call={onCall.includes(m.userId) ? "1" : "0"} /> {m.name}
            {onCall.includes(m.userId) ? <span className="text-ink-3">(on the call)</span> : null}
          </label>
        ))}
      </div>
    </div>
  );
}
