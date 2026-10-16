import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { planBodyErase } from "@/lib/erase";
import { eraseMyBodyAction } from "@/lib/actions/account.delete";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Delete my HumanOS data" };

/** Settings → Account → Delete my HumanOS data (H-331): only the health data goes; the rest of the account stays as it is. */
export default async function DeleteHumanosPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [v, { error }] = await Promise.all([requireViewer(), searchParams]);
  const locked = Boolean(v.switchedInto || v.team);
  const plan = locked ? null : await planBodyErase(v.workspace.id, v.user.id);
  const rows = plan ? Object.entries(plan.counts).filter(([, n]) => n > 0) : [];
  return (
    <>
      <PageHeader title="Delete my HumanOS data" subtitle="Only your health data. Everything else stays." />
      <div className="max-w-2xl space-y-4">
        {error ? (
          <p className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger" role="alert" data-testid="delete-humanos-error">
            {error}
          </p>
        ) : null}
        {locked ? (
          <Card>
            <p className="text-sm" data-testid="delete-humanos-locked">Only the member can delete their own HumanOS data.</p>
          </Card>
        ) : (
          <>
            <Card title="What gets deleted">
              <p className="text-sm text-ink-2">Food and meals, weigh-ins, training, sleep, practices and medications, notes, goals, the pantry and shopping lists, your WHOOP connection and its activities, and what you shared with your coach. Your account, points, tasks and everything outside HumanOS stay as they are. HumanOS itself stays switched {v.membership.bodyEnabled ? "on, empty" : "off"}.</p>
              <p className="mt-3 text-xs text-ink-3" data-testid="delete-humanos-count">
                {(plan?.total ?? 0).toLocaleString()} records across {rows.length} tables, counted now.
              </p>
            </Card>
            <Card title="Confirm">
              <form action={eraseMyBodyAction} className="space-y-3" data-testid="delete-humanos-form">
                <label className="block text-sm">
                  <span className="font-medium">Type your email to confirm</span>
                  <input name="email" type="email" autoComplete="off" required className="field mt-1" placeholder={v.user.email} data-testid="delete-humanos-email" />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <SubmitButton className="btn btn-danger" pendingText="Deleting…" data-testid="delete-humanos-submit">
                    Delete my HumanOS data
                  </SubmitButton>
                  <Link href="/settings#account" className="text-sm underline">
                    Keep it
                  </Link>
                </div>
              </form>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
