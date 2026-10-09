/** The story bank's kinds and statuses (rev 615 plan, rev 618 answers), with no imports, so the schema and the pages share them. */
export const STORY_TYPES = ["story", "framework", "number", "line", "client_result", "analogy"] as const;
export type StoryType = (typeof STORY_TYPES)[number];
export const STORY_STATUSES = ["ready", "check", "needs_permission"] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];
export const STATUS_WORDS: Record<StoryStatus, string> = { ready: "Ready", check: "Check before using", needs_permission: "Needs permission" };
export const MATERIAL_KINDS = ["teaching", "story"] as const;
