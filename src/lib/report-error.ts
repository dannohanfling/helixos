import * as Sentry from "@sentry/nextjs";

/**
 * A failure worth telling Danno about (H-349 §2): a cron, a webhook or a job that caught its own error. The log line carries
 * the cause's name and the job, never a member's words; Sentry (when SENTRY_DSN is set) gets the exception tagged by job,
 * so one failing job is one issue and one email, not a flood. Without a DSN this is the log line alone.
 */
export function reportError(e: unknown, tags: { job: string } & Record<string, string>): void {
  const name = e instanceof Error ? e.name : "error";
  console.error(`[${tags.job}] failed`, JSON.stringify({ ...tags, cause: name }));
  if (!process.env.SENTRY_DSN) return;
  try {
    Sentry.captureException(e, { tags });
  } catch {
    // Reporting must never break the job that called it.
  }
}
