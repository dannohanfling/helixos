import { CONTENT_TYPES, PLATFORMS, type ContentItem } from "@/db/schema";
import { createContentAction, updateContentAction } from "@/lib/actions/content";
import { Field } from "./ui";

export function ContentForm({ item, today }: { item?: ContentItem; today: string }) {
  const postDate = item?.postAt?.slice(0, 10) ?? today;
  const postTime = item?.postAt?.slice(11, 16) ?? "09:00";
  return (
    <form action={item ? updateContentAction : createContentAction} className="grid gap-3 sm:grid-cols-2">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <div className="sm:col-span-2">
        <Field label="Title / working idea">
          <input className="field" name="title" required defaultValue={item?.title ?? ""} placeholder="Why most diets fail by week 3 (and the fix)" />
        </Field>
      </div>
      <Field label="Type">
        <select className="field" name="contentType" defaultValue={item?.contentType ?? "CTA Post"}>
          {CONTENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Where">
        <select className="field" name="platform" defaultValue={item?.platform ?? "FB Group"}>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Post date">
        <input className="field" name="postDate" type="date" defaultValue={postDate} />
      </Field>
      <Field label="Time">
        <input className="field" name="postTime" type="time" defaultValue={postTime} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Hook (first line)" hint="If the first line doesn't stop the scroll, nothing else matters.">
          <input className="field" name="hook" defaultValue={item?.hook ?? ""} placeholder="It's not willpower. It's the plan." />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Body">
          <textarea className="field min-h-32" name="body" defaultValue={item?.body ?? ""} placeholder="One line per thought. Line breaks between thoughts." />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="hasCta" defaultChecked={item?.hasCta ?? false} /> Has a call to action (+25 when posted instead of +15)
      </label>
      {item ? (
        <>
          <Field label="Status">
            <select className="field" name="status" defaultValue={item.status}>
              <option value="idea">💡 Idea</option>
              <option value="creating">✍️ Creating</option>
              <option value="ready">🚀 Ready</option>
              <option value="scheduled">📆 Scheduled</option>
              <option value="posted">✅ Posted</option>
            </select>
          </Field>
          <Field label="Post link">
            <input className="field" name="postLink" type="url" defaultValue={item.postLink ?? ""} placeholder="https://…" />
          </Field>
          <Field label="Engagements">
            <input className="field" name="engagements" type="number" min={0} defaultValue={item.engagements} />
          </Field>
          <Field label="Views">
            <input className="field" name="views" type="number" min={0} defaultValue={item.views} />
          </Field>
          <Field label="Leads from this">
            <input className="field" name="leads" type="number" min={0} defaultValue={item.leads} />
          </Field>
          <Field label="Notes">
            <input className="field" name="notes" defaultValue={item.notes ?? ""} />
          </Field>
        </>
      ) : null}
      <div className="sm:col-span-2">
        <button className="btn btn-primary" type="submit">
          {item ? "Save changes" : "Add to pipeline"}
        </button>
      </div>
    </form>
  );
}
