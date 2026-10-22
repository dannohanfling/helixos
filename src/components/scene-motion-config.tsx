"use client";

import { useEffect } from "react";
import { primeSceneMotion, setSceneMotion } from "@/components/scene-life";
import "@/components/scene-motion.css";

/**
 * Carries the member's "Scene motion" switch (Settings, Roma Vivit 2 PR 6) into the scenes. Rendered before the page, so the
 * scenes' first client render already reads it; the effect tells any scene already drawn and marks the page for the styles that
 * hold the scenes' CSS motion. Renders nothing.
 */
export function SceneMotionConfig({ on }: { on: boolean }) {
  if (typeof window !== "undefined") primeSceneMotion(on);
  useEffect(() => {
    setSceneMotion(on);
    document.documentElement.dataset.sceneMotion = on ? "on" : "off";
  }, [on]);
  return null;
}
