"use client";

/**
 * What every living scene shares (H-327): a device asking for reduced motion gets the finished state, and a hidden tab pauses
 * every animation. Both read through useSyncExternalStore so the server's render and the first client render agree.
 */
import { useSyncExternalStore } from "react";

const MOTION = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const q = window.matchMedia(MOTION);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
};
const readMotion = () => window.matchMedia(MOTION).matches;
/** True when the member asked for reduced motion; false on the server and until hydration. */
export const useQuiet = (): boolean => useSyncExternalStore(subscribeMotion, readMotion, () => false);

const subscribeHidden = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
const readHidden = () => document.visibilityState === "hidden";
/** True while the tab is hidden: the scene adds `sc-paused` and every animation holds. */
export const useHidden = (): boolean => useSyncExternalStore(subscribeHidden, readHidden, () => false);
