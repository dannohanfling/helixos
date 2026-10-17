import type { schema } from "@/db";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";
import { Card } from "@/components/ui";
import { saveLeaderboardExportAction, saveLeaderboardHiddenAction, saveLeaderboardPageAction, saveLeaderboardSlugAction } from "@/lib/actions/leaderboard";
import { MAX_REWARDS, MAX_TIERS, readPageConfig, rewardsText, tiersText } from "@/lib/engine/leaderboard";

/**
 * The hosted leaderboard's editor (H-28, H-33), on /loyalty: the page's copy, the pass link, tiers and rewards (with their
 * Sample marks), the zero rule, the pasted export and a preview of the page as it is saved. The owner, their team and their
 * coach may edit the page; the hide list is the owner's and the coach's alone. The eLoyalty key is set on the coach's own
 * page and is nowhere here.
 */
export function LeaderboardEditor({ feed, base, canHide, exportRows, aliases = [], slugError, slugChanged = false }: { feed: schema.LeaderboardFeed; base: string; canHide: boolean; exportRows: number | null; aliases?: string[]; slugError?: string | null; slugChanged?: boolean }) {
  const c = readPageConfig(feed.pageJson);
  const pageUrl = `${base}/lb/${feed.slug}`;
  const feedUrl = `${base}/api/public/leaderboard/${feed.slug}`;
  const connected = Boolean(feed.keyEncrypted);
  return (
    <>
      <Card id="leaderboard" title="Your leaderboard page" className="mb-4">
        <p className="text-sm" data-testid="leaderboard-state">
          Live connection: <strong>{connected ? "connected" : "not connected"}</strong>
          {!connected && exportRows ? <span className="text-ink-3"> · showing your pasted export ({exportRows} members)</span> : null}
          {!connected && !exportRows ? <span className="text-ink-3"> · showing sample members until an export is pasted or your coach connects it</span> : null}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-3">Page</span>
          <a href={pageUrl} target="_blank" rel="noreferrer" className="min-w-0 break-all rounded bg-surface-2 px-2 py-1 underline" data-testid="leaderboard-page-link">
            {pageUrl}
          </a>
          <CopyButton text={pageUrl} label="Copy" className="btn btn-ghost btn-xs" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-3">Feed</span>
          <code className="min-w-0 break-all rounded bg-surface-2 px-2 py-1" data-testid="leaderboard-feed-link">
            {feedUrl}
          </code>
          <CopyButton text={feedUrl} label="Copy" className="btn btn-ghost btn-xs" />
        </div>
        <p className="mt-2 text-xs text-ink-3">Share the page link, or put it in your own site as an iframe. Members show as first name and last initial, with their points and tier, nothing else.</p>
        <form action={saveLeaderboardSlugAction} className="mt-3 space-y-1" id="address" data-testid="leaderboard-slug-form">
          <label className="label" htmlFor="leaderboard-slug">
            Page address
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-3">{base}/lb/</span>
            <input id="leaderboard-slug" className="field w-64 font-mono text-xs" name="slug" defaultValue={feed.slug} minLength={3} maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" required aria-invalid={slugError ? true : undefined} data-testid="lb-slug" />
            <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="lb-slug-save">
              Change address
            </SubmitButton>
          </div>
          {slugError ? (
            <p className="text-xs text-danger" data-testid="lb-slug-error">
              {slugError}
            </p>
          ) : slugChanged ? (
            <p className="text-xs text-good" data-testid="lb-slug-changed">
              Address changed. The old one redirects here.
            </p>
          ) : null}
          <p className="text-xs text-ink-3">
            Lowercase letters, numbers and hyphens, 3 to 40 characters, unlike any other board&apos;s.{aliases.length ? ` Earlier addresses still work and redirect here: ${aliases.map((a) => `/lb/${a}`).join(", ")}.` : ""}
          </p>
        </form>
        <details className="mt-3 text-xs" data-testid="leaderboard-embed">
          <summary className="cursor-pointer text-ink-3">Embed code</summary>
          <code className="mt-1 block break-all rounded bg-surface-2 px-2 py-1">{`<iframe src="${pageUrl}" style="width:100%;min-height:1200px;border:0;background:#000" title="Leaderboard" loading="lazy"></iframe>`}</code>
        </details>
      </Card>

      <Card title="Words, tiers and rewards" className="mb-4">
        <form action={saveLeaderboardPageAction} className="space-y-3" data-testid="leaderboard-page-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Eyebrow</span>
              <input className="field" name="eyebrow" defaultValue={c.eyebrow} maxLength={80} data-testid="lb-eyebrow" />
            </label>
            <label className="block">
              <span className="label">Headline</span>
              <input className="field" name="headline" defaultValue={c.headline} maxLength={80} required data-testid="lb-headline" />
            </label>
            <label className="block">
              <span className="label">Word in italics (inside the headline)</span>
              <input className="field" name="headlineEm" defaultValue={c.headlineEm} maxLength={40} />
            </label>
            <label className="block">
              <span className="label">What a point is called</span>
              <input className="field" name="unit" defaultValue={c.unit} maxLength={12} data-testid="lb-unit" />
            </label>
          </div>
          <label className="block">
            <span className="label">Quote</span>
            <input className="field" name="quote" defaultValue={c.quote} maxLength={200} />
          </label>
          <label className="block">
            <span className="label">Intro line</span>
            <textarea className="field min-h-16" name="intro" defaultValue={c.intro} maxLength={400} />
          </label>
          <label className="block">
            <span className="label">&quot;Get your pass&quot; link (https)</span>
            <input className="field" name="passUrl" type="url" defaultValue={c.passUrl} placeholder="https://…" data-testid="lb-pass-url" />
            <span className="mt-1 block text-xs text-ink-3">Your program&apos;s public join link, the one anyone may open. Never a member&apos;s own pass.</span>
          </label>
          <label className="block">
            <span className="label">Footer</span>
            <input className="field" name="footer" defaultValue={c.footer} maxLength={160} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Tiers: name, lifetime points to reach it, and what it brings if you like (one per line, up to {MAX_TIERS})</span>
              <textarea className="field min-h-40 font-mono text-xs" name="tiers" defaultValue={tiersText(c.tiers)} data-testid="lb-tiers" />
              <span className="mt-1 flex items-center gap-2 text-xs">
                <input type="checkbox" name="tiersSample" defaultChecked={c.tiersSample} data-testid="lb-tiers-sample" /> Still sample tiers (shown as such until yours are confirmed)
              </span>
            </label>
            <label className="block">
              <span className="label">Rewards: name | points | one line (one per line, up to {MAX_REWARDS})</span>
              <textarea className="field min-h-40 font-mono text-xs" name="rewards" defaultValue={rewardsText(c.rewards)} data-testid="lb-rewards" />
              <span className="mt-1 flex items-center gap-2 text-xs">
                <input type="checkbox" name="rewardsSample" defaultChecked={c.rewardsSample} data-testid="lb-rewards-sample" /> Still sample costs (the page says &quot;to confirm&quot;)
              </span>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="showZero" defaultChecked={c.showZero} data-testid="lb-show-zero" /> Show members with 0 points
          </label>
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="lb-save">
            Save page
          </SubmitButton>
        </form>
      </Card>

      <Card title="Before the connection: paste an export" className="mb-4">
        <form action={saveLeaderboardExportAction} className="space-y-2" data-testid="leaderboard-export-form">
          <p className="text-xs text-ink-3">
            Paste your program&apos;s Points &amp; Transactions export (first line: column names, such as First Name, Last Name, Lifetime, Available). It&apos;s read here and now; only first names, last initials and points are kept. Emails, phones and ids in it are thrown away before anything is saved.
            {exportRows ? ` ${exportRows} members are saved from the last paste${feed.exportAsOf ? `, as of ${feed.exportAsOf}` : ""}.` : ""}
          </p>
          <textarea className="field min-h-32 font-mono text-xs" name="export" placeholder="First Name,Last Name,Lifetime KK,Available KK" data-testid="lb-export" />
          <div className="flex flex-wrap items-center gap-2">
            <input className="field w-40" name="asOf" placeholder="As of (e.g. 13 Oct 2026)" defaultValue={feed.exportAsOf ?? ""} maxLength={40} data-testid="lb-export-as-of" />
            <SubmitButton className="btn btn-soft btn-sm" pendingText="Reading…" data-testid="lb-export-save">
              Save export
            </SubmitButton>
            <span className="text-xs text-ink-3">An empty paste clears the saved export.</span>
          </div>
        </form>
      </Card>

      <Card title="Hide from the board" className="mb-4">
        <form action={saveLeaderboardHiddenAction} className="space-y-2" data-testid="leaderboard-hide-form">
          <label className="label" htmlFor="leaderboard-hidden">
            One eLoyalty customer id per line
          </label>
          <textarea id="leaderboard-hidden" name="hidden" className="field min-h-20 font-mono text-xs" defaultValue={feed.hidden.join("\n")} disabled={!canHide} data-testid="leaderboard-hidden" />
          {canHide ? (
            <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="leaderboard-hide-save">
              Save hide list
            </SubmitButton>
          ) : (
            <p className="text-xs text-ink-3">Only the account owner and their coach can change this.</p>
          )}
        </form>
      </Card>

      <Card title="Preview" className="mb-4">
        <p className="mb-2 text-xs text-ink-3">The page as it is saved. Save above, then it reloads here.</p>
        <iframe src={pageUrl} title="Leaderboard preview" className="h-[720px] w-full rounded border border-line bg-black" data-testid="leaderboard-preview" />
      </Card>
    </>
  );
}
