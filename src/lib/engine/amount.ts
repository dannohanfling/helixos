/**
 * Amounts the way people write them (handoff rev 444): "3.5k", "1.2m", "$3,500", "3,500.00", "70 kg", "154 lb", "500 ml". One
 * parser for every form, pure and shared, so a money box and a weigh-in read a typed number the same way. It reads the number,
 * a thousand or million word after it, and whatever unit follows; what the unit means is the caller's (a money box refuses
 * "kg", a weigh-in converts "154 lb" to the member's unit). Nothing is guessed: text that isn't one amount is an error, never 0.
 */
export type Amount = { value: number; unit: string | null };
export type AmountRead = Amount | { error: string } | null;

/** Currency marks in front of (or after) a number: read and dropped; the caller knows the currency. */
const CURRENCY = /^(?:[A-Z]{0,3}\$|€|£|¥|₹|aud|usd|nzd|cad|eur|gbp)\s*|\s*(?:€|£|aud|usd|nzd|cad|eur|gbp)$/i;
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mil: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/**
 * The number in `digits`: "3,500" and "3,500.00" are thousands; "2,5" (one comma, not three digits after it, no point) is the
 * decimal comma metric members type; a space or apostrophe between thousands ("3 500", "3'500") is read too.
 */
function readNumber(digits: string): number | null {
  let d = digits.replace(/['  ]/g, "").replace(/(\d) (?=\d{3}\b)/g, "$1");
  if (/^-?\d+,\d{1,2}$/.test(d) || /^-?\d+,\d{4,}$/.test(d)) d = d.replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(d)) d = d.replace(/,/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(d)) return null;
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}

/** Blank is null ("not entered" is not zero); one amount is `{ value, unit }`; anything else says what it couldn't read. */
export function parseAmount(text: string | null | undefined): AmountRead {
  const t = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  const bare = t.replace(CURRENCY, "").trim();
  const m = /^(-?[\d.,'   ]*\d|-?\.\d+)\s*([a-z]*)\.?\s*(.*)$/i.exec(bare);
  if (!m) return { error: `"${t}" isn't a number.` };
  const n = readNumber(m[1].trim());
  if (n == null) return { error: `"${t}" isn't a number.` };
  let word = m[2].toLowerCase();
  const rest = m[3].trim();
  let value = n;
  // "3.5k", "1.2m", "2 million": a scale word with nothing after it, or before the unit ("1.2k kcal").
  if (word && SCALE[word] != null && (!rest || /^[a-z]/i.test(rest))) {
    value = n * SCALE[word];
    word = "";
  }
  const unit = [word, rest].filter(Boolean).join(" ").trim().toLowerCase() || null;
  return { value: Math.round(value * 1e6) / 1e6, unit };
}

/** A plain number from a box that takes no unit (money, counts, reps): "$3,500" → 3500; "3.5k" → 3500; "70 kg" is refused. */
export function parseNumber(typed: string | null | undefined): number | null | { error: string } {
  const a = parseAmount(typed);
  if (a == null || "error" in a) return a;
  if (a.unit) return { error: `Just the number here, without "${a.unit}".` };
  return a.value;
}
