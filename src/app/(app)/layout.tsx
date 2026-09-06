import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireViewer } from "@/lib/auth";
import { streakFor } from "@/lib/queries/daily";
import { totalPoints } from "@/lib/queries/points";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  const [points, streak] = await Promise.all([totalPoints(viewer.user.id), streakFor(viewer.user.id, viewer.today)]);
  return (
    <AppShell viewer={viewer} points={points} streak={streak.running}>
      {children}
    </AppShell>
  );
}
