/**
 * Settings in tabs (H-164 §16, plan H-209 item 18): six for a member, in Danno's order, and a seventh, Coach, for the coach.
 * Every card moves whole into one tab; an old link to /settings#<card> still lands, because the card's anchor names its tab.
 */
export const SETTINGS_TABS = [
  { key: "you", label: "You" },
  { key: "connections", label: "Connections" },
  { key: "bot", label: "Your bot" },
  { key: "brand", label: "Brand and team" },
  { key: "programs", label: "Programs" },
  { key: "data", label: "Data and privacy" },
  { key: "coach", label: "Coach" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** The tab each card's anchor lives in. Anchors not listed (and no anchor at all) open You. */
export const TAB_OF_ANCHOR: Record<string, SettingsTab> = {
  you: "you",
  goal: "you",
  photo: "you",
  menu: "you",
  sounds: "you",
  welcome: "you",
  setup: "you",
  "login-email": "you",
  blocked: "you",
  "your-reports": "you",
  publishing: "connections",
  "community-loyalty": "connections",
  ai: "connections",
  fathom: "connections",
  "connected-apps": "connections",
  "linked-chats": "connections",
  assistant: "connections",
  "your-bot": "bot",
  "bot-connection": "bot",
  "brand-kit": "brand",
  brand: "brand",
  team: "brand",
  "magic-funnel": "programs",
  humanos: "programs",
  "board-in-claude": "programs",
  forum: "programs",
  leaderboard: "programs",
  account: "data",
  storage: "data",
  "your-coach": "data",
  workspace: "coach",
  invites: "coach",
  calls: "coach",
};

/** The tabs a viewer sees: the coach's own tab for the coach only. */
export function tabsFor(role: string): { key: SettingsTab; label: string }[] {
  return SETTINGS_TABS.filter((t) => t.key !== "coach" || role === "coach").map((t) => ({ key: t.key, label: t.label }));
}

/** The tab to show: the one asked for if this viewer has it, else You. */
export function tabFor(raw: string | undefined, role: string): SettingsTab {
  return tabsFor(role).find((t) => t.key === raw)?.key ?? "you";
}

/** Where an old /settings#anchor belongs, or null when You (the default) already holds it or it names nothing. */
export function tabOfAnchor(anchor: string): SettingsTab | null {
  const t = TAB_OF_ANCHOR[anchor];
  return t && t !== "you" ? t : null;
}
