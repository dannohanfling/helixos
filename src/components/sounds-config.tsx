"use client";

import { useEffect } from "react";
import { armSounds, setSoundsOn } from "@/lib/sounds";

/** Carries the member's sounds switch (Settings) into the sounds module, and arms the gesture listeners. Renders nothing. */
export function SoundsConfig({ on }: { on: boolean }) {
  useEffect(() => {
    setSoundsOn(on);
    armSounds();
  }, [on]);
  return null;
}
