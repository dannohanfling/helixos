import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { siteUrl } from "@/lib/app-url";
import { defaultPitch } from "@/lib/engine/magic-funnel";
import { mfAvailable } from "@/lib/mf/data";
import { saveHermesAction } from "@/lib/hermes/actions";
import { previewContext } from "@/lib/hermes/data";
import { coldPath, hermesFor, hostOn, previewDeploy } from "@/lib/hermes/settings";
import { cleanPixelId, youtubeEmbed } from "@/lib/hermes/rules";
import { COLD_HERO } from "@/lib/hermes/copy";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";
import { HermesPreview } from "@/components/hermes/preview";
import { hermesFonts } from "@/components/hermes/fonts";
import { ItemGone } from "@/components/item-gone";

export const metadata = { title: "HelixOS pages" };

/** Is hermes_pages on this database? (Migration 0153, run on deploy; a database it hasn't reached reads the switch as off.) */
async function tableReady(): Promise<boolean> {
  try {
    await db.run(sql`select 1 from hermes_pages limit 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Webinars → Magic funnel → HelixOS pages (Hermes): serve this webinar's Magic funnel pages from HelixOS in the gold design
 * instead of the GoHighLevel page. The switch, the thank-you video, the Meta Pixel, the addresses, counts only, and a preview
 * of both pages for a made-up prospect.
 */
export default async function HelixosPagesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; held?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.workspaceId, v.workspace.id), eq(schema.webinars.userId, v.user.id)), columns: { id: true, title: true } });
  if (!w) return <ItemGone what="This webinar" href="/webinars" list="your webinars" />;
  const m = { workspaceId: v.workspace.id, userId: v.user.id };
  const [row, ready, ctx, signups] = await Promise.all([
    hermesFor(w.id),
    tableReady(),
    previewContext(m, w.id),
    db.query.webinarSignups.findMany({ where: and(eq(schema.webinarSignups.webinarId, w.id), eq(schema.webinarSignups.userId, v.user.id)), columns: { source: true, pitchStatus: true, openedAt: true, registeredAt: true, registeredVia: true } }),
  ]);
  const available = mfAvailable(v.membership);
  const on = hostOn(row, m);
  const mf = signups.filter((x) => x.source === "mf");
  // Counts only: no names, no codes.
  const counts = { made: mf.filter((x) => x.pitchStatus !== "none").length, opened: mf.filter((x) => x.openedAt).length, registered: signups.filter((x) => x.registeredVia === "helixos").length, ghlFailed: row?.ghlFailed ?? 0 };
  const cold = `${siteUrl()}${coldPath(w.id)}`;
  const preview = ctx ? defaultPitch({ defaults: ctx.setup.defaults, pillars: ctx.setup.pillars, agenda: ctx.setup.agenda, proofIds: [], firstName: "", facts: { title: ctx.title, startsAt: ctx.when.startsAt, when: ctx.when.line, promise: "", learn: [], whoFor: "" } }) : null;
  if (preview && ctx && !ctx.setup.defaults.header?.trim()) preview.hero = { ...preview.hero, header: COLD_HERO.header, subheader: preview.hero.subheader || COLD_HERO.subheader(ctx.when) };
  const held = sp.held === "table" ? "the HelixOS pages table isn't on this database yet; it arrives with the next deploy's migrations" : sp.held;

  return (
    <>
      <PageHeader title="HelixOS pages" subtitle={`${w.title}: the whole Magic funnel page served by HelixOS, in the gold design`} action={<Link href={`/webinars/${w.id}/magic-funnel`} className="btn btn-ghost btn-sm">Back to the Magic funnel</Link>} />
      {held ? (
        <p className="mb-4 rounded-lg border border-warn bg-warn-soft p-3 text-sm" role="alert" data-testid="hm-held">
          Not saved: {held}.
        </p>
      ) : sp.saved ? (
        <p className="mb-4 rounded-lg bg-good-soft p-3 text-sm" role="status" data-testid="hm-saved">
          Saved.
        </p>
      ) : null}
      {!ready ? (
        <p className="mb-4 rounded-lg border border-warn bg-warn-soft p-3 text-sm" role="status" data-testid="hm-no-table">
          These settings can&apos;t be saved on this database yet: the table arrives with the next deploy&apos;s migrations. Until then the switch reads off.
          {previewDeploy() ? " On this Preview the pages open for any webinar whose Magic funnel is live, so you can try them." : ""}
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={on ? "good" : "neutral"}>{on ? "Hosted in HelixOS" : "Off: the bot sends your GoHighLevel page"}</Badge>
      </div>

      <Card className="mb-4" title="How it's going">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="hm-counts">
          <div>
            <dt className="text-xs text-ink-3">Pages made</dt>
            <dd className="tabular text-lg font-semibold">{counts.made}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Opened</dt>
            <dd className="tabular text-lg font-semibold">{counts.opened}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Registered on a HelixOS page</dt>
            <dd className="tabular text-lg font-semibold" data-testid="hm-count-registered">{counts.registered}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Not reached GoHighLevel</dt>
            <dd className="tabular text-lg font-semibold">{counts.ghlFailed}</dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-4" title="Settings">
        <form action={saveHermesAction} className="space-y-4" data-testid="hm-settings">
          <input type="hidden" name="webinarId" value={w.id} />
          <label className="flex min-h-[44px] items-start gap-3">
            <input type="checkbox" name="hostOn" defaultChecked={on} disabled={v.role !== "coach" || !available} className="mt-1" data-testid="hm-host-on" />
            <span>
              <span className="font-semibold">Host pages in HelixOS</span>
              <span className="block text-sm text-ink-3">
                On: your bot&apos;s Magic funnel links open the HelixOS page (gold design, the form filled from the chat) instead of your GoHighLevel page. Registrations still reach GoHighLevel, tagged ic-registered and ic-&lt;date&gt;. Off: nothing changes.
                {v.role !== "coach" ? " Your coach turns this on." : ""}
              </span>
            </span>
          </label>
          <Field label="Thank-you video (an unlisted YouTube link)" hint="Plays on the confirmation page from youtube-nocookie.com.">
            <input name="videoUrl" className="input" type="url" maxLength={300} defaultValue={row?.videoUrl ?? ""} placeholder="https://youtu.be/…" />
          </Field>
          {row?.videoUrl && !youtubeEmbed(row.videoUrl) ? <p className="text-sm text-danger">That link isn&apos;t a YouTube video.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Meta Pixel ID" hint="Digits only. It fires PageView on the cold page and CompleteRegistration on the confirmation page, with no personal data.">
              <input name="pixelId" className="input" inputMode="numeric" maxLength={20} defaultValue={row?.pixelId ?? ""} />
            </Field>
            <label className="flex min-h-[44px] items-center gap-3 self-end">
              <input type="checkbox" name="pixelOn" defaultChecked={Boolean(row?.pixelOn && cleanPixelId(row.pixelId))} /> Pixel on
            </label>
          </div>
          <SubmitButton disabled={!ready}>Save</SubmitButton>
        </form>
      </Card>

      <Card className="mb-4" title="Addresses">
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-semibold">Cold page, for ads</div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 break-all" data-testid="hm-cold-url">{cold}</code>
              <CopyButton text={cold} label="Copy" />
            </div>
            <p className="text-ink-3">Default copy and an empty form. It opens once the switch is on and the Magic funnel is live.</p>
          </div>
          <div>
            <div className="font-semibold">Personal pages</div>
            <p className="text-ink-3">
              Your bot gets each person&apos;s address from mf_prepare: <code>{siteUrl()}/mf/</code> and their own code, nothing personal in it. To open a page from a GoHighLevel link the bot sent (…?mf=<em>code</em>), put that code after <code>/mf/</code>.
            </p>
          </div>
        </div>
      </Card>

      <Card title="Preview">
        {ctx && preview ? (
          <HermesPreview ctx={ctx} fonts={hermesFonts} defaultPitch={preview} />
        ) : (
          <p className="text-sm text-ink-3">Give the webinar a date and time on Run it, and save its Magic funnel setup, to preview its pages.</p>
        )}
      </Card>
    </>
  );
}
