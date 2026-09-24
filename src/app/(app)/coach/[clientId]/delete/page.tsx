import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { eraseMemberAction } from "@/lib/actions/erase";
import { planErase } from "@/lib/erase";
import { SubmitButton } from "@/components/submit-button";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Delete their data" };

/**
 * Deletion on request, for the coach only: what would go, counted table by table and object by object, before the button. The
 * button asks for the member's email typed back and cannot be undone. Nothing here deletes on a visit: the plan reads only.
 */
export default async function EraseMemberPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ error?: string }> }) {
  const v = await requireCoach();
  const { clientId } = await params;
  const sp = await searchParams;
  const plan = await planErase(v.workspace.id, clientId);
  if (!plan) notFound();
  const self = plan.userId === v.user.id;
  const rows = Object.entries(plan.counts).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b));
  const total = rows.reduce((a, [, n]) => a + n, 0);

  return (
    <>
      <PageHeader title={`Delete ${plan.name}'s data`} subtitle="On their request. Everything below goes for good, and it can't be undone." action={<Link href="/coach" className="btn btn-ghost btn-sm">Back</Link>} />
      {sp.error ? (
        <p className="mb-4 rounded-lg border border-danger bg-danger-soft p-2 text-sm font-medium" data-testid="erase-error" role="alert">
          {sp.error}
        </p>
      ) : null}
      <Card title="What would go" action={<span className="text-xs text-ink-3" data-testid="erase-total">{total} rows · {plan.objects.length} stored files</span>}>
        <p className="mb-3 text-sm text-ink-2">
          {plan.email}: their membership of this workspace and everything they made in it.{" "}
          {plan.userGoes ? "Their account goes too: they belong to no other workspace." : "Their account stays, because they belong to another workspace; only what they made here goes."}{" "}
          {plan.workspaceGoes ? "They are this workspace's last member, so the workspace goes with them." : ""}
        </p>
        <table className="w-full text-sm" data-testid="erase-plan">
          <tbody>
            {rows.map(([label, n]) => (
              <tr key={label} className="border-t" data-testid="erase-row" data-table={label}>
                <td className="py-1 pr-3 font-mono text-xs">{label}</td>
                <td className="py-1 text-right tabular" data-testid="erase-count">
                  {n}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {plan.objects.length ? (
          <details className="mt-3 text-xs" open>
            <summary className="cursor-pointer text-ink-2">Stored files ({plan.objects.length}), deleted before their rows</summary>
            <ul className="mt-1 space-y-0.5 font-mono text-ink-3" data-testid="erase-objects">
              {plan.objects.map((o) => (
                <li key={`${o.store}:${o.key}`} data-testid="erase-object">
                  {o.store === "proof" ? "private" : "public"} · {o.key}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>
      <Card className="mt-4" title="Delete for good">
        {self ? (
          <p className="text-sm text-ink-2" data-testid="erase-self">You can&apos;t delete your own account from here.</p>
        ) : (
          <form action={eraseMemberAction} className="space-y-2">
            <input type="hidden" name="membershipId" value={clientId} />
            <label className="block text-sm">
              Type <span className="font-mono">{plan.email}</span> to confirm
              <input className="field mt-1" name="email" type="email" autoComplete="off" required data-testid="erase-email" />
            </label>
            <SubmitButton className="btn btn-danger btn-sm" pendingText="Deleting…" data-testid="erase-submit">
              Delete everything listed above
            </SubmitButton>
            <p className="text-xs text-ink-3">One audit row is kept: who ran it, their email, when, and the counts. No content.</p>
          </form>
        )}
      </Card>
    </>
  );
}
