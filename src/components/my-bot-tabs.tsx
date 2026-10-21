import { Tabs } from "@/components/ui";

export type MyBotTab = "says" | "skills" | "connection";

/**
 * My bot as one page (H-164 §15): what it says, its skills and its connection, as three tabs. A team member reaches the skills
 * only, so only that tab shows for them.
 */
export function MyBotTabs({ current, team = false }: { current: MyBotTab; team?: boolean }) {
  const items = [
    { key: "says", label: "What it says", href: "/my-bot" },
    { key: "skills", label: "Skills", href: "/my-bot/skills" },
    { key: "connection", label: "Connection", href: "/my-bot/connection" },
  ].filter((t) => !team || t.key === "skills");
  return (
    <div data-testid="my-bot-tabs">
      <Tabs current={current} items={items} />
    </div>
  );
}
