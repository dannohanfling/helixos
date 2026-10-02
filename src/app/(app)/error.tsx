"use client";

import { useEffect } from "react";

/**
 * Something failed while a page was showing or a form was being saved (3 Oct): the menu stays, the member is told plainly that
 * what they were typing is kept in this browser, and Reload brings the page back with it (the form's own draft restores it,
 * saying the last save didn't go through). Never a blank screen, never the framework's own words.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[app] page error", JSON.stringify({ message: error.message.slice(0, 300), digest: error.digest ?? null }));
  }, [error]);
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center" data-testid="app-error">
      <p className="text-lg font-semibold">Something went wrong on our side.</p>
      <p className="mt-2 text-sm text-ink-2">Anything you were typing in a form is kept in this browser. Reload and it comes back, ready to save again.</p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" data-testid="app-error-reload" onClick={() => window.location.reload()}>
          Reload
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => retry()}>
          Try again without reloading
        </button>
      </div>
    </div>
  );
}
