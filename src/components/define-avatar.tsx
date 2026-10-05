import Link from "next/link";
import { savePrimaryAvatarAction } from "@/lib/actions/avatars";
import { AVATAR_FIELD_INFO, type AvatarRow } from "@/lib/engine/avatars";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/** Of the ten, the four the Pathway's Day 1 asks: who they are, what they fear, what they want, what they've tried. */
const ASKED = ["who", "pains", "wants", "tried"] as const;

/**
 * The Pathway step "Define Your Buyer Avatar" (rev 501 §5): written straight into the member's Primary avatar, made the first
 * time. The rest of its fields are on its page under Avatars.
 */
export function DefineAvatar({ primary, from, error, saved }: { primary: AvatarRow | null; from: string; error?: string; saved?: boolean }) {
  return (
    <form action={savePrimaryAvatarAction} className="mt-3 space-y-2" id="define" data-testid="define-avatar">
      <input type="hidden" name="from" value={from} />
      {error ? (
        <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert">
          {error}
        </p>
      ) : saved ? (
        <p className="rounded-lg border border-good bg-good-soft p-2 text-sm" role="status" data-testid="define-avatar-saved">
          Saved to your Primary avatar{primary ? `, ${primary.name}` : ""}.{" "}
          {primary ? (
            <Link href={`/avatars/${primary.id}`} className="underline">
              Fill in the rest
            </Link>
          ) : null}
        </p>
      ) : null}
      <Field label="Name them">
        <input className="field" name="name" defaultValue={primary?.name ?? ""} required maxLength={80} placeholder="The booked-out coach" />
      </Field>
      {ASKED.map((f) => (
        <Field key={f} label={AVATAR_FIELD_INFO[f].label}>
          <textarea className="field" name={f} defaultValue={primary?.[f] ?? ""} placeholder={AVATAR_FIELD_INFO[f].placeholder} />
        </Field>
      ))}
      <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
        Save to my Primary avatar
      </SubmitButton>
    </form>
  );
}
