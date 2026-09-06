import { createAssetAction } from "@/lib/actions/webinars";
import { Field } from "./ui";

const LABELS: Record<string, { name: string; body: string; extra?: { key: "reframe" | "proof" | "summary"; label: string } }> = {
  story: { name: "Story title", body: "The story, as you'd tell it", extra: { key: "summary", label: "Moral / lesson" } },
  analogy: { name: "Analogy name", body: "The analogy, out loud", extra: { key: "summary", label: "Concept it explains" } },
  objection: { name: "Objection (in their words)", body: "The objection", extra: { key: "reframe", label: "Your reframe" } },
  belief: { name: "Belief name", body: "The belief, in the audience's voice", extra: { key: "reframe", label: "How you shift it" } },
};

export function AssetForm({ type, back }: { type: "story" | "analogy" | "objection" | "belief"; back: string }) {
  const l = LABELS[type];
  return (
    <form action={createAssetAction} className="space-y-3">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="back" value={back} />
      <Field label={l.name}>
        <input className="field" name="name" required />
      </Field>
      <Field label={l.body}>
        <textarea className="field min-h-28" name="body" required />
      </Field>
      {l.extra ? (
        <Field label={l.extra.label}>
          <textarea className="field" name={l.extra.key} />
        </Field>
      ) : null}
      <Field label="When to use it">
        <input className="field" name="useWhen" placeholder="Opportunity frame, when they say 'I've tried this before'…" />
      </Field>
      <button className="btn btn-primary btn-sm" type="submit">
        Save to bank
      </button>
    </form>
  );
}
