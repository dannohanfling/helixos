"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Whether the signed-in client has any Essence filled in. Set once in the app layout; read wherever a ✨ action explains itself. */
const VoiceContext = createContext<{ ready: boolean; filled: number; total: number }>({ ready: true, filled: 0, total: 14 });

export function VoiceProvider({ ready, filled, total, children }: { ready: boolean; filled: number; total: number; children: ReactNode }) {
  return <VoiceContext.Provider value={{ ready, filled, total }}>{children}</VoiceContext.Provider>;
}
export const useVoice = () => useContext(VoiceContext);
