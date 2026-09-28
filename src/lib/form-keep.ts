/**
 * No form clears on an error (handoff rev 160). React resets a form after its action answers; when the answer is a refusal,
 * the shared SubmitButton puts back what the member typed from a snapshot taken when they pressed it, marks the field the
 * refusal names in red beside it, and moves focus there. The snapshot lives in memory only, for that one answer.
 * Drafts (rev 160) are the other half: the longer forms keep an unsaved copy in this browser, never of a secret.
 */
export type Snapshot = { name: string; type: string; value: string; checked: boolean }[];

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const SKIP = new Set(["hidden", "file", "submit", "button", "reset", "image"]);
/** A field whose value is a credential: never written to a draft in the browser. */
export const isSecret = (el: { name: string; type: string }): boolean => el.type === "password" || /token|secret|password|apikey|api_key|webhook/i.test(el.name);

const fieldsOf = (form: HTMLFormElement): Field[] => Array.from(form.elements).filter((e): e is Field => (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement) && Boolean(e.name) && !SKIP.has(e.type));

export function snapshot(form: HTMLFormElement, opts: { secrets?: boolean } = {}): Snapshot {
  return fieldsOf(form)
    .filter((e) => opts.secrets !== false || !isSecret(e))
    .map((e) => ({ name: e.name, type: e.type, value: e.value, checked: e instanceof HTMLInputElement ? e.checked : false }));
}

/** Sets a value the way typing would, so a field React controls takes it too. */
function setValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** A field still as the page drew it: nothing typed into it since. Only those are filled back, so a restore never overwrites fresh typing. */
function untouched(el: Field, fields: Field[]): boolean {
  if (el instanceof HTMLInputElement && el.type === "radio") return fields.filter((f): f is HTMLInputElement => f instanceof HTMLInputElement && f.type === "radio" && f.name === el.name).every((r) => r.checked === r.defaultChecked);
  if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked === el.defaultChecked;
  if (el instanceof HTMLSelectElement) return Array.from(el.options).every((o) => o.selected === o.defaultSelected);
  return el.value === el.defaultValue;
}

export function restore(form: HTMLFormElement, snap: Snapshot): number {
  let changed = 0;
  const fields = fieldsOf(form);
  const fresh = new Set(fields.filter((f) => untouched(f, fields)));
  for (const s of snap) {
    for (const el of fields.filter((f) => f.name === s.name && fresh.has(f))) {
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        if (el.value === s.value && el.checked !== s.checked) {
          el.checked = s.checked;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          changed++;
        }
      } else if (el.type === s.type && el.value !== s.value) {
        setValue(el, s.value);
        changed++;
      }
    }
  }
  return changed;
}

/** The refusal beside its field: red, announced, and focused. Earlier marks in the form are cleared first. */
export function markField(form: HTMLFormElement, name: string | null, message: string) {
  form.querySelectorAll("[data-field-error]").forEach((n) => n.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((n) => n.removeAttribute("aria-invalid"));
  const target = (name ? fieldsOf(form).find((f) => f.name === name) : null) ?? fieldsOf(form).find((f) => !(f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")));
  if (!target) return;
  if (name) {
    target.setAttribute("aria-invalid", "true");
    const note = document.createElement("p");
    note.className = "mt-1 text-sm text-danger";
    note.setAttribute("role", "alert");
    note.setAttribute("data-field-error", "");
    note.setAttribute("data-testid", "field-error");
    note.textContent = message;
    // Beside the field: after its label when it sits in one (radios), else right after it.
    const anchor = target.type === "radio" || target.type === "checkbox" ? (target.closest("fieldset") ?? target) : target;
    anchor.insertAdjacentElement("afterend", note);
  }
  target.focus({ preventScroll: false });
}

/** The refusal in the address: its message and the field it names (?weekError=…&field=kr2). */
export function refusalIn(search: string): { message: string; field: string | null } | null {
  const q = new URLSearchParams(search);
  for (const [k, v] of q) if (/error$/i.test(k) && v) return { message: v, field: q.get("field") };
  return null;
}
