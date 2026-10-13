"use client";

/**
 * The Forum's small live parts: the "… ago" stamp that keeps counting and a quiet refresh every minute while the page is in
 * view (reports land server-side; the page reads them again), and the "Add an agent" form.
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { addForumAgentAction, type ForumFormState } from "@/lib/actions/forum";
import { forumAgo } from "@/lib/engine/forum";

export function ForumLive({ updatedAt }: { updatedAt: string | null }) {
  const router = useRouter();
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1);
      if (!document.hidden) router.refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [router]);
  return <span data-testid="forum-ago">{updatedAt ? forumAgo(updatedAt) : ""}</span>;
}

/** A new agent takes the lowest free plot (Danno, 13 Oct); the member swaps plots on the map. */
export function ForumAddAgent({ platforms, agentsHref }: { platforms: readonly string[]; agentsHref?: string }) {
  const [state, action] = useActionState<ForumFormState, FormData>(addForumAgentAction, null);
  const [platform, setPlatform] = useState(platforms[0]);
  return (
    <form action={action} className="fo-form" data-testid="forum-add">
      <label>
        <span>Name</span>
        <input name="name" required maxLength={40} placeholder="Main, Booking bot, Researcher…" data-testid="forum-add-name" />
      </label>
      <label>
        <span>Platform</span>
        <select name="platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {[...platforms, "Other"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      {platform === "Other" ? (
        <label>
          <span>Which platform</span>
          <input name="platformOther" maxLength={40} />
        </label>
      ) : null}
      <label>
        <span>Role</span>
        <input name="role" maxLength={80} placeholder="What it does, in a few words" />
      </label>
      <label>
        <span>Link (optional)</span>
        <input name="link" type="url" maxLength={300} placeholder="https://… its repo, dashboard or chat" />
      </label>
      <div className="fo-formrow">
        <SubmitButton className="fo-btn fo-primary" pendingText="Adding…" data-testid="forum-add-go">
          Add the agent
        </SubmitButton>
        {state?.error ? (
          <span role="alert" className="fo-err">
            {state.error}
          </span>
        ) : state?.ok ? (
          <span role="status" className="fo-ok" data-testid="forum-add-ok">
            {state.ok}
            {agentsHref ? (
              <>
                {" "}
                <a href={`${agentsHref}${state.agentId ? `#agent-${state.agentId}` : ""}`} data-testid="forum-add-next">
                  Next: connect it on the Agents page →
                </a>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    </form>
  );
}
