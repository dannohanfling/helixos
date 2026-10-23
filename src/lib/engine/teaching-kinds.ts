/** The story bank's kinds and statuses (rev 615 plan, rev 618 answers), with no imports, so the schema and the pages share them. */
/** "character" (H-1441): a fact-checked underdog story about a famous person, told about them, never as Danno's own. */
export const STORY_TYPES = ["story", "framework", "number", "line", "client_result", "analogy", "character"] as const;
export type StoryType = (typeof STORY_TYPES)[number];
/** The story bank's type names as the Teaching library shows them. */
export const STORY_TYPE_WORDS: Record<StoryType, string> = { story: "Story", framework: "Framework", number: "Number", line: "Line", client_result: "Client result", analogy: "Analogy", character: "Character stories" };
export const STORY_STATUSES = ["ready", "check", "needs_permission"] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];
export const STATUS_WORDS: Record<StoryStatus, string> = { ready: "Ready", check: "Check before using", needs_permission: "Needs permission" };
export const MATERIAL_KINDS = ["teaching", "story", "framework"] as const;
/** A framework (H-1262): a draft is the coach's alone; published ones reach members and the ladder writer. */
export const FRAMEWORK_STATUSES = ["draft", "published"] as const;
export type FrameworkStatus = (typeof FRAMEWORK_STATUSES)[number];
/**
 * How a character story is told (H-1441): about that person, in the third person, never as the writer's or the member's own
 * experience; the facts and any "Careful:" note as written; no quote beyond its Exact words.
 */
export const CHARACTER_RULE =
  "How to tell it: a true story about that person, in the third person (\"Michael Jordan was left off varsity…\"), never as your own experience or the member's. Keep the facts and any \"Careful:\" note as written. Quote nothing but its Exact words.";
