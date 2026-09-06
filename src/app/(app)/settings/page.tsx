import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { rotateInviteAction, updateGoalAction, updateProfileAction, updateWorkspaceAction } from "@/lib/actions/settings";
import { CopyButton } from "@/components/copy-button";
import { Card, Field, PageHeader } from "@/components/ui";
import { GhlConnect } from "@/components/ghl-connect";
import { ChangePasswordForm } from "@/components/change-password-form";
import { connectionFor } from "@/lib/ghl";

export const metadata = { title: "Settings" };

const TIMEZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

export default async function SettingsPage() {
  const v = await requireViewer();
  const [goal, conn] = await Promise.all([db.query.goals.findFirst({ where: and(eq(schema.goals.userId, v.user.id), eq(schema.goals.primary, true)) }), connectionFor(v.user.id)]);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return (
    <>
      <PageHeader title="Settings" />
      <Card className="mb-4" title="🚀 Publishing (your GoHighLevel sub-account)">
        <p className="mb-3 text-sm text-ink-2">Connect your own GoHighLevel sub-account once. Posts you schedule in the composer land in your Social Planner and go out on their own. Your token is encrypted and only ever used for your sub-account.</p>
        <GhlConnect conn={conn ?? null} tz={v.workspace.timezone} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Password">
          <ChangePasswordForm />
        </Card>
        <Card title="You">
          <form action={updateProfileAction} className="space-y-3">
            <div className="grid grid-cols-[4rem_1fr] gap-3">
              <Field label="Emoji">
                <input className="field text-center" name="avatarEmoji" defaultValue={v.user.avatarEmoji} maxLength={4} />
              </Field>
              <Field label="Name">
                <input className="field" name="name" defaultValue={v.user.name} />
              </Field>
            </div>
            <Field label="Business">
              <input className="field" name="businessName" defaultValue={v.membership.businessName ?? ""} />
            </Field>
            <Field label="Big promise" hint="I help [who] go from [pain] to [outcome] in [time] without [thing they hate].">
              <textarea className="field" name="bigPromise" defaultValue={v.membership.bigPromise ?? ""} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Morning reminder (hour)">
                <input className="field" name="reminderHour" type="number" min={0} max={23} defaultValue={v.membership.reminderHour} />
              </Field>
              <Field label="Evening reminder (hour)">
                <input className="field" name="eveningReminderHour" type="number" min={0} max={23} defaultValue={v.membership.eveningReminderHour} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="leaderboardOptIn" defaultChecked={v.membership.leaderboardOptIn} /> Show me on the weekly leaderboard
            </label>
            <button className="btn btn-primary" type="submit">
              Save
            </button>
          </form>
        </Card>
        <Card title="Your one goal">
          <form action={updateGoalAction} className="space-y-3">
            <Field label="Goal">
              <input className="field" name="title" defaultValue={goal?.title ?? "Cash collected this month"} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Target">
                <input className="field tabular" name="target" type="number" min={1} defaultValue={goal?.target ?? 5000} />
              </Field>
              <Field label="So far">
                <input className="field tabular" name="actual" type="number" min={0} defaultValue={goal?.actual ?? 0} />
              </Field>
              <Field label="Unit">
                <select className="field" name="unit" defaultValue={goal?.unit ?? "$"}>
                  <option value="$">$</option>
                  <option value="clients">clients</option>
                  <option value="calls">calls</option>
                  <option value="leads">leads</option>
                </select>
              </Field>
            </div>
            <Field label="Period">
              <input className="field" name="period" defaultValue={goal?.period ?? "This month"} />
            </Field>
            <p className="text-xs text-ink-3">Cash you log in the evening close adds to a $ goal automatically.</p>
            <button className="btn btn-primary" type="submit">
              Save goal
            </button>
          </form>
        </Card>
        {v.role === "coach" ? (
          <>
            <Card title="Workspace">
              <form action={updateWorkspaceAction} className="space-y-3">
                <Field label="Name">
                  <input className="field" name="name" defaultValue={v.workspace.name} />
                </Field>
                <Field label="Timezone" hint="Controls what 'today' means for streaks and reminders.">
                  <select className="field" name="timezone" defaultValue={v.workspace.timezone}>
                    {TIMEZONES.map((tz) => (
                      <option key={tz}>{tz}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Brand voice" hint="Used when generating copy suggestions.">
                  <textarea className="field" name="brandVoice" defaultValue={v.workspace.brandVoice ?? ""} />
                </Field>
                <Field label="HelixOS Airtable base ID" hint="Run `npm run import:airtable` to refresh pathway, curriculum, and DM templates from your base.">
                  <input className="field" name="airtableBaseId" defaultValue={v.workspace.airtableBaseId ?? ""} placeholder="appXXXXXXXXXXXXXX" />
                </Field>
                <button className="btn btn-primary" type="submit">
                  Save workspace
                </button>
              </form>
            </Card>
            <Card title="Invite links">
              <div className="space-y-3 text-sm">
                <div>
                  <div className="label">Clients</div>
                  <div className="flex items-center gap-2">
                    <code className="field truncate">{`${appUrl}/join/${v.workspace.clientInviteCode}`}</code>
                    <CopyButton text={`${appUrl}/join/${v.workspace.clientInviteCode}`} />
                  </div>
                </div>
                <div>
                  <div className="label">Coaches / team</div>
                  <div className="flex items-center gap-2">
                    <code className="field truncate">{`${appUrl}/join/${v.workspace.coachInviteCode}`}</code>
                    <CopyButton text={`${appUrl}/join/${v.workspace.coachInviteCode}`} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <form action={rotateInviteAction}>
                    <input type="hidden" name="which" value="client" />
                    <button className="btn btn-ghost btn-xs" type="submit">
                      Rotate client code
                    </button>
                  </form>
                  <form action={rotateInviteAction}>
                    <input type="hidden" name="which" value="coach" />
                    <button className="btn btn-ghost btn-xs" type="submit">
                      Rotate coach code
                    </button>
                  </form>
                </div>
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
