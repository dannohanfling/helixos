import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { PUSH_TYPES, wants } from "@/lib/engine/push";
import { prefsFor } from "@/lib/push/send";
import { savePushPrefsAction, sendTestPushAction } from "@/lib/actions/push";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { PhonePushSwitch } from "@/components/pwa/phone-push-switch";

export const metadata = { title: "Notifications" };

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function HourSelect({ name, value, label, testId }: { name: string; value: number; label: string; testId: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <select name={name} defaultValue={value} className="field mt-1" data-testid={testId}>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Settings → Notifications (H-767, plan H-877): the HelixOS app's pushes. The main switch, each kind with an example of its
 * words, the lock-in and close times (the same ones the reminder emails use), quiet hours, and this member's phones.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ saved?: string; test?: string }> }) {
  const [v, sp] = await Promise.all([requireViewer(), searchParams]);
  const locked = Boolean(v.switchedInto || v.team);
  const prefs = await prefsFor(v.membership.id);
  const devices = await db.query.pushDevices.findMany({ where: eq(schema.pushDevices.membershipId, v.membership.id), orderBy: desc(schema.pushDevices.lastSeenAt) });
  const tz = v.membership.timezone || v.workspace.timezone;
  const withToken = devices.filter((d) => d.token && !d.disabledAt);
  return (
    <>
      <PageHeader title="Notifications" subtitle={<Link href="/settings" className="hover:underline">← Settings</Link>} />
      <div className="max-w-2xl space-y-4" data-testid="notifications-page">
        {sp.saved ? <p className="text-sm text-good" role="status" data-testid="notifications-saved">Saved.</p> : null}
        {sp.test === "sent" ? <p className="text-sm text-good" role="status" data-testid="notifications-test-sent">Sent. It should be on your phone now.</p> : null}
        {sp.test === "failed" ? <p className="text-sm text-danger" role="status">The test didn&apos;t reach your phone. Check that notifications are on for HelixOS in your phone&apos;s settings.</p> : null}
        {sp.test === "none" ? <p className="text-sm text-ink-2" role="status">No phone has notifications on yet.</p> : null}
        {locked ? (
          <Card>
            <p className="text-sm">Only the member sets their own notifications.</p>
          </Card>
        ) : (
          <form action={savePushPrefsAction} className="space-y-4">
            <Card>
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                <input type="checkbox" name="enabled" defaultChecked={prefs.enabled} className="h-5 w-5" data-testid="notifications-enabled" />
                Notifications from HelixOS
              </label>
              <p className="mt-1 text-sm text-ink-2">At most three a day, plus reminders for live calls. Never anything about your health.</p>
              <div className="mt-3 empty:hidden">
                <PhonePushSwitch />
              </div>
            </Card>
            <Card title="What you get">
              <ul className="divide-y">
                {PUSH_TYPES.map((t) => (
                  <li key={t.type} className="py-2">
                    <label className={`flex min-h-11 items-start gap-3 text-sm ${t.ready ? "" : "opacity-60"}`}>
                      <input type="checkbox" name={`type_${t.type}`} defaultChecked={wants({ ...prefs, enabled: true }, t.type)} disabled={!t.ready} className="mt-0.5 h-5 w-5 shrink-0" data-testid={`notifications-type-${t.type}`} />
                      <span>
                        <span className="font-medium">{t.label}</span>
                        {t.ready ? null : <span className="badge ml-2 text-[11px]">Coming soon</span>}
                        <span className="block text-ink-2">&ldquo;{t.example}&rdquo;</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="When">
              <div className="grid gap-3 sm:grid-cols-2">
                <HourSelect name="reminderHour" value={v.membership.reminderHour} label="Morning lock-in" testId="notifications-morning" />
                <HourSelect name="eveningReminderHour" value={v.membership.eveningReminderHour} label="Evening close" testId="notifications-evening" />
                <HourSelect name="quietStart" value={prefs.quietStart} label="Quiet from" testId="notifications-quiet-start" />
                <HourSelect name="quietEnd" value={prefs.quietEnd} label="Quiet until" testId="notifications-quiet-end" />
              </div>
              <p className="mt-2 text-xs text-ink-3">In your own time zone. The evening close comes at your chosen time even inside quiet hours. The reminder emails use the same two times.</p>
            </Card>
            <SubmitButton className="btn btn-primary min-h-11" pendingText="Saving…" data-testid="notifications-save">
              Save
            </SubmitButton>
          </form>
        )}
        <Card title="Your phones">
          {devices.length ? (
            <ul className="space-y-2 text-sm" data-testid="notifications-devices">
              {devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{d.platform === "ios" ? "iPhone" : "Android"} · opened {formatDateTime(d.lastSeenAt.includes("T") ? d.lastSeenAt : `${d.lastSeenAt.replace(" ", "T")}Z`, tz)}</span>
                  <span className="text-ink-2">{d.token && !d.disabledAt ? "Notifications on" : "Notifications off"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2" data-testid="notifications-no-devices">Notifications come with the HelixOS app for iPhone and Android.</p>
          )}
          {!locked && withToken.length ? (
            <form action={sendTestPushAction} className="mt-3">
              <SubmitButton className="btn min-h-11" pendingText="Sending…" data-testid="notifications-test">
                Send me a test
              </SubmitButton>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
