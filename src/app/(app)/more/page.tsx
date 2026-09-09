import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { NAV_GROUPS } from "@/components/nav-groups";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "More" };

export default async function MorePage() {
  const v = await requireViewer();
  return (
    <>
      <PageHeader title="Everything" />
      <div className="space-y-4">
        {NAV_GROUPS.map((g) => (
          <div key={g.label} className="card p-2">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2">{g.label}</div>
            {g.items
              .filter((n) => (!n.coachOnly || v.role === "coach") && (!n.passOnly || v.membership.passEnabled))
              .map((n) => (
                <Link key={n.href} href={n.href} className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-surface-2">
                  <span className="w-6 text-center text-lg">{n.icon}</span>
                  <span className="font-medium">{n.label}</span>
                  {n.line ?? n.hint ? <span className="ml-auto text-xs text-ink-3">{n.line ?? n.hint}</span> : null}
                </Link>
              ))}
          </div>
        ))}
        <div className="card p-2">
          <Link href="/settings" className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-surface-2">
            <span className="w-6 text-center text-lg">⚙️</span> Settings
          </Link>
          <form action={logoutAction}>
            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-surface-2" type="submit">
              <span className="w-6 text-center text-lg">🚪</span> Log out
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
