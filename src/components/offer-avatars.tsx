import Link from "next/link";
import { linkAvatarOfferAction } from "@/lib/actions/avatars";
import { avatarsOf, type AvatarRow, type LinkRow } from "@/lib/engine/avatars";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * "Who it's for" on an offer (rev 501 §4): the member's avatars this offer serves, its main one starred, with Make main and
 * Unlink, a picker to link another, and a gentle line when none is linked. Built by Body for main's offer page (rev 516).
 */
export function OfferAvatars({ offerId, rows, links }: { offerId: string; rows: AvatarRow[]; links: LinkRow[] }) {
  const mine = avatarsOf(offerId, links, rows);
  const others = rows.filter((a) => !a.archivedAt && !mine.some((m) => m.id === a.id));
  const from = `/offers/${offerId}`;
  const primary = rows.find((a) => a.primary && !a.archivedAt);
  return (
    <Card id="who-for" title="Who it's for" action={<Link href="/avatars" className="text-xs text-ink-3 hover:underline">Avatars →</Link>}>
      {mine.length ? (
        <ul className="space-y-1" data-testid="offer-avatars">
          {mine.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link href={`/avatars/${a.id}`} className="hover:underline">
                {a.main ? "★ " : ""}
                {a.name}
                {a.main ? <span className="text-xs text-ink-3"> · main</span> : null}
              </Link>
              <span className="flex gap-1">
                {!a.main ? (
                  <form action={linkAvatarOfferAction}>
                    <input type="hidden" name="avatarId" value={a.id} />
                    <input type="hidden" name="offerId" value={offerId} />
                    <input type="hidden" name="main" value="1" />
                    <input type="hidden" name="from" value={from} />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="…">
                      Make main
                    </SubmitButton>
                  </form>
                ) : null}
                <form action={linkAvatarOfferAction}>
                  <input type="hidden" name="avatarId" value={a.id} />
                  <input type="hidden" name="offerId" value={offerId} />
                  <input type="hidden" name="linked" value="0" />
                  <input type="hidden" name="from" value={from} />
                  <SubmitButton className="btn btn-ghost btn-xs" pendingText="…">
                    Unlink
                  </SubmitButton>
                </form>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3" data-testid="offer-no-avatar">
          No avatar linked yet.{primary ? ` Drafts for this offer write to your Primary, ${primary.name}, until you link one.` : " Link the buyer this offer is for, so its drafts are written to them."}
        </p>
      )}
      {others.length ? (
        <form action={linkAvatarOfferAction} className="mt-3 flex gap-2" data-testid="offer-avatar-link">
          <input type="hidden" name="offerId" value={offerId} />
          <input type="hidden" name="from" value={from} />
          <select className="field" name="avatarId" required defaultValue="" aria-label="Avatar">
            <option value="" disabled>
              Link an avatar…
            </option>
            {others.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Linking…">
            Link
          </SubmitButton>
        </form>
      ) : rows.some((a) => !a.archivedAt) ? null : (
        <p className="mt-2 text-xs text-ink-3">
          <Link href="/avatars" className="underline">
            Add your first avatar
          </Link>
        </p>
      )}
    </Card>
  );
}
