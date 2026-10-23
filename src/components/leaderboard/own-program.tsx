import type { schema } from "@/db";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DeskSettings } from "@/components/leaderboard/desk-settings";
import { checkLeaderboardAction, saveLeaderboardAction, setIssuePassesAction } from "@/lib/actions/leaderboard";
import { sendPassMessageAction, setInvitesAction, setSyncModeAction } from "@/lib/actions/points-sync";
import { PASS_MESSAGE_DEFAULT, PASS_MESSAGE_MAX, passMessageWords } from "@/lib/engine/pass-message";
import { fixMyPassAction, setNameFixAction } from "@/lib/actions/pass-fix";
import { fixWords } from "@/lib/engine/pass-fix";
import { INVITES, INVITE_KEYS } from "@/lib/engine/points-sync";

/**
 * The coach's own program on Coach (H-622): the Evolve Omega pass. The same connection as a client's loyalty program (the
 * sealed eLoyalty key, shown by its last four, the host and the pass template), the "Issue passes" switch that opens
 * "Get my pass" to clients, the coach's own pass, and the Points desk's settings for the add-and-deduct check.
 */
export function OwnProgramCard({ membershipId, feed, ownPass, passMessage, passFix }: { membershipId: string; feed: schema.LeaderboardFeed | null; ownPass: { made: boolean; installed: boolean; addressed?: boolean; lastMessageAt?: string | null }; passMessage?: string; passFix?: string }) {
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
          Your own pass: {ownPass.installed ? "in your wallet." : ownPass.made ? "made; add it to your wallet on Rewards." : ready ? "not made yet. Make it on Rewards with Get my pass (your test comes first)." : "connect the program and its template first."}
        </p>
        {/* H-1794: the way to the pass is a button, never a tiny link (Danno couldn't find it on his phone). */}
        <a href="/rewards#eo-pass" className="btn btn-ghost btn-sm mt-2 min-h-11" data-testid="own-pass-open-rewards">
          Open Rewards →
        </a>
        {feed && ready && ownPass.addressed ? <PassMessage lastMessageAt={ownPass.lastMessageAt ?? null} outcome={passMessage} /> : null}
        {feed && ready && ownPass.addressed ? <PassFix feed={feed} outcome={passFix} /> : null}
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
        {feed ? <SyncSettings feed={feed} ready={ready} /> : null}
        {feed?.keyEncrypted ? <DeskSettings feed={feed} ownPass={ownPass.made} /> : null}
      </div>
    </Card>
  );
}

const MODE_WORDS = { off: "Off", own: "Your own pass only (the test first)", all: "Everyone with a pass" } as const;
const RUNG_WORDS = { academy: "Academy call (Accelerator members at Sentinel)", elite: "Elite call (Academy members at Centurion)", lux: "Lux Partnership Conversation (anyone at Olympian)" } as const;

/**
 * The points sync and the invitations (H-867 parts 3 and 4): both off until the coach turns them on, the coach's own pass
 * first. The sync sends HelixOS points (an opening move, then one move per new ledger row) and the Level; eLoyalty sets the
 * rank from the points (H-890). An invitation is written once, only when its rung has a booking link.
 */
function SyncSettings({ feed, ready }: { feed: schema.LeaderboardFeed; ready: boolean }) {
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3" data-testid="own-sync">
      <form action={setSyncModeAction} className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          Sync points to the pass:
          <select name="syncMode" defaultValue={feed.syncMode} disabled={!ready} className="field py-1 text-xs" data-testid="own-sync-mode">
            {(["off", "own", "all"] as const).map((m) => (
              <option key={m} value={m}>
                {MODE_WORDS[m]}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" disabled={!ready} data-testid="own-sync-save">
          Save
        </SubmitButton>
        <span className="basis-full text-ink-3">
          Each member&apos;s HelixOS points so far go as one move, then each new award or spend as its own move, through the points outbox. Their level goes on the back of the pass. eLoyalty sets the rank from the points.
        </span>
      </form>
      <form action={setInvitesAction} className="space-y-2">
        <label className="flex flex-wrap items-center gap-2">
          Invitations on the pass:
          <select name="inviteMode" defaultValue={feed.inviteMode} disabled={!ready} className="field py-1 text-xs" data-testid="own-invite-mode">
            {(["off", "own", "all"] as const).map((m) => (
              <option key={m} value={m}>
                {MODE_WORDS[m]}
              </option>
            ))}
          </select>
        </label>
        {INVITE_KEYS.map((k) => (
          <label key={k} className="block">
            <span className="text-ink-3">
              {RUNG_WORDS[k]}: &quot;{INVITES[k].text}&quot;
            </span>
            <input className="field mt-1 w-full py-1 text-xs" type="url" pattern="https://.*" name={`link_${k}`} defaultValue={feed.inviteLinks[k] ?? ""} placeholder="https:// booking link (blank: this invitation is not sent)" aria-label={`${RUNG_WORDS[k]} booking link`} data-testid={`own-invite-${k}`} />
          </label>
        ))}
        <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" disabled={!ready} data-testid="own-invite-save">
          Save invitations
        </SubmitButton>
        <p className="text-ink-3">Each invitation goes once per member, never to someone already on that program or above.</p>
      </form>
    </div>
  );
}

/**
 * Step D (H-734): one Latest Message on the coach's own pass, sent only when the coach presses Send. Shown once the pass
 * exists (it is addressed by its serial), never for a client's pass.
 */
function PassMessage({ lastMessageAt, outcome }: { lastMessageAt: string | null; outcome?: string }) {
  const said = passMessageWords(outcome);
  return (
    <form action={sendPassMessageAction} className="mt-2 flex flex-wrap items-center gap-1" data-testid="own-message">
      <span>Message on your own pass:</span>
      <input className="field min-w-40 flex-1 py-1 text-xs" name="message" defaultValue={PASS_MESSAGE_DEFAULT} maxLength={PASS_MESSAGE_MAX} required aria-label="Message on your own pass" data-testid="own-message-text" />
      <SubmitButton className="btn btn-ghost btn-xs" pendingText="Sending…" data-testid="own-message-send">
        Send to my pass
      </SubmitButton>
      <span className="w-full text-ink-3">Writes the Latest Message on your pass only, once per press. Your phone shows it on the lock screen.{lastMessageAt ? ` Last sent ${lastMessageAt.slice(0, 16).replace("T", " ")} UTC.` : ""}</span>
      {said ? (
        <span className={`w-full ${said.good ? "text-good" : "text-danger"}`} role="status" data-testid="own-message-result">
          {said.text}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Fix my pass (H-1699, plan H-1701): rewrite the name on the coach's own pass from HelixOS, then tick "Names update in place" once
 * it shows on the phone. Until that tick, "Fix this pass" on clients' rows stays shut and names are never fixed on a change.
 */
function PassFix({ feed, outcome }: { feed: schema.LeaderboardFeed; outcome?: string }) {
  const said = fixWords(outcome);
  return (
    <div className="mt-2 text-xs" data-testid="own-pass-fix">
      <form action={fixMyPassAction} className="flex flex-wrap items-center gap-1">
        <SubmitButton className="btn btn-ghost btn-xs" pendingText="Fixing…" data-testid="own-pass-fix-run">
          Fix my pass
        </SubmitButton>
        <span className="text-ink-3">Writes your name, as it is in HelixOS, onto your pass. Nothing else.</span>
      </form>
      {said ? (
        <p className={`mt-1 ${said.good ? "text-good" : "text-danger"}`} data-testid="own-pass-fix-result">
          {said.text}
        </p>
      ) : null}
      <form action={setNameFixAction} className="mt-1 flex flex-wrap items-center gap-2">
        <label>
          <input type="checkbox" name="nameFixProven" defaultChecked={feed.nameFixProven} data-testid="name-fix-proven" /> Names update in place (my pass showed the fix)
        </label>
        <label className={feed.nameFixProven ? undefined : "text-ink-3"}>
          <input type="checkbox" name="fixNamesOnChange" defaultChecked={feed.fixNamesOnChange} disabled={!feed.nameFixProven} data-testid="fix-names-on-change" /> Fix a member&apos;s pass when they change their name
        </label>
        <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" data-testid="name-fix-save">
          Save
        </SubmitButton>
      </form>
    </div>
  );
}
