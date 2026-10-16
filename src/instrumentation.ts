import type { Instrumentation } from "next";
import * as Sentry from "@sentry/nextjs";
import { scrubEvent, type ErrorEventLike } from "@/lib/engine/scrub";

/**
 * Error alerts (H-349 §2): Sentry on the server, only where SENTRY_DSN is set (Danno adds it in Vercel for Production and
 * Preview). No personal data (the SDK sends none unless asked, and we never ask) and a scrub on every event before it leaves (src/lib/engine/scrub.ts); no tracing,
 * no replays, no breadcrumbs of requests. Next hands every server error to onRequestError; jobs that catch their own
 * errors call reportError (src/lib/report-error.ts).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    tracesSampleRate: 0,
    maxBreadcrumbs: 20,
    beforeSend: (event) => scrubEvent(event as unknown as ErrorEventLike) as unknown as typeof event,
    // No http breadcrumbs: a URL can carry an id or a token; the stack and the job tag are what matter.
    beforeBreadcrumb: (crumb) => (crumb.category === "http" || crumb.category === "fetch" ? null : crumb),
  });
}

export const onRequestError: Instrumentation.onRequestError = (...args) => {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureRequestError(...args);
};
