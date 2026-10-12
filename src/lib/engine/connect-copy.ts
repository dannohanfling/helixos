/**
 * "Connect your tools" (rev 850, with revs 846 and 849): the words for both steps, in one place so Danno can edit them, and the
 * plain errors each test call can give. Danno's copy as written (12 Oct); the GoHighLevel permission list itself is the one in
 * src/lib/engine/ghl-scopes.ts, never repeated here.
 */

export type ConnectCopy = { title: string; intro: string; boxHeading: string; boxLead?: string; steps: (string | string[])[]; after: string };

export const GHL_COPY: ConnectCopy = {
  title: "🚀 GoHighLevel (posting for you)",
  intro: "Connect your own GoHighLevel once. Posts you schedule in HelixOS land in your Social Planner and go out on their own. Your key is encrypted and only ever used for your account.",
  boxHeading: "Make the key while signed in to your own GoHighLevel.",
  steps: [
    "Sign in to GoHighLevel and open your account (your business name, top left).",
    "Go to Settings → Private Integrations, then Create new integration.",
    "Name it HelixOS. On the permissions screen, tick every item in the list below. Use Copy the list if it helps.",
    "Create it, then copy the key straight away. GoHighLevel shows it only once.",
    "Paste it below and press Connect. HelixOS makes one small test call and tells you right away if it worked.",
  ],
  after: "Don't email or text your key to anyone, including your coach. If you get stuck, book Office Hours and we'll do it together on screen.",
};

export const CL_COPY: ConnectCopy = {
  title: "🤖 Community Loyalty (your bot)",
  intro: "Connect your own Community Loyalty bot once. HelixOS can then post your comment ladder replies, answer FAQs from your Essence, and log leads your bot talks to. Your key is encrypted and only ever used for your workspace.",
  boxHeading: "Make the key while signed in as yourself.",
  boxLead: "Your key comes from your own Community Loyalty login, the account that owns your workspace. Danno can't make it for you.",
  steps: [
    "Sign in to Community Loyalty.",
    "Click your name in the top right, then API Keys.",
    ["Under Create API Token:", "Token Name: HelixOS", "Leave Manage Team and Manage Flow ticked.", "Workspace: your workspace", "Bot: your bot"],
    "Create it. Then press the copy button beside the new HelixOS token in the list below.",
    "Paste it here and press Connect. HelixOS makes one tiny test call so you know right away if it works.",
  ],
  after: "Don't email or text your key to anyone. If you get stuck, book Office Hours and we'll do it together on screen.",
};

/** The help under each field once Community Loyalty is connected (rev 849 §2). */
export const CL_HELP = {
  agent: "In Community Loyalty: open your bot → AI Hub → the agent that answers questions.",
  contact: "In Community Loyalty: open your bot → Bot Users → find yourself → copy the ID under your name.",
  faqField: "Leave blank unless Danno gave you one. Blank uses ai_faq_cbf.",
};

/** The GoHighLevel help once connected (rev 850 §3). */
export const GHL_HELP = {
  location: "In GoHighLevel: Settings → Business Profile → Location ID (it has a copy button).",
  user: "In GoHighLevel: Settings → My Staff → you → User ID.",
  noPages: "No Facebook Page or Instagram is connected in your Social Planner yet. In GoHighLevel: Marketing → Social Planner → connect your Facebook Page and Instagram. That's your own Facebook login.",
};

/** The plain errors (rev 850 §3, rev 849 §3, rev 846 §2): no codes, what to do next. */
export const CONNECT_ERRORS = {
  ghlBadKey: "That key didn't work. Make a new one and copy it straight away.",
  ghlMissing: (scope: string) => `Your key is missing one permission: ${scope}. Make a new key with everything in the list ticked.`,
  ghlWrongUser: "That user doesn't own your connected pages. Pick the one that does.",
  clBadKey: "Community Loyalty didn't accept that key. Copy it again from API Keys.",
  clPlan: "Community Loyalty refused the key, which usually means your plan doesn't include API access. Ask Danno about upgrading, then try again.",
  clUnreachable: "Community Loyalty didn't answer just now. Try again in a minute.",
  clContactShape: "That doesn't look like a Community Loyalty contact ID. Copy it again from Bot Users, under your name.",
};

/** The Community Loyalty test call's answer, as words: 401 is a bad key, 402 or 403 the plan, anything else unreachable. */
export function clRefusal(status: number | null): string {
  if (status === 401) return CONNECT_ERRORS.clBadKey;
  if (status === 402 || status === 403) return CONNECT_ERRORS.clPlan;
  return CONNECT_ERRORS.clUnreachable;
}

/** A Community Loyalty contact ID (user_ns): letters, digits, underscores and hyphens, 4 to 40 long. */
export const isClContactId = (s: string) => /^[A-Za-z0-9_-]{4,40}$/.test(s.trim());

/** The agent a fresh connection points at: the one named for FAQs, else the only one, else none (the member picks). */
export function defaultClAgent(agents: { ns: string; name: string }[]): string {
  const faq = agents.find((a) => /\bfaqs?\b/i.test(a.name));
  if (faq) return faq.ns;
  return agents.length === 1 ? agents[0].ns : "";
}

/** The Community Loyalty card's answers, carried in the address after a connect or a save (a code, never the key). */
export const CL_NOTICE: Record<string, string> = {
  badkey: CONNECT_ERRORS.clBadKey,
  plan: CONNECT_ERRORS.clPlan,
  unreachable: CONNECT_ERRORS.clUnreachable,
  contact: CONNECT_ERRORS.clContactShape,
  empty: "Paste your key first.",
};
export const clNoticeCode = (error: string): string => Object.entries(CL_NOTICE).find(([, v]) => v === error)?.[0] ?? "unreachable";

/** How far along a member is: GoHighLevel and Community Loyalty, each connected or not. */
export function connectProgress(o: { ghl: boolean; cl: boolean }): { done: number; total: 2; line: string } {
  const done = Number(o.ghl) + Number(o.cl);
  return { done, total: 2, line: `${done} of 2 connected` };
}

/**
 * What stands between a member and their posts going out on their own (rev 850), each with where to fix it. Read by the
 * composer's "What's holding this up"; Ship has its own per-step reasons with the same links. A team member posts as the
 * owner and sees none of this.
 */
export function publishBlockers(conn: { accounts: unknown[]; lastError: string | null; ghlUserId: string | null; mediaScopeMissingAt?: string | null; connectedAt?: string | null } | null): { what: string; fix: { href: string; label: string } }[] {
  const settings = { href: "/settings#publishing", label: "Fix it on Settings" };
  if (!conn) return [{ what: "GoHighLevel isn't connected, so scheduled posts wait for you to copy and paste them.", fix: { href: "/connect-tools#publishing", label: "Connect GoHighLevel" } }];
  if (conn.lastError) return [{ what: `GoHighLevel refused the last check: ${conn.lastError}`, fix: settings }];
  if (!conn.accounts.length) return [{ what: GHL_HELP.noPages, fix: settings }];
  const out: { what: string; fix: { href: string; label: string } }[] = [];
  if (!conn.ghlUserId?.trim()) out.push({ what: "Pick which GoHighLevel user you are. The Social Planner won't take a post without it.", fix: settings });
  if (conn.mediaScopeMissingAt) out.push({ what: "Your key is missing one permission: medias.write. Pictures can't go with your posts until you make a new key.", fix: settings });
  return out;
}
