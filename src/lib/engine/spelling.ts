/**
 * How a member's AI drafts spell (H-811, 18 Oct): American by default, or British and New Zealand. A brand kit setting; with
 * uk_nz every system message carries one line saying so, essence or not. Pure.
 */
export const SPELLINGS = ["us", "uk_nz"] as const;
export type Spelling = (typeof SPELLINGS)[number];
export const SPELLING_LABELS: Record<Spelling, string> = { us: "American", uk_nz: "British and New Zealand" };
export const UK_NZ_LINE = "Write in British and New Zealand English spelling (colour, organise, programme).";

/** What a form or a row says, read safely: anything but "uk_nz" is American. */
export const parseSpelling = (v: unknown): Spelling => (v === "uk_nz" ? "uk_nz" : "us");
/** The one line a system message carries for this spelling, or null for American (the models' own default). */
export const spellingLine = (s: Spelling | null | undefined): string | null => (s === "uk_nz" ? UK_NZ_LINE : null);
