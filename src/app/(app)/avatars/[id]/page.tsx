import Link from "next/link";
import { notFound } from "next/navigation";
import { AVATAR_FIELDS } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { avatarData } from "@/lib/avatars";
import { archiveAvatarAction, duplicateAvatarAction, linkAvatarOfferAction, makePrimaryAvatarAction, saveAvatarAction } from "@/lib/actions/avatars";
import { AVATAR_FIELD_INFO, IMPORTED_NOTE, offersOf } from "@/lib/engine/avatars";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DraftKeeper } from "@/components/draft-keeper";

export const metadata = { title: "Avatar" };

const SAVED: Record<string, string> = { "1": "Saved.", copy: "Duplicated: this is the copy. Rename it and change what differs.", back: "Brought back.", link: "Offers updated." };

export default async function AvatarPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; field?: string; saved?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const { rows, links, offers } = await avatarData({ workspaceId: v.workspace.id, userId: v.user.id });
  const a = rows.find((x) => x.id === id);
  if (!a) notFound();
  const parent = a.parentId ? rows.find((x) => x.id === a.parentId) : undefined;
  const hasSubs = rows.some((x) => x.parentId === a.id && !x.archivedAt);
  const parents = rows.filter((x) => !x.archivedAt && !x.parentId && x.id !== a.id);
  const linked = offersOf(a.id, links, offers);
  const unlinked = offers.filter((o) => !linked.some((l) => l.id === o.id));
  return (
    <>
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="avatar-error">
          {sp.error}
        </p>
      ) : sp.saved && SAVED[sp.saved] ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="avatar-saved">
          {SAVED[sp.saved]}
        </p>
      ) : null}
      <PageHeader
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/avatars" className="hover:underline">
              ← Avatars
            </Link>
            {parent ? <span className="text-xs text-ink-3">sub-segment of {parent.name}</span> : null}
            {a.primary ? <Badge tone="accent">★ Primary</Badge> : null}
            {a.imported ? <Badge tone="warn">{IMPORTED_NOTE}</Badge> : null}
            {a.archivedAt ? <Badge>archived</Badge> : null}
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            {!a.primary && !a.archivedAt ? (
              <form action={makePrimaryAvatarAction}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="from" value={`/avatars/${a.id}`} />
                <SubmitButton className="btn btn-ghost btn-sm" pendingText="Starring…">
                  ★ Make Primary
                </SubmitButton>
              </form>
            ) : null}
            <form action={duplicateAvatarAction}>
              <input type="hidden" name="id" value={a.id} />
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Copying…">
                Duplicate
              </SubmitButton>
            </form>
            <form action={archiveAvatarAction}>
              <input type="hidden" name="id" value={a.id} />
              {a.archivedAt ? <input type="hidden" name="back" value="1" /> : null}
              <SubmitButton className="btn btn-ghost btn-sm" pendingText={a.archivedAt ? "Bringing back…" : "Archiving…"}>
                {a.archivedAt ? "Bring back" : "Archive"}
              </SubmitButton>
            </form>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <form action={saveAvatarAction} className="space-y-4" data-testid="avatar-form">
          <input type="hidden" name="id" value={a.id} />
          {v.switchedInto ? null : <DraftKeeper id={`avatar.${v.user.id}.${a.id}`} />}
          <Card title="Who this is" action={<SubmitButton className="btn btn-accent btn-sm" pendingText="Saving…">Save avatar</SubmitButton>}>
            {a.imported ? <p className="mb-3 text-xs text-ink-3">Brought in from an offer. Check the name, fill in what you know and save; the &ldquo;please review&rdquo; goes when you do.</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input className="field" name="name" defaultValue={a.name} required maxLength={80} />
              </Field>
              <Field label="A sub-segment of" hint={hasSubs ? "It has sub-segments of its own, so it stays top-level." : undefined}>
                <select className="field" name="parentId" defaultValue={a.parentId ?? ""} disabled={hasSubs}>
                  <option value="">None: its own avatar</option>
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="In one line">
                  <input className="field" name="oneLine" defaultValue={a.oneLine ?? ""} placeholder="Two years in, fully booked 1:1, can't take another client." />
                </Field>
              </div>
              {AVATAR_FIELDS.map((f) => (
                <div key={f} className={f === "who" || f === "pains" || f === "phrases" ? "sm:col-span-2" : ""}>
                  <Field label={AVATAR_FIELD_INFO[f].label}>
                    <textarea className="field" name={f} defaultValue={a[f] ?? ""} placeholder={AVATAR_FIELD_INFO[f].placeholder} data-testid={`avatar-${f}`} />
                  </Field>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <SubmitButton className="btn btn-accent" pendingText="Saving…">
                Save avatar
              </SubmitButton>
            </div>
          </Card>
        </form>
        <Card id="offers" title="Offers for this avatar">
          {linked.length ? (
            <ul className="space-y-2" data-testid="avatar-linked">
              {linked.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Link href={`/offers/${o.id}#who-for`} className="hover:underline">
                    {o.main ? "★ " : ""}
                    {o.name}
                    {o.main ? <span className="text-xs text-ink-3"> · main avatar</span> : null}
                  </Link>
                  <span className="flex gap-1">
                    {!o.main ? (
                      <form action={linkAvatarOfferAction}>
                        <input type="hidden" name="avatarId" value={a.id} />
                        <input type="hidden" name="offerId" value={o.id} />
                        <input type="hidden" name="main" value="1" />
                        <input type="hidden" name="from" value={`/avatars/${a.id}`} />
                        <SubmitButton className="btn btn-ghost btn-xs" pendingText="…">
                          Make main
                        </SubmitButton>
                      </form>
                    ) : null}
                    <form action={linkAvatarOfferAction}>
                      <input type="hidden" name="avatarId" value={a.id} />
                      <input type="hidden" name="offerId" value={o.id} />
                      <input type="hidden" name="linked" value="0" />
                      <input type="hidden" name="from" value={`/avatars/${a.id}`} />
                      <SubmitButton className="btn btn-ghost btn-xs" pendingText="…">
                        Unlink
                      </SubmitButton>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3" data-testid="avatar-no-offer">No offer linked yet. Which of your offers would this buyer buy?</p>
          )}
          {unlinked.length ? (
            <form action={linkAvatarOfferAction} className="mt-3 flex gap-2" data-testid="avatar-link">
              <input type="hidden" name="avatarId" value={a.id} />
              <input type="hidden" name="from" value={`/avatars/${a.id}`} />
              <select className="field" name="offerId" required defaultValue="" aria-label="Offer">
                <option value="" disabled>
                  Link an offer…
                </option>
                {unlinked.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Linking…">
                Link
              </SubmitButton>
            </form>
          ) : offers.length ? null : (
            <p className="mt-2 text-xs text-ink-3">
              No offers yet. <Link href="/offers" className="underline">Make one</Link>, then link it here.
            </p>
          )}
          <p className="mt-3 text-xs text-ink-3">An offer can serve several avatars. Its main one is who its drafts, webinar and deck are written for.</p>
        </Card>
      </div>
    </>
  );
}
