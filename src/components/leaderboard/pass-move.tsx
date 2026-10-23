import { SubmitButton } from "@/components/submit-button";
import type { schema } from "@/db";
import { makeSwitchLinkAction } from "@/lib/actions/pass-move";
import { linkWords } from "@/lib/engine/pass-move";
import { moveReady, passMoveCounts, switchPath } from "@/lib/pass-move";

/**
 * Moving this program's members to its new pass (H-1859, plan H-1861 approved in H-1868): the 2nd template above is the new
 * pass. The coach makes one member's private link by their email, a test member first; the counts show how many have moved
 * and whether every carried balance arrived whole. Nothing here sends anything to a member's pass.
 */
export async function PassMove({ feed, said, token }: { feed: schema.LeaderboardFeed; said?: string; token?: string }) {
  const ready = moveReady(feed);
  const words = linkWords(said);
  const n = await passMoveCounts(feed.id);
  return (
    <div className="basis-full mt-2 rounded border border-line p-2" id={`move-${feed.id}`} data-testid="pass-move">
      <p className="font-medium">Move members to the new pass</p>
      {ready ? (
        <form action={makeSwitchLinkAction} className="mt-1 flex flex-wrap items-center gap-2">
          <input type="hidden" name="feedId" value={feed.id} />
          <input className="field min-w-48 flex-1 py-1 text-xs" name="email" type="email" required placeholder="A test member's email (on the old pass)" aria-label="Member's email" data-testid="pass-move-email" />
          <SubmitButton className="btn btn-soft min-h-11" pendingText="Making the link…" data-testid="pass-move-link">
            Make their link
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-1 text-ink-3" data-testid="pass-move-notready">Needs a passed check, a passed points check, and the new pass&apos;s template as the 2nd template above.</p>
      )}
      {words ? (
        <p className={`mt-1 ${words.good ? "text-good" : "text-danger"}`} role="status" data-testid="pass-move-said">
          {words.text}
          {words.good && token ? (
            <>
              {" "}
              <a href={switchPath(token)} target="_blank" rel="noreferrer" className="break-all underline" data-testid="pass-move-url">
                {switchPath(token)}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <p className="mt-1 text-ink-3" data-testid="pass-move-counts">
        Links {n.links} · new passes {n.made} · points carried {n.carried}
        {n.waiting ? ` · waiting ${n.waiting}` : ""}
        {n.failed ? ` · failed ${n.failed}` : ""}
      </p>
      {n.mismatched ? (
        <p className="mt-1 text-danger" data-testid="pass-move-mismatch">
          {n.mismatched} carried balance{n.mismatched === 1 ? "" : "s"} didn&apos;t arrive whole. Look before moving anyone else.
        </p>
      ) : null}
      <p className="mt-1 text-ink-3">Nothing here sends to a member&apos;s old pass. Inviting everyone comes later, on Danno&apos;s OK.</p>
    </div>
  );
}
