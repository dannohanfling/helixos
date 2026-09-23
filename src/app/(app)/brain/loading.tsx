/**
 * The Brief reads the bot live before it renders (its agents, their prompts and every bot field, from Community Loyalty), which
 * took about 20 seconds on Danno's bot on 23 Sep. So the wait says what it is waiting for. The time each read took is in the
 * `[faq.agent-reads]` log line as `readMs`.
 */
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" data-testid="brain-loading">
      <div className="h-7 w-48 animate-pulse rounded-md bg-surface-2" />
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <span className="spinner" aria-hidden="true" /> Reading your bot from Community Loyalty… this can take a few seconds.
      </p>
    </div>
  );
}
