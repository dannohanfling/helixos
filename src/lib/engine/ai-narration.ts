/**
 * What the app says while an AI call runs. Each line names a real step of that feature's prompt, in order, and the last
 * line holds until the response lands. Honest narration, not theatre: no ellipsis animation, no invented percentages.
 * Copy is Danno's to approve; these are the starting point.
 */
export const NARRATION: Record<string, string[]> = {
  ladder: ["Reading your brief.", "Checking your proof and real numbers.", "Choosing the shape for this format.", "Writing the body, then the rungs.", "Checking every claim against what you gave it."],
  webinar_section: ["Reading your offer and your audience.", "Finding the beliefs this section has to move.", "Drafting the section.", "Tightening it to the act it sits in."],
  composer_polish: ["Reading your draft.", "Shaping it for each channel.", "Keeping your voice, cutting the padding."],
  repurpose: ["Reading the original.", "Finding what carries over.", "Rewriting for the new format."],
  group_variant: ["Reading the group's rules and tone.", "Adjusting your draft to fit.", "Checking nothing breaks their guidelines."],
  principle_content: ["Reading the principle.", "Drafting the post, the reel and the training."],
  harvest: ["Reading the recording you picked.", "Finding where your client describes a result.", "Checking every quote against the transcript, word for word.", "Saving what holds up as drafts."],
};

/** How long each line stays before the next. Long calls sit on the last line; short ones may never leave the first. */
export const NARRATION_STEP_MS = 2500;

/** With no Essence there is no voice to keep: a line that claims one is cut, never reworded. */
export function narrationFor(feature: string, voiceReady: boolean): string[] {
  const lines = NARRATION[feature] ?? [];
  return voiceReady ? lines : lines.filter((l) => !/your voice/i.test(l));
}

/** The line to show after `elapsedMs` in flight. With reduced motion only the first line ever shows. */
export function narrationLine(feature: string, elapsedMs: number, reducedMotion = false, voiceReady = true): string | null {
  const lines = narrationFor(feature, voiceReady);
  if (!lines?.length) return null;
  if (reducedMotion) return lines[0];
  return lines[Math.min(lines.length - 1, Math.max(0, Math.floor(elapsedMs / NARRATION_STEP_MS)))];
}
