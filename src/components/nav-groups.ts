/** The navigation model, in a plain module so both client components and server pages can read it. */
import { PLATFORMS, platformHref, type PlatformKey, type PlatformLinks } from "@/lib/platforms";
/** `line`: a one-line description shown under the label everywhere, for the two sections a client would otherwise confuse. `hint` shows on the More page only. */
/** `bodyOnly`: shown only to a member whose HumanOS is switched on (rev 195, per member); `bodyOffOnly`: the one entry shown while it's off (rev 320), leading to the switch. */
/** `recordingsOnly`: shown to a client only once a recording is published for them (Recordings R1). `clientOnly`: hidden from the coach, whose own copy sits in a coach group. */
/** `agentsOnly`: shown to a member once they have an agent of their own on the Forum or anything in their agent inbox (H-727). */
/** `team`: shown to a team member working in the owner's HelixOS (Danno, 6 Oct); everything without it is hidden from them, and closed on the server. */
/** `external`: an outbound link (the Platforms section, Danno 7 Oct): opens in a new tab with the ↗ mark, and is never the active page. */
/**
 * `comingSoon` (rev 816): a page on its way. Shown greyed with a "Coming soon" pill and its subtitle (`line`), never a link: its
 * `href` is only where it will live. The commit that ships the page drops the flag, and the item becomes a normal link.
 */
/**
 * `menuKey` (H-385): the On the horizon item that drives this entry. It reads as Coming soon until that item has shipped
 * (`withHorizon` below), then becomes a normal link; the coach moves the item, no deploy needed.
 */
/** `phase` (H-164 §12): the My Helix phase that opens the item for a client still finding their way; none means always open. */
export type NavItem = { href: string; label: string; icon: string; phase?: number; platformKey?: PlatformKey; coachOnly?: boolean; clientOnly?: boolean; passOnly?: boolean; colosseumOnly?: boolean; loyaltyOnly?: boolean; bodyOnly?: boolean; bodyOffOnly?: boolean; recordingsOnly?: boolean; oohOnly?: boolean; chatOnly?: boolean; agentsOnly?: boolean; team?: boolean; external?: boolean; comingSoon?: boolean; menuKey?: string; hint?: string; line?: string; /** Get the app (H-655): gone once the member has the app; Coming soon until a link is set (withAppLinks). */ appOffOnly?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

/** Where "Submissions to verify" opens (H-1280): the Coach view, scrolled to its Verify submissions card. */
export const VERIFY_HREF = "/coach#verify";

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Daily",
    items: [
      { href: "/today", label: "Today", icon: "☀️", team: true },
      { href: "/intentions", label: "Intentions", icon: "🌱", line: "this week and this month" },
      { href: "/tasks", label: "Tasks", icon: "✅", team: true, line: "what's on your plate" },
      { href: "/content", label: "Content", icon: "✍️", team: true, line: "write, schedule, ship" },
      { href: "/conversations", label: "DMs", icon: "💬", team: true, line: "every conversation, logged" },
      { href: "/groups", label: "Groups", icon: "🎯", hint: "top 3" },
      // The weekly calls (H-820, plan H-828): every member, in their own time; a team member sees the owner's.
      { href: "/calls", label: "Calls", icon: "📅", hint: "this week", team: true },
      // Team access (H-413): a team member books office hours for the owner and says who's attending.
      // Office Hours by program level (H-470): Academy and up, or the coach's switch; gone otherwise, no card, no prices.
      { href: "/office-hours", label: "Office Hours", icon: "🙋", hint: "Fridays", team: true, oohOnly: true },
      // The coach's chat on its own page (H-693, plan H-700): only where the chat is set up, named for the coach (withCoachName).
      { href: "/ask", label: "Ask your coach", icon: "💭", line: "chat with your coach", chatOnly: true },
      // Rewards and the Colosseum are one page with two tabs (H-164 §4); /colosseum sends to the tab. With the Colosseum on, this
      // one item becomes The Colosseum and opens on the arena (H-588, plan H-592): see withColosseum.
      { href: "/rewards", label: "Rewards", icon: "🏆", line: "points, prizes and the arena" },
      { href: "/community", label: "Community Pass", icon: "🎟️", passOnly: true, hint: "Elite" },
      // Get the app (H-655, H-731): every member's, not a team member's; Coming soon until a store link is set, gone once they have it.
      { href: "/get-the-app", label: "Get the app", icon: "📱", line: "HelixOS on your iPhone or Android", appOffOnly: true },
    ],
  },
  {
    // HumanOS (rev 238): its own section under Daily, behind the Body flag. An item joins only once its phase has shipped, so no
    // page is ever empty; a member without Body sees no section at all (a group with nothing visible isn't drawn).
    label: "HumanOS",
    items: [
      { href: "/body", label: "Log", icon: "🍽️", hint: "meals today", bodyOnly: true },
      { href: "/body/foods", label: "Nutrition", icon: "🥗", hint: "foods + meals", bodyOnly: true },
      { href: "/body/training", label: "Training", icon: "🏋️", hint: "sets + PRs", bodyOnly: true },
      { href: "/body/weight", label: "Weigh-ins", icon: "⚖️", hint: "scale + trends", bodyOnly: true },
      { href: "/body/goals", label: "Health goals", icon: "🎯", hint: "on pace?", bodyOnly: true },
      { href: "/body/sleep", label: "Sleep", icon: "🛌", hint: "last night", bodyOnly: true },
      { href: "/body/practices", label: "Practices", icon: "🧘", hint: "habits + streaks", bodyOnly: true },
      { href: "/settings?tab=programs#humanos", label: "Turn on HumanOS", icon: "🧬", line: "Food, training, sleep, practices", bodyOffOnly: true },
    ],
  },
  // The client's five groups (H-164 §10, plan H-209 §11): Daily above, then these four, closed until opened (DEFAULT_CLOSED in
  // engine/nav-state). `phase`: the My Helix phase that opens the page for a new client (§12, toolsOpenTo); Show all tools opens all.
  {
    label: "My business",
    items: [
      { href: "/essence", label: "Essence", icon: "🧬", line: "who you are and who you serve", phase: 0 },
      // Avatars is a tab inside Offers (H-164 §10): the Offers and Avatars pages share a tab row; one menu item.
      { href: "/offers", label: "Offers", icon: "🎁", line: "what you sell, and to whom", phase: 1 },
      { href: "/pathway", label: "Pathway", icon: "🛣️", line: "the stages of your business, in order", phase: 2 },
      { href: "/proof", label: "Proof Bank", icon: "🏆", line: "Your clients' results", phase: 2 },
      { href: "/goals", label: "Business goals", icon: "🏁", team: true, line: "Goals, key results, initiatives", phase: 2 },
      { href: "/numbers", label: "Numbers", icon: "📊", line: "your counts, week by week", phase: 2 },
      { href: "/clients", label: "Clients", icon: "🤝", team: true, hint: "your clients", phase: 6 },
    ],
  },
  {
    label: "Get leads",
    items: [
      { href: "/magnets", label: "Lead magnets", icon: "🧲", hint: "keyword + link", phase: 4 },
      { href: "/webinars", label: "Webinars", icon: "🎤", team: true, line: "the wizard, start to Run it", phase: 4 },
      { href: "/images", label: "Images", icon: "🖼️", team: true, line: "photos, logos, graphics", phase: 3 },
      { href: "/aqueduct", label: "The Aqueduct", icon: "🌊", line: "where your leads flow and leak", phase: 4 },
      // The loyalty leaderboard's editor (H-140): for any member whose workspace has a connected board, the owner, their team and a switched-in coach alike.
      { href: "/loyalty", label: "Loyalty leaderboard", icon: "🏅", line: "your members' points and tiers", loyaltyOnly: true, team: true, phase: 4 },
      { href: "/magic-funnel", label: "Magic funnel", icon: "🪄", line: "a personal page for every webinar sign-up", menuKey: "magic-funnel", phase: 7 },
    ],
  },
  {
    label: "My bot",
    items: [
      { href: "/my-bot", label: "Your bot", icon: "🧠", line: "What it says, and its connection", phase: 7 },
      { href: "/my-bot/skills", label: "Bot Features", icon: "🔓", team: true, line: "New skills for your bot", phase: 7 },
    ],
  },
  {
    label: "Learn",
    items: [
      { href: "/courses", label: "Courses", icon: "📚", line: "the lessons, in order" },
      { href: "/recordings", label: "Recordings", icon: "🎥", line: "your calls, with action steps", recordingsOnly: true },
      { href: "/library", label: "Library", icon: "🗂️", team: true, line: "posts and assets to reuse", phase: 3 },
      { href: "/doctrine", label: "Doctrine", icon: "🏛️", line: "the principles behind the method" },
      { href: "/evidence", label: "Evidence", icon: "📚", line: "published research" },
      { href: "/glossary", label: "Building with AI", icon: "📖", line: "the words, in plain English" },
    ],
  },
  {
    // Kept in sight as they are (H-164 §10: Danno chose No on hiding them): My Board, The Forum and a member's agent inbox.
    label: "Board and agents",
    items: [
      { href: "/my-board", label: "My Board", icon: "🧭", line: "five advisors on a decision", phase: 3 },
      // The coach finds The Forum under Agents (H-164 §7); a client keeps it here.
      { href: "/forum", label: "The Forum", icon: "🏛️", line: "watch your AI agents work", clientOnly: true },
      // A member's own Handoff inbox (H-727), once they have an agent; the coach's is Coach → Inbox, under Agents.
      { href: "/forum/inbox", label: "Agent inbox", icon: "📥", line: "your agents' plans for your OK", clientOnly: true, agentsOnly: true },
    ],
  },
  {
    label: "Socrates Domain",
    items: [
      { href: "/socrates/foundations", label: "Foundations", icon: "🧭", hint: "7 lessons", phase: 5 },
      { href: "/socrates/questions", label: "Questions", icon: "❓", hint: "library", phase: 5 },
      { href: "/socrates/reframes", label: "Reframes", icon: "🔁", hint: "the four groups", phase: 5 },
      { href: "/socrates/objections", label: "Objections", icon: "🧱", hint: "one record", phase: 5 },
      { href: "/socrates/scripts", label: "Scripts", icon: "📝", hint: "wizard", phase: 5 },
    ],
  },
  {
    // The coach's links in three groups (H-164 §7): People, Agents, Your content. A client sees none of them, so none is drawn.
    label: "People",
    items: [
      { href: "/coach", label: "Clients", icon: "🧑‍🏫", coachOnly: true, hint: "the Coach view" },
      // Client work waiting for approval (H-1280, plan H-1296): lands on the Verify submissions card; the count is the menu badge.
      { href: VERIFY_HREF, label: "Submissions to verify", icon: "✅", coachOnly: true, hint: "clients' work to approve" },
      { href: "/coach/office-hours", label: "OOH requests", icon: "🗓️", coachOnly: true, hint: "by Friday" },
      // Booking calendars reachable from the menu (H-1236, plan H-1240), not only from a button on the Coach view.
      { href: "/hermes/calendars", label: "Booking calendars", icon: "📆", coachOnly: true, hint: "the pass's two calls" },
      { href: "/coach/community", label: "Community posts", icon: "📣", coachOnly: true, hint: "Monday 3-1-3" },
      { href: "/coach/move", label: "Move to a client", icon: "📦", coachOnly: true, hint: "your items to theirs" },
      { href: "/coach/import", label: "Import from Airtable", icon: "📥", coachOnly: true, hint: "a client's base into HelixOS" },
      // The Partner Program (H-1307, plan H-1361): the coach's restaurants, touches, payments and the monthly statement.
      { href: "/coach/partners", label: "Partner Program", icon: "🍽️", coachOnly: true, hint: "restaurants, touches, payouts" },
    ],
  },
  {
    label: "Agents",
    items: [
      { href: "/coach/inbox", label: "Inbox", icon: "📬", coachOnly: true, hint: "your agents' handoffs" },
      { href: "/coach/agents", label: "Agents", icon: "🔑", coachOnly: true, hint: "tokens and connections" },
      { href: "/forum", label: "The Forum", icon: "🏛️", coachOnly: true, hint: "watch your agents work" },
      { href: "/coach/reports", label: "Issues and ideas", icon: "🛟", coachOnly: true, hint: "from members" },
      { href: "/coach/feedback", label: "Feedback", icon: "💬", coachOnly: true, hint: "monthly" },
    ],
  },
  {
    label: "Your content",
    items: [
      { href: "/coach/board", label: "Danno's principles", icon: "🧭", coachOnly: true, hint: "Board principles" },
      { href: "/coach/board-seats", label: "Board seats", icon: "🏛️", coachOnly: true, hint: "the council library" },
      { href: "/coach/glossary", label: "Glossary", icon: "📖", coachOnly: true, hint: "Building with AI" },
      { href: "/coach/frameworks", label: "Frameworks", icon: "🧩", coachOnly: true, hint: "import, then publish" },
      { href: "/coach/horizon", label: "On the horizon", icon: "🔭", coachOnly: true, hint: "what members see coming" },
      { href: "/coach/helix", label: "My Helix rungs", icon: "🌀", coachOnly: true, hint: "the 67 rungs and what each reads" },
      { href: "/coach/setup", label: "Setup steps", icon: "🧭", coachOnly: true, hint: "the 26 setup steps, the Start Here video" },
      { href: "/coach/recordings", label: "Recordings", icon: "🎥", coachOnly: true, hint: "from Fathom" },
      { href: "/integrations", label: "Integrations", icon: "🔌", coachOnly: true },
    ],
  },
  {
    // Platforms (Danno, 7 Oct): the tools a member works in beside HelixOS, outbound links only, for every role and a team member
    // too. The list is src/lib/platforms.ts; this section is drawn from it.
    label: "Platforms",
    items: PLATFORMS.map((p) => ({ href: p.href, label: p.label, icon: p.icon, line: p.line, external: true, team: true, platformKey: p.key })),
  },
];

/** Every item with an address of its own; Community (rev 843) has none until a coach sets it, so it is not here. */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items).filter((n) => n.href);

/** The Platforms items with this workspace's addresses (rev 843); one with no address (Community, until it's set) is left out. */
export function withPlatformLinks(items: NavItem[], links: PlatformLinks, ownCommunity?: string | null): NavItem[] {
  return items.flatMap((n) => {
    if (!n.platformKey) return [n];
    const href = platformHref(n.platformKey, links, ownCommunity);
    return href ? [{ ...n, href }] : [];
  });
}

/** Coming soon from the horizon (H-385): an item with a `menuKey` is greyed until that key has shipped; `shippedKeys` comes from the workspace's items. */
export function withHorizon(items: NavItem[], shippedKeys: readonly string[]): NavItem[] {
  return items.map((n) => (n.menuKey ? { ...n, comingSoon: !shippedKeys.includes(n.menuKey) } : n));
}

/** Get the app (H-731): Coming soon until Danno sets a store link (src/lib/app-links.ts), then a normal link. */
export function withAppLinks(items: NavItem[], on: boolean): NavItem[] {
  return items.map((n) => (n.appOffOnly ? { ...n, comingSoon: !on } : n));
}

/** The arena's address: the Rewards page's Colosseum tab (colosseumHref() with no section gives the same). */
export const COLOSSEUM_HREF = "/rewards?tab=colosseum";

/**
 * The Colosseum back in the menu (H-588, plan H-592): with it on for the workspace, the one Rewards item reads "🏟️ The
 * Colosseum" and opens on the arena; Rewards is a tab away at the top. Off, it stays Rewards. One item either way, in its place.
 */
export function withColosseum(items: NavItem[], on: boolean): NavItem[] {
  if (!on) return items;
  return items.map((n) => (n.href === "/rewards" ? { ...n, href: COLOSSEUM_HREF, label: "The Colosseum", icon: "🏟️", line: "the arena, points and prizes" } : n));
}

/**
 * The chat's menu item, named for the coach (H-693): "Ask Danno" for a client, "Ask your coach" without a name; the coach sees
 * it as what members see.
 */
export function withCoachName(items: NavItem[], m: Pick<NavMember, "role" | "coachFirst">): NavItem[] {
  return items.map((n) => (n.href !== "/ask" ? n : m.role === "coach" ? { ...n, line: "what members see" } : m.coachFirst ? { ...n, label: `Ask ${m.coachFirst}` } : n));
}

/** Whether a menu item is the current page: by its path alone, so The Colosseum (a tab of /rewards) is lit on both tabs. */
export function navActive(pathname: string, href: string): boolean {
  const path = href.split("?")[0];
  return pathname === path || pathname.startsWith(path + "/");
}

/** Whether a member sees a nav item: the one rule the side menu and the More page both use. */
export type NavMember = { role: "coach" | "client"; passEnabled: boolean; bodyEnabled: boolean; recordingsEnabled?: boolean; team?: boolean; colosseumOn?: boolean; loyaltyOn?: boolean; /** Office Hours by level (H-470): the account has it today. The coach always does. */ oohOn?: boolean; /** The coach's chat is set up and on for this person (H-693): never for a team member or while switched in. */ chatOn?: boolean; /** H-727: an agent of their own on the Forum, or anything in their agent inbox (agentsOnFor). */ agentsOn?: boolean; /** The coach's first name, for a client's "Ask Danno". */ coachFirst?: string | null; /** H-164 §12: the highest My Helix phase whose tools are open; null or absent, every tool (the coach, a team, Show all tools). */ toolsPhase?: number | null; /** H-655: a store link is set (Get the app is a link, not Coming soon). */ appLinks?: boolean; /** H-655: one of their phones opened the app in the last 30 days. */ hasApp?: boolean };
export const navVisible = (n: NavItem, m: NavMember): boolean =>
  (n.phase === undefined || m.toolsPhase == null || m.role === "coach" || n.phase <= m.toolsPhase) &&
  (!n.colosseumOnly || Boolean(m.colosseumOn)) &&
  (!n.loyaltyOnly || Boolean(m.loyaltyOn)) &&
  (!n.oohOnly || m.role === "coach" || Boolean(m.oohOn)) &&
  (!n.chatOnly || Boolean(m.chatOn)) &&
  (!n.agentsOnly || Boolean(m.agentsOn)) &&
  (!n.appOffOnly || !m.hasApp) &&
  (!m.team || Boolean(n.team)) && (!n.coachOnly || m.role === "coach") && (!n.clientOnly || m.role === "client") && (!n.passOnly || m.passEnabled) && (!n.bodyOnly || m.bodyEnabled) && (!n.bodyOffOnly || !m.bodyEnabled) && (!n.recordingsOnly || (m.role === "client" && Boolean(m.recordingsEnabled)));


/** The highest phase whose tools are open for this member, or null for every tool (H-164 §12). */
export const toolsPhaseOf = (m: { role: string; team?: boolean; showAllTools: boolean; toolsPhase: number }): number | null => (m.role === "coach" || m.team || m.showAllTools ? null : m.toolsPhase);

/** The pages a phase opens, for "New: … is open" on Today (H-164 §12). */
export const toolsOpenedAt = (phase: number): NavItem[] => NAV.filter((n) => n.phase === phase);

/** The groups this member sees, each with only its visible items; a group with none isn't drawn at all (HumanOS without Body). */
export function visibleGroups(m: NavMember, links: PlatformLinks = {}, ownCommunity: string | null = null, shippedKeys: readonly string[] = []) {
  return NAV_GROUPS.map((g) => ({ ...g, items: withAppLinks(withCoachName(withColosseum(withHorizon(withPlatformLinks(g.items, links, ownCommunity), shippedKeys), Boolean(m.colosseumOn)), m), Boolean(m.appLinks)).filter((n) => navVisible(n, m)) })).filter((g) => g.items.length);
}
