/**
 * Rung numbers (H-1944, plan H-1947). A rung's body is stored without its number; the number is its place in the ladder and
 * is added wherever the text is shown, copied or sent: "1. You taught for an hour." on the same line as the first sentence.
 * A number already at the start ("1." "1)" "1\." or "1/", followed by a space or the end) is taken off first, so it is never
 * doubled and "1/" becomes "1.". Only the very start of the rung is touched: steps inside it ("1)" "2)" on later lines) stay.
 */
const LEADING_NUMBER = /^\s*\d{1,2}\s*(?:\\?[.)]|\/)(?=\s|$)\s*/;

export function numberRung(body: string, position: number): string {
  return `${position}. ${body.replace(LEADING_NUMBER, "").trimStart()}`;
}

/** Every rung numbered by its place, 1, 2, 3, whatever numbers the bodies carried. */
export function numberRungs(bodies: readonly string[]): string[] {
  return bodies.map((b, i) => numberRung(b, i + 1));
}
