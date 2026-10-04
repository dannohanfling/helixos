"use client";

import { useState, type InputHTMLAttributes } from "react";
import { moneyLabel, readMoney } from "@/lib/engine/money";

/**
 * A money box (rev 444): takes the amount the way people write it ("3.5k", "$3,500", "3500 USD", "1.2m") and says under it what
 * it understood ("Reads as $3,500") before Save, or the one plain line when it can't read it. A text box, not a number box: a
 * number box throws away "3.5k" before anything is sent, which is how a member's answers were lost. The server reads it again
 * with the same parser; this line is only what the member sees first.
 */
export function MoneyInput({ defaultValue, className = "field tabular", plain = false, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "defaultValue" | "value" | "onChange"> & { name: string; defaultValue?: number | string | null; /** An amount that may not be money (a goal in clients): read the same way, shown without "$". */ plain?: boolean }) {
  const [typed, setTyped] = useState(defaultValue == null || defaultValue === "" ? "" : String(defaultValue));
  const read = readMoney(typed);
  const shown = "error" in read ? null : read.value;
  // The understood amount is worth saying only when it differs from what was typed ("3.5k", not "3500").
  const same = shown != null && typed.trim().replace(/,/g, "") === String(shown);
  return (
    <>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={className}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        aria-invalid={"error" in read ? true : undefined}
      />
      {"error" in read ? (
        <span className="mt-0.5 block text-xs text-danger" data-testid="money-read" data-ok="0">
          {read.error}
        </span>
      ) : shown != null && !same ? (
        <span className="mt-0.5 block text-xs text-ink-2" data-testid="money-read" data-ok="1">
          Reads as {plain ? shown.toLocaleString("en-US") : moneyLabel(shown)}
        </span>
      ) : null}
    </>
  );
}
