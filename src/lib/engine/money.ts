/**
 * Money the way people write it (rev 444): "3.5k", "3.5K", "$3,500", "3500 USD", "3,500.00", "1.2m" all read as the amount,
 * through Body's one parser (src/lib/engine/amount.ts). A box that can't be read says so in one plain line and is never saved
 * as 0; blank is "not entered". The currency mark is "$" until rev 432 item 9 gives each workspace its own.
 */
import { parseNumber } from "./amount";

export const MONEY_HINT = "Write the amount as a number, like 3500.";

export type MoneyRead = { value: number | null } | { error: string };

/** One money box: blank is null, a readable amount is its value (never below zero), anything else is the plain line. */
export function readMoney(typed: string | null | undefined): MoneyRead {
  const n = parseNumber(typed);
  if (n === null) return { value: null };
  // More than cents ("1.234") is a thousands point in some countries and a slip in others: asked again, never guessed.
  if (typeof n === "object" || n < 0 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { error: MONEY_HINT };
  return { value: Math.round(n * 100) / 100 };
}

/** "$3,500", "$7,500.50": what a box understood, shown under it before Save. */
export const moneyLabel = (n: number): string => `$${n.toLocaleString("en-US", n % 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
