/**
 * The before-and-after reads the bot live before it renders: every agent's prompt and every bot field page, from Community
 * Loyalty. On Danno's bot (five agents, 24 Sep) that sat on a bare "Loading…" for over a minute, so the wait says what it is
 * waiting for, as the Brief's does. The time the read took is in the `[stage1.read]` log line as `readMs`.
 */
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" data-testid="bot-preview-loading">
      <div className="h-7 w-64 animate-pulse rounded-md bg-surface-2" />
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <span className="spinner" aria-hidden="true" /> Reading your bot from Community Loyalty… this can take a few seconds.
      </p>
    </div>
  );
}
