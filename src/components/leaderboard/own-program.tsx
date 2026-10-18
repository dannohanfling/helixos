import type { schema } from "@/db";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DeskSettings } from "@/components/leaderboard/desk-settings";
import { checkLeaderboardAction, saveLeaderboardAction, setIssuePassesAction } from "@/lib/actions/leaderboard";

/**
 * The coach's own program on Coach (H-622): the Evolve Omega pass. The same connection as a client's loyalty program (the
 * sealed eLoyalty key, shown by its last four, the host and the pass template), the "Issue passes" switch that opens
 * "Get my pass" to clients, the coach's own pass, and the Points desk's settings for the add-and-deduct check.
 */
export function OwnProgramCard({ membershipId, feed, ownPass }: { membershipId: string; feed: schema.LeaderboardFeed | null; ownPass: { made: boolean; installed: boolean } }) {
  const ready = Boolean(feed?.keyEncrypted && feed.templateId && feed.lastCheckOk);
  return (
    <Card className="mb-4" title="🎫 Your own program: the Evolve Omega pass" id="own-program">
      <div className="text-xs" data-testid="own-program">
        <p className="text-ink-3">Your program on eLoyalty, on its own template (pass.com.evolveomega). Members get their pass on Rewards with &quot;Get my pass&quot;, you first; clients once you switch passes on.</p>
        <form action={saveLeaderboardAction} className="mt-2 flex flex-wrap items-center gap-1">
          <input type="hidden" name="membershipId" value={membershipId} />
          <input className="field min-w-40 flex-1 py-1 text-xs" name="key" type="password" autoComplete="off" data-testid="own-key" placeholder={feed?.keyEncrypted ? `eLoyalty key: saved, ending ${feed.keyLast4}; paste a new one to replace it` : "Your eLoyalty API key (you type it)"} aria-label="eLoyalty key" />
          <input className="field w-52 py-1 text-xs" name="host" defaultValue={feed?.host ?? "https://www.eloyalty.ai"} aria-label="eLoyalty web address" data-testid="own-host" />
          <input className="field w-48 py-1 text-xs" name="templateId" defaultValue={feed?.templateId ?? ""} placeholder="Evolve Omega template id" aria-label="Evolve Omega template id" data-testid="own-template" />
          <SubmitButton className="btn btn-ghost btn-xs" pendingText="Checking…" data-testid="own-connect">
            Connect and check
          </SubmitButton>
        </form>
        {feed ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`min-w-0 flex-1 ${feed.lastCheckOk ? "text-good" : "text-ink-3"}`} data-testid="own-check">
              {feed.lastCheckNote ?? "Not checked yet."}
            </span>
            {feed.keyEncrypted ? (
              <form action={checkLeaderboardAction}>
                <input type="hidden" name="id" value={feed.id} />
                <SubmitButton className="btn btn-ghost btn-xs" pendingText="Checking…">Check again</SubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}
        <p className="mt-2" data-testid="own-pass">
          Your own pass: {ownPass.installed ? "in your wallet." : ownPass.made ? "made; add it to your wallet on Rewards." : ready ? "not made yet. Make it on Rewards with Get my pass (your test comes first)." : "connect the program and its template first."}{" "}
          <a href="/rewards#eo-pass" className="underline">
            Open Rewards →
          </a>
        </p>
        {feed ? (
          <form action={setIssuePassesAction} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={feed.id} />
            <label>
              <input type="checkbox" name="issuePasses" defaultChecked={feed.issuePasses} disabled={!ready} data-testid="own-issue" /> Issue passes to clients (they get &quot;Get my pass&quot; on Rewards)
            </label>
            <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" disabled={!ready} data-testid="own-issue-save">
              Save
            </SubmitButton>
            {!ready ? <span className="text-ink-3">Opens once the program is connected, checked and has its template.</span> : null}
          </form>
        ) : null}
        {feed?.keyEncrypted ? <DeskSettings feed={feed} /> : null}
      </div>
    </Card>
  );
}
