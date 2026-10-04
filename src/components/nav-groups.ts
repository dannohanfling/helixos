/** The navigation model, in a plain module so both client components and server pages can read it. */
/** `line`: a one-line description shown under the label everywhere, for the two sections a client would otherwise confuse. `hint` shows on the More page only. */
/** `bodyOnly`: shown only to a member whose HumanOS is switched on (rev 195, per member); `bodyOffOnly`: the one entry shown while it's off (rev 320), leading to the switch. */
/** `recordingsOnly`: shown to a client only once a recording is published for them (Recordings R1). */
export type NavItem = { href: string; label: string; icon: string; coachOnly?: boolean; passOnly?: boolean; bodyOnly?: boolean; bodyOffOnly?: boolean; recordingsOnly?: boolean; hint?: string; line?: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Daily",
    items: [
      { href: "/today", label: "Today", icon: "☀️" },
      { href: "/intentions", label: "Intentions", icon: "🌱", hint: "week + month" },
      { href: "/tasks", label: "Tasks", icon: "✅" },
      { href: "/content", label: "Content", icon: "✍️", hint: "post + repurpose" },
      { href: "/library", label: "Library", icon: "🗂️", hint: "swipes + hooks" },
      { href: "/conversations", label: "DMs", icon: "💬" },
      { href: "/groups", label: "Groups", icon: "🎯", hint: "top 3" },
      { href: "/office-hours", label: "Office Hours", icon: "🙋", hint: "Fridays" },
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
      { href: "/body/sleep", label: "Sleep", icon: "🛌", hint: "last night", bodyOnly: true },
      { href: "/body/practices", label: "Practices", icon: "🧘", hint: "habits + streaks", bodyOnly: true },
      { href: "/settings#humanos", label: "Turn on HumanOS", icon: "🧬", line: "Food, training, sleep, practices", bodyOffOnly: true },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/webinars", label: "Webinars", icon: "🎤", hint: "wizard" },
      { href: "/images", label: "Images", icon: "🖼️", line: "Your deck pictures" },
      { href: "/brain", label: "Your bot", icon: "🧠", line: "What your bot is sent" },
      { href: "/offers", label: "Offers", icon: "🎁", hint: "wizard" },
      { href: "/pathway", label: "Pathway", icon: "🛣️" },
      { href: "/courses", label: "Courses", icon: "📚" },
      { href: "/recordings", label: "Recordings", icon: "🎥", line: "Your coaching calls", recordingsOnly: true },
      { href: "/doctrine", label: "Doctrine", icon: "🏛️", hint: "principles" },
      { href: "/essence", label: "Essence", icon: "🧬", hint: "your voice" },
      { href: "/proof", label: "Proof Bank", icon: "🏆", line: "Your clients' results" },
      { href: "/evidence", label: "Evidence", icon: "📚", line: "Published research" },
      { href: "/magnets", label: "Lead magnets", icon: "🧲", hint: "keyword + link" },
    ],
  },
  {
    label: "Socrates Domain",
    items: [
      { href: "/socrates/foundations", label: "Foundations", icon: "🧭", hint: "7 lessons" },
      { href: "/socrates/questions", label: "Questions", icon: "❓", hint: "library" },
      { href: "/socrates/reframes", label: "Reframes", icon: "🔁", hint: "the four groups" },
      { href: "/socrates/objections", label: "Objections", icon: "🧱", hint: "one record" },
      { href: "/socrates/scripts", label: "Scripts", icon: "📝", hint: "wizard" },
    ],
  },
  {
    label: "Grow",
    items: [
      { href: "/clients", label: "Clients", icon: "🤝", hint: "your clients" },
      { href: "/community", label: "Community Pass", icon: "🎟️", passOnly: true, hint: "Elite" },
      { href: "/numbers", label: "Numbers", icon: "📊" },
      { href: "/rewards", label: "Rewards", icon: "🏆" },
      { href: "/coach", label: "Coach", icon: "🧑‍🏫", coachOnly: true },
      { href: "/coach/office-hours", label: "OOH requests", icon: "🗓️", coachOnly: true, hint: "by Friday" },
      { href: "/coach/feedback", label: "Feedback", icon: "💬", coachOnly: true, hint: "monthly" },
      { href: "/coach/reports", label: "Issues and ideas", icon: "🛟", coachOnly: true, hint: "from members" },
      { href: "/coach/community", label: "Community posts", icon: "📣", coachOnly: true, hint: "Monday 3-1-3" },
      { href: "/coach/move", label: "Move to a client", icon: "📦", coachOnly: true, hint: "your items to theirs" },
      { href: "/coach/import", label: "Import from Airtable", icon: "📥", coachOnly: true, hint: "a client's base into HelixOS" },
      { href: "/coach/recordings", label: "Recordings", icon: "🎥", coachOnly: true, hint: "from Fathom" },
      { href: "/integrations", label: "Integrations", icon: "🔌", coachOnly: true },
      { href: "/whats-new", label: "What's new", icon: "✨", hint: "latest changes" },
      { href: "/connect", label: "Connect to Claude", icon: "🔌", hint: "HelixOS from a chat" },
    ],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Whether a member sees a nav item: the one rule the side menu and the More page both use. */
export type NavMember = { role: "coach" | "client"; passEnabled: boolean; bodyEnabled: boolean; recordingsEnabled?: boolean };
export const navVisible = (n: NavItem, m: NavMember): boolean =>
  (!n.coachOnly || m.role === "coach") && (!n.passOnly || m.passEnabled) && (!n.bodyOnly || m.bodyEnabled) && (!n.bodyOffOnly || !m.bodyEnabled) && (!n.recordingsOnly || (m.role === "client" && Boolean(m.recordingsEnabled)));

