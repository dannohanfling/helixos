/**
 * Time zones (H-457): every IANA zone for the Settings picker, a typed zone checked and written the way the zone database
 * writes it, and whether the one-time "We're showing times in {zone}" line is due. Pure; the server and the browser share it.
 */

/** A zone as the zone database writes it ("australia/sydney" → "Australia/Sydney"), or null when it isn't one. Never an offset. */
export function canonicalZone(tz: string | null | undefined): string | null {
  const t = (tz ?? "").trim();
  if (!t || /^[+-]?\d/.test(t) || /^(GMT|UTC)[+-]/i.test(t)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: t }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Every zone the runtime knows, A to Z, with UTC; the saved one first when the list somehow lacks it. */
export function allZones(saved?: string | null): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    list = [];
  }
  const out = new Set([...list, "UTC"]);
  const sorted = [...out].sort((a, b) => a.localeCompare(b));
  return saved && !out.has(saved) ? [saved, ...sorted] : sorted;
}

/**
 * The one-time line is for a member who never chose a zone: their own sign-in only (never a coach switched in, never a team
 * member), until they dismiss it or save their zone in Settings.
 */
export function zoneNoticeDue(v: { switchedInto: unknown; team: unknown; membership: { tzPromptSeenAt: string | null } }): boolean {
  return !v.switchedInto && !v.team && !v.membership.tzPromptSeenAt;
}

/** The line itself: the zone with its short name, and what to do about it. `fromWorkspace` when the browser named none. */
export function zoneNoticeText(zone: string, short: string, fromWorkspace: boolean): string {
  const named = short && short !== zone ? `${zone} (${short})` : zone;
  return fromWorkspace
    ? `We're showing times in ${named}, your coach's zone, because your browser didn't tell us yours. Change it in Settings.`
    : `We're showing times in ${named}. Change it in Settings.`;
}
