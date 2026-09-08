/** The navigation model, in a plain module so both client components and server pages can read it. */
export type NavItem = { href: string; label: string; icon: string; coachOnly?: boolean; passOnly?: boolean; hint?: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Daily",
    items: [
      { href: "/today", label: "Today", icon: "☀️" },
      { href: "/tasks", label: "Tasks", icon: "✅" },
      { href: "/content", label: "Content", icon: "✍️", hint: "post + repurpose" },
      { href: "/library", label: "Library", icon: "🗂️", hint: "swipes + hooks" },
      { href: "/conversations", label: "DMs", icon: "💬" },
      { href: "/groups", label: "Groups", icon: "🎯", hint: "top 3" },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/webinars", label: "Webinars", icon: "🎤", hint: "wizard" },
      { href: "/offers", label: "Offers", icon: "🎁", hint: "wizard" },
      { href: "/pathway", label: "Pathway", icon: "🛣️" },
      { href: "/courses", label: "Courses", icon: "📚" },
      { href: "/doctrine", label: "Doctrine", icon: "🏛️", hint: "principles" },
      { href: "/proof", label: "Proof Bank", icon: "🏆" },
    ],
  },
  {
    label: "Socrates Domain",
    items: [
      { href: "/socrates/foundations", label: "Foundations", icon: "🧭", hint: "7 lessons" },
      { href: "/socrates/questions", label: "Questions", icon: "❓", hint: "library" },
      { href: "/socrates/reframes", label: "Reframes", icon: "🔁", hint: "objections" },
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
      { href: "/integrations", label: "Integrations", icon: "🔌", coachOnly: true },
    ],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

