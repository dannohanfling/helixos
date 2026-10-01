/** Day flags (rev 237 phase 15, revs 196/231): a day marked travelling or ill. Patterns can leave such days out; nothing else reads them. */
export const DAY_FLAGS = ["travel", "illness"] as const;
export type DayFlag = (typeof DAY_FLAGS)[number];
export const FLAG_LABEL: Record<DayFlag, string> = { travel: "Travelling", illness: "Ill" };
export const FLAG_ICON: Record<DayFlag, string> = { travel: "✈️", illness: "🤒" };
export const isDayFlag = (s: string): s is DayFlag => (DAY_FLAGS as readonly string[]).includes(s);
/** "✈️ Travelling" for a flagged day, "" for none. */
export const flagText = (f: string | null | undefined): string => (f && isDayFlag(f) ? `${FLAG_ICON[f]} ${FLAG_LABEL[f]}` : "");
