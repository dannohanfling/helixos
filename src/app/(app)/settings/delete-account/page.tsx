import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { planErase } from "@/lib/erase";
import { eraseMyAccountAction } from "@/lib/actions/account.delete";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Delete my account" };

/**
 * Settings → Account → Delete my account (H-331, what the app stores and /delete-account promise): what will go, counted from
 * the database now, the member's own email typed back, one button. The same erase the coach runs, for the member alone.
 */
export default async function DeleteAccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [v, { error }] = await Promise.all([requireViewer(), searchParams]);
  const plan = v.role === "client" && !v.switchedInto && !v.team ? await planErase(v.workspace.id, v.membership.id) : null;
  const rows = plan ? Object.entries(plan.counts).filter(([, n]) => n > 0) : [];
  const total = rows.reduce((a, [, n]) => a + n, 0);
  return (
    <>
      <PageHeader title="Delete my account" subtitle="Everything you made here goes, for good." />
      <div className="max-w-2xl space-y-4">
        {error ? (
          <p className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger" role="alert" data-testid="delete-account-error">
            {error}
          </p>
        ) : null}
        {v.role === "coach" ? (
          <Card>
            <p className="text-sm" data-testid="delete-account-coach">
              Your account runs this HelixOS, so it can&apos;t be deleted from here. Write to us from the <Link href="/support" className="underline">Support page</Link> and we will do it with you.
            </p>
          </Card>
        ) : v.switchedInto || v.team ? (
          <Card>
            <p className="text-sm" data-testid="delete-account-locked">Only the member can delete their own account.</p>
          </Card>
        ) : (
          <>
            <Card title="What gets deleted">
              <p className="text-sm text-ink-2">
                Your profile and sign-in, your work in HelixOS (lock-ins and close-outs, tasks, offers, avatars, ladders, logged DMs and calls, Board questions and answers, check-ins, your points, ranks and streaks), all HumanOS health data, the keys of every tool you connected, and your place in the Colosseum. It happens now, not in 30 days. If you want a copy first, <a href="/api/export?format=json" className="underline" download>download your data</a> before you confirm.
              </p>
              <p className="mt-3 text-xs text-ink-3" data-testid="delete-account-count">
                {total.toLocaleString()} records across {rows.length} tables, counted now.
              </p>
              <p className="mt-2 text-xs text-ink-3">Deleting your HelixOS account does not cancel your coaching program or your Evolve Omega community account. See <Link href="/delete-account" className="underline">Delete your account</Link> for the full picture.</p>
            </Card>
            <Card title="Confirm">
              <form action={eraseMyAccountAction} className="space-y-3" data-testid="delete-account-form">
                <label className="block text-sm">
                  <span className="font-medium">Type your email to confirm</span>
                  <input name="email" type="email" autoComplete="off" required className="field mt-1" placeholder={v.user.email} data-testid="delete-account-email" />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <SubmitButton className="btn btn-danger" pendingText="Deleting…" data-testid="delete-account-submit">
                    Delete my account
                  </SubmitButton>
                  <Link href="/settings?tab=data#account" className="text-sm underline">
                    Keep my account
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
