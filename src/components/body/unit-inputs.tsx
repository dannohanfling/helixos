"use client";

/**
 * Body's small client pieces: the "per" unit dropdown with its Other box (rev 229), the food log form whose unit list follows
 * the food picked, and delete-all's confirm, which stays shut until DELETE is typed exactly (rev 230).
 */
import { useState } from "react";
import { UNITS, readUnit } from "@/lib/engine/body-units";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmDelete } from "@/components/confirm-delete";

/** A food's unit: the list, grouped, or "Other…" with a text box. An old free-text unit opens on its match, or on Other with its words. */
export function UnitPicker({ value, preferred }: { value?: string; preferred: "oz" | "g" }) {
  const read = value ? readUnit(value) : { unit: preferred };
  const [choice, setChoice] = useState<string>(read.unit ?? "other");
  return (
    <span className="flex gap-1">
      <select name="unitChoice" className="field py-1 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Per unit" data-testid="unit-choice">
        {UNITS.map((g) => (
          <optgroup key={g.group} label={g.label}>
            {g.units.map((u) => (
              <option key={u.unit} value={u.unit}>
                {u.unit}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="other">Other…</option>
      </select>
      {choice === "other" ? <input name="unitOther" className="field w-24 py-1 text-sm" defaultValue={read.unit ? "" : read.other} placeholder="e.g. strip" maxLength={30} required aria-label="Other unit" data-testid="unit-other" /> : null}
    </span>
  );
}

type LogFood = { id: string; name: string; unit: string; units: string[]; /** Pantry (phase 5): the nutrition's basis, so a weighed food asks raw or cooked. */ basis?: "raw" | "cooked" };

/**
 * Food × quantity, in the food's own unit or another of the same group (oz, g, lb, kg). Count units and Other log as themselves.
 * Phone-first (rev 238): recently logged foods head the picker, and the fields are thumb-sized below the sm breakpoint.
 */
export function LogFoodForm({ action, foods, slots, defaultSlot, date, recent = [] }: { action: (fd: FormData) => Promise<void>; foods: LogFood[]; slots: string[]; defaultSlot: string; date: string; recent?: string[] }) {
  const [foodId, setFoodId] = useState("");
  const food = foods.find((f) => f.id === foodId);
  const [unit, setUnit] = useState("");
  const units = food?.units ?? [];
  const recentFoods = recent.flatMap((id) => foods.filter((f) => f.id === id));
  const otherFoods = foods.filter((f) => !recent.includes(f.id));
  const option = (f: LogFood) => (
    <option key={f.id} value={f.id}>
      {f.name} (per {f.unit}{f.basis && f.units.length > 1 ? `, ${f.basis}` : ""})
    </option>
  );
  const big = "field py-2 text-base sm:py-1 sm:text-sm";
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2" data-testid="body-log-food-form">
      <input type="hidden" name="date" value={date} />
      <label className="w-full min-w-0 sm:w-auto sm:flex-1">
        <span className="label">Food</span>
        <select
          name="foodId"
          className={big}
          value={foodId}
          onChange={(e) => {
            setFoodId(e.target.value);
            setUnit(foods.find((f) => f.id === e.target.value)?.unit ?? "");
          }}
          required
        >
          <option value="" disabled>
            Pick a food…
          </option>
          {recentFoods.length ? (
            <>
              <optgroup label="Recent">{recentFoods.map(option)}</optgroup>
              <optgroup label="All foods">{otherFoods.map(option)}</optgroup>
            </>
          ) : (
            foods.map(option)
          )}
        </select>
      </label>
      <label className="w-20">
        <span className="label">Qty</span>
        <input name="qty" type="number" step="any" min={0} defaultValue={1} className={`${big} tabular`} />
      </label>
      <label>
        <span className="label">Unit</span>
        <select name="unit" className={`${big} w-auto`} value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!food} data-testid="body-log-unit">
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      {food?.basis && food.units.length > 1 ? (
        <label>
          <span className="label">Weighed</span>
          <select name="weighed" className={`${big} w-auto`} defaultValue={food.basis} data-testid="body-log-weighed">
            <option value="cooked">cooked</option>
            <option value="raw">raw</option>
          </select>
        </label>
      ) : null}
      <label>
        <span className="label">Slot</span>
        <select name="slot" className={`${big} w-auto`} defaultValue={defaultSlot}>
          {slots.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <SubmitButton className="btn btn-humanos" pendingText="Logging…" data-testid="body-log-food">
        Log food
      </SubmitButton>
      {food && units.length === 1 ? (
        <p className="w-full text-xs text-ink-3" data-testid="body-log-unit-note">
          {food.name} is counted per {food.unit}, so it&apos;s logged in {food.unit} only.
        </p>
      ) : null}
    </form>
  );
}

/** Delete-all: the confirm opens only once DELETE is typed exactly. */
export function EraseBodyForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [typed, setTyped] = useState("");
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <label>
        <span className="label">Type DELETE</span>
        <input name="confirm" className="field w-28 py-1 text-sm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="body-erase-confirm" />
      </label>
      <ConfirmDelete what="all your HumanOS data" undo="Your targets, foods, meals, logged days, comments and sharing log go for good." testId="body-erase" disabled={typed !== "DELETE"} className="btn btn-sm border border-danger text-danger" />
    </form>
  );
}
