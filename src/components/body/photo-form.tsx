"use client";
import { useActionState, useRef, useState } from "react";
import type { PhotoState } from "@/lib/actions/body";
import { SubmitButton } from "@/components/submit-button";

/**
 * A meal from a photo (rev 237 phase 14): the member picks or takes a photo, it is shrunk on the phone (longest side 1024 px,
 * JPEG) so only a small image travels, and "Read the plate" sends it to their own AI. The lines come back editable, each with
 * a tick; "Log these" writes one entry. Nothing is logged until that second press, and the photo goes nowhere else.
 */
export function PhotoForm({ action, logAction, date, slots, defaultSlot }: { action: (prev: PhotoState, f: FormData) => Promise<PhotoState>; logAction: (f: FormData) => Promise<void>; date: string; slots: string[]; defaultSlot: string }) {
  const [state, read] = useActionState<PhotoState, FormData>(action, undefined);
  const [image, setImage] = useState<{ data: string; mediaType: string; preview: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    setProblem(null);
    setImage(null);
    if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      const img = new Image();
      await new Promise<void>((ok, no) => {
        img.onload = () => ok();
        img.onerror = () => no(new Error("unreadable"));
        img.src = url;
      });
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      setImage({ data: dataUrl.replace(/^data:[^,]*,/, ""), mediaType: "image/jpeg", preview: dataUrl });
    } catch {
      setProblem("That file couldn't be read as a photo. Try a JPEG or PNG.");
    }
  }

  return (
    <div className="space-y-3" data-testid="body-photo">
      <form action={read} className="space-y-2">
        <input ref={file} type="file" accept="image/*" capture="environment" className="block text-sm" onChange={(e) => pick(e.target.files?.[0])} data-testid="body-photo-file" aria-label="A photo of the meal" />
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.preview} alt="The meal, shrunk for AI" className="max-h-40 rounded-lg border" data-testid="body-photo-preview" />
        ) : null}
        <input type="hidden" name="image" value={image?.data ?? ""} />
        <input type="hidden" name="mediaType" value={image?.mediaType ?? ""} />
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton className="btn btn-humanos btn-sm" pendingText="Reading the plate…" disabled={!image} data-testid="body-photo-read">
            ✨ Read the plate
          </SubmitButton>
          <span className="text-xs text-ink-3">Your own AI names the foods and guesses the portions. Nothing is logged until you check the lines.</span>
        </div>
        {problem || state?.error ? (
          <p className="rounded-xl border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="body-photo-error">
            {problem ?? state?.error}
          </p>
        ) : null}
      </form>
      {state?.lines?.length ? (
        <form action={logAction} className="space-y-2 rounded-lg border p-3" data-testid="body-photo-confirm">
          <input type="hidden" name="date" value={date} />
          <p className="text-sm font-medium">What AI saw: check each line, fix the amounts, untick what isn&apos;t there.</p>
          {state.note ? <p className="text-xs text-ink-3">{state.note}</p> : null}
          <ul className="space-y-2" data-testid="body-photo-lines">
            {state.lines.map((l, n) => (
              <li key={n} className="grid grid-cols-[auto_1fr] gap-2 text-sm" data-testid="body-photo-line">
                <input type="checkbox" name={`line_${n}_use`} value="1" defaultChecked className="mt-2" aria-label={`Log ${l.name}`} data-testid="body-photo-use" />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_5rem_6rem_4rem_4rem_4rem_4rem]">
                  <input name={`line_${n}_name`} defaultValue={l.name} maxLength={80} className="field col-span-2 py-1 text-sm sm:col-span-1" aria-label="Food" />
                  <input name={`line_${n}_qty`} type="text" autoComplete="off" inputMode="decimal" defaultValue={l.qty} className="field py-1 text-sm tabular" aria-label="Quantity" data-testid="body-photo-qty" />
                  <input name={`line_${n}_unit`} defaultValue={l.unit} maxLength={20} className="field py-1 text-sm" aria-label="Unit" />
                  <input type="hidden" name={`line_${n}_qty0`} value={l.qty} />
                  {(["cal", "p", "f", "c"] as const).map((k) => (
                    <label key={k} className="text-xs text-ink-3">
                      {k === "cal" ? "cal" : k.toUpperCase()}
                      <input name={`line_${n}_${k}`} type="text" autoComplete="off" inputMode="decimal" defaultValue={l[k]} className="field py-1 text-sm tabular" aria-label={k} />
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <select name="slot" className="field w-auto py-1 text-sm" defaultValue={defaultSlot} aria-label="Meal slot">
              {slots.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <SubmitButton className="btn btn-humanos px-5" pendingText="Logging…" data-testid="body-photo-log">
              Log these
            </SubmitButton>
            <span className="text-xs text-ink-3">The macros scale with the amount you type.</span>
          </div>
        </form>
      ) : null}
    </div>
  );
}
