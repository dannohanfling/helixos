import { requireViewer } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { WHATS_NEW } from "@/content/whats-new";
import { byWeek, unseenCount, visibleEntries } from "@/lib/engine/whats-new";
import { formatDate } from "@/lib/dates";
import { APP_VERSION } from "@/lib/version";
import { WhatsNewSeen } from "@/components/whats-new-seen";

export const metadata = { title: "What's new" };

/**
 * What's new (rev 193): what changed in HelixOS, newest first, a week at a time, in plain words. Coach entries only for
 * coaches. The entries marked "New" are the ones added since this member last opened the page; opening it clears the dot.
 */
export default async function WhatsNewPage() {
  const v = await requireViewer({ team: "allow" });
  const seen = v.membership.whatsNewSeen ?? 0;
  const entries = visibleEntries(WHATS_NEW, v.role);
  const unseen = unseenCount(WHATS_NEW, v.role, v.membership.whatsNewSeen);
  return (
    <>
      <PageHeader title="What's new" subtitle={`You're on ${APP_VERSION}.`} />
      <WhatsNewSeen unseen={unseen} />
      <div className="space-y-5">
        {byWeek(entries).map((w) => (
          <Card key={w.week} title={`Week of ${formatDate(w.week, { month: "long", day: "numeric" })}`}>
            <ul className="space-y-4" data-testid="whats-new-week">
              {w.entries.map((e) => (
                <li key={e.n} data-testid="whats-new-entry" data-n={e.n} data-audience={e.audience} data-new={e.n > seen ? "1" : "0"}>
                  <p className="font-semibold">
                    {e.title}
                    {e.n > seen ? <span className="badge badge-accent ml-2 align-middle text-[11px]">New</span> : null}
                    {e.audience === "coach" ? <span className="badge ml-2 align-middle text-[11px]">Coaches</span> : null}
                  </p>
                  {e.lines.map((l, i) => (
                    <p key={i} className="mt-1 text-sm text-ink-2">
                      {l}
                    </p>
                  ))}
                  <p className="mt-1 text-xs text-ink-3">
                    {/* The version it arrived in: the day's release, and its commit once known (an entry can't name its own commit). */}
                    Arrived in HelixOS {e.date.replaceAll("-", ".")}
                    {e.version ? ` · ${e.version}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
