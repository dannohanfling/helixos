import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { avatarData, importFromOffers } from "@/lib/avatars";
import { archiveAvatarAction, saveAvatarAction } from "@/lib/actions/avatars";
import { avatarTree, filledCount, IMPORTED_NOTE, offersOf, type AvatarRow, type LinkRow, type OfferRef } from "@/lib/engine/avatars";
import { Badge, Disclosure, Empty, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Avatars" };

function Chips({ a, links, offers }: { a: AvatarRow; links: LinkRow[]; offers: OfferRef[] }) {
  const mine = offersOf(a.id, links, offers);
  if (!mine.length) return <p className="mt-2 text-xs text-ink-3" data-testid="avatar-no-offer">No offer linked yet. Link the offers this buyer would buy on its page.</p>;
  return (
    <div className="mt-2 flex flex-wrap gap-1" data-testid="avatar-offers">
      {mine.map((o) => (
        <Link key={o.id} href={`/offers/${o.id}#who-for`} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs hover:underline">
          {o.main ? "★ " : ""}
          {o.name}
        </Link>
      ))}
    </div>
  );
}

function Head({ a, sub = false }: { a: AvatarRow; sub?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/avatars/${a.id}`} className={`${sub ? "text-sm" : ""} font-semibold hover:underline`} data-testid="avatar-name">
        {a.name}
      </Link>
      {a.primary ? <Badge tone="accent">★ Primary</Badge> : null}
      {a.imported ? <Badge tone="warn">{IMPORTED_NOTE}</Badge> : null}
      <span className="text-xs text-ink-3">{filledCount(a)} of 10 filled</span>
    </div>
  );
}

export default async function AvatarsPage({ searchParams }: { searchParams: Promise<{ error?: string; field?: string; archived?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const m = { workspaceId: v.workspace.id, userId: v.user.id };
  // The first visit brings each offer's free-text avatar in, once; a coach looking in never writes it for them.
  const imported = v.switchedInto ? 0 : await importFromOffers(m);
  const { rows, links, offers } = await avatarData(m);
  const tree = avatarTree(rows);
  const archived = rows.filter((a) => a.archivedAt);
  const tops = rows.filter((a) => !a.archivedAt && !a.parentId);
  const justArchived = sp.archived ? rows.find((a) => a.id === sp.archived && a.archivedAt) : undefined;
  return (
    <>
      <PageHeader
        title="Avatars"
        subtitle="The buyers you serve, each with the offers they'd buy. Drafts for an offer write to its main avatar."
        action={
          <Disclosure open={Boolean(sp.error)} summary={<span className="btn btn-primary btn-sm">+ New avatar</span>}>
            <form action={saveAvatarAction} className="card grid gap-3 p-4" id="new" data-testid="avatar-new">
              {sp.error ? (
                <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="avatar-error">
                  {sp.error}
                </p>
              ) : null}
              <Field label="Name">
                <input className="field" name="name" required maxLength={80} placeholder="The booked-out coach" autoFocus />
              </Field>
              <Field label="In one line (optional)">
                <input className="field" name="oneLine" placeholder="Two years in, fully booked 1:1, can't take another client." />
              </Field>
              {tops.length ? (
                <Field label="A sub-segment of (optional)">
                  <select className="field" name="parentId" defaultValue="">
                    <option value="">None: its own avatar</option>
                    {tops.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <SubmitButton className="btn btn-primary" pendingText="Adding…">
                Add and fill it in
              </SubmitButton>
            </form>
          </Disclosure>
        }
      />
      {justArchived ? (
        <form action={archiveAvatarAction} className="card mb-3 flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-testid="avatar-archived">
          <span>Archived &ldquo;{justArchived.name}&rdquo;. It stays under Archived below.</span>
          <input type="hidden" name="id" value={justArchived.id} />
          <input type="hidden" name="back" value="1" />
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Bringing back…">
            Undo
          </SubmitButton>
        </form>
      ) : null}
      {imported ? (
        <p className="card mb-3 p-3 text-sm" data-testid="avatar-imported">
          Brought in {imported} avatar{imported === 1 ? "" : "s"} from your offers&apos; &ldquo;one person this is for&rdquo;. Each is marked {IMPORTED_NOTE}: open it, fill in the rest and save. The text stays on the offer.
        </p>
      ) : null}
      {tree.length ? (
        <div className="grid gap-3 md:grid-cols-2" data-testid="avatar-cards">
          {tree.map(({ avatar: a, children }) => (
            <section key={a.id} className="card p-4" data-testid="avatar-card">
              <Head a={a} />
              {a.oneLine ? <p className="mt-1 text-sm text-ink-2">{a.oneLine}</p> : a.who ? <p className="mt-1 line-clamp-2 text-sm text-ink-2">{a.who}</p> : null}
              <Chips a={a} links={links} offers={offers} />
              {children.length ? (
                <div className="mt-3 space-y-2 border-l-2 border-line pl-3" data-testid="avatar-subs">
                  {children.map((c) => (
                    <div key={c.id}>
                      <Head a={c} sub />
                      {c.oneLine ? <p className="text-xs text-ink-2">{c.oneLine}</p> : null}
                      <Chips a={c} links={links} offers={offers} />
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <Empty icon="🧭" title="No avatars yet" hint="Add the buyers you serve: who they are, what hurts, what they want and the words they use. Then link each to the offers they'd buy." />
      )}
      {archived.length ? (
        <Disclosure className="mt-4" summary={<span className="text-sm text-ink-2">Archived ({archived.length})</span>}>
          <ul className="mt-2 space-y-1 text-sm" data-testid="avatar-archive-list">
            {archived.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <Link href={`/avatars/${a.id}`} className="hover:underline">
                  {a.name}
                </Link>
                <form action={archiveAvatarAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="back" value="1" />
                  <SubmitButton className="btn btn-ghost btn-xs" pendingText="Bringing back…">
                    Bring back
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </>
  );
}
