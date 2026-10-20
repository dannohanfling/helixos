/**
 * The filmed scene loops (H-1180, H-1253): a scene's own photo with its life moving, camera locked, first frame = last. A
 * picture plays one only when it is listed here, with the version its files carry (bump it on a same-name swap: the files are
 * cached as immutable). Files beside the photo: `{picture}-loop.mp4`, `-loop.webm` and `-loop-poster.jpg`, 1280x720.
 * Golden hour only for now; a night picture listed here would play the same way.
 */
export const SCENE_LOOPS: Readonly<Record<string, number>> = {
  "/aqueduct/aqueduct-day-none": 1,
  "/forum/forum-day": 1,
  // A stand-in until Scriba's redo (smaller, distant birds) lands under the same names with the version bumped.
  "/colosseum/colosseum-day": 1,
};

export type SceneLoop = { mp4: string; webm: string; poster: string };

export function loopFor(picture: string): SceneLoop | null {
  const v = SCENE_LOOPS[picture];
  return v ? { mp4: `${picture}-loop.mp4?v=${v}`, webm: `${picture}-loop.webm?v=${v}`, poster: `${picture}-loop-poster.jpg?v=${v}` } : null;
}
