"use client";

/**
 * What every living scene shares (H-327): a device asking for reduced motion gets the finished state, and a hidden tab pauses
 * every animation. Both read through useSyncExternalStore so the server's render and the first client render agree.
 */
import { useSyncExternalStore } from "react";

const MOTION = "(prefers-reduced-motion: reduce)";
/**
 * The member's own "Scene motion" switch (Roma Vivit 2 PR 6, H-1060): off draws every scene still, exactly as when the device
 * asks for reduced motion. The layout primes it before the scenes render (SceneMotionConfig), so the first client render already
 * knows it.
 */
let motionOn = true;
const motionSubs = new Set<() => void>();
/** Sets the switch without telling anyone: for the first render, before any scene reads it. */
export function primeSceneMotion(on: boolean): void {
  motionOn = on;
}
/** Sets the switch and lets every scene know. */
export function setSceneMotion(on: boolean): void {
  if (motionOn === on) return;
  motionOn = on;
  motionSubs.forEach((cb) => cb());
}
/** Calls back when the device setting or the member's switch changes. */
export const onStillChange = (cb: () => void) => {
  const q = window.matchMedia(MOTION);
  q.addEventListener("change", cb);
  motionSubs.add(cb);
  return () => {
    q.removeEventListener("change", cb);
    motionSubs.delete(cb);
  };
};
/** True when the scenes should keep still: the device asks for reduced motion, or the member turned Scene motion off. */
export const keepStill = () => !motionOn || window.matchMedia(MOTION).matches;
/** keepStill as a hook; false on the server and until hydration. */
export const useQuiet = (): boolean => useSyncExternalStore(onStillChange, keepStill, () => false);

const subscribeHidden = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
const readHidden = () => document.visibilityState === "hidden";
/** True while the tab is hidden: the scene adds `sc-paused` and every animation holds. */
export const useHidden = (): boolean => useSyncExternalStore(subscribeHidden, readHidden, () => false);
