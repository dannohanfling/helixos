/**
 * Building with AI: the words (rev 768). A plain-English glossary of how AI agents build software, for every member: Danno's
 * words as seeded, under their four headings. A coach edits, adds or hides an entry on Coach → Glossary; this list is what shows
 * until then, and what an entry goes back to. Slugs are the #links; they never change once shipped.
 */
export type GlossarySeedEntry = { slug: string; term: string; meaning: string };
export type GlossarySection = { heading: string; entries: GlossarySeedEntry[] };

export const GLOSSARY_SEED: GlossarySection[] = [
  {
    heading: "How a change gets built",
    entries: [
      { slug: "brief", term: "Brief", meaning: "the written description of what you want built. The clearer the brief, the better the result." },
      { slug: "plan", term: "Plan", meaning: "the agent's short reply saying what it will build and where, before it starts. Your chance to say yes or change it." },
      { slug: "build", term: "Build", meaning: "the agent writing the new code on its own working copy. Nothing your customers see changes yet." },
      { slug: "the-gate", term: "The gate (tests)", meaning: "an automatic checklist the agent runs before anything goes live. Does everything that worked yesterday still work? Does the new part do what you asked? If any check fails, nothing goes out until it's fixed. \"Waiting for the gate\" means \"built, now in the safety check\"." },
      { slug: "bug", term: "Bug", meaning: "something that doesn't work the way it should. The gate is there to catch them early." },
      { slug: "dry-run", term: "Dry run", meaning: "a practice run that only counts what would change and changes nothing. You see the numbers, then decide." },
    ],
  },
  {
    heading: "Saving and going live",
    entries: [
      { slug: "repository", term: "Repository (repo)", meaning: "the one place all the code for a project is kept, usually on GitHub. Think of it as the master filing cabinet." },
      { slug: "commit-or-push", term: "Commit, or push", meaning: "saving a finished change to the repo. Each one gets a short code like 5530bfb, which is just that version's name, so you can always point at exactly what changed." },
      { slug: "branch", term: "Branch", meaning: "a separate copy of the code where work happens without touching the live version." },
      { slug: "rebase", term: "Rebase", meaning: "catching an agent's copy up with the latest version before it adds its own work, so two agents don't trip over each other." },
      { slug: "deploy", term: "Deploy (going live)", meaning: "putting a version onto the real website. Many setups do this automatically after every push." },
      { slug: "preview", term: "Preview vs. live (production)", meaning: "a preview is a private test copy of the site; production is the real one your customers use." },
      { slug: "rollback", term: "Rollback", meaning: "going back to the last good version if something goes wrong after going live." },
      { slug: "migration", term: "Migration", meaning: "a change to how the app stores its data, like adding a new drawer to a filing cabinet. It usually runs on its own while the new version goes live." },
    ],
  },
  {
    heading: "Keys and connections",
    entries: [
      { slug: "api-key", term: "API key", meaning: "a secret password one service uses to talk to another. Never paste one into a chat, a document or a post. Only paste it into the settings field made for it." },
      { slug: "environment-variable", term: "Environment variable", meaning: "a named setting where an app keeps secrets like API keys, stored safely on the server rather than in the code. After adding one, the site usually needs a redeploy to pick it up." },
      { slug: "connector", term: "Connector (MCP)", meaning: "a plug that lets an AI agent use another app directly, like letting Claude read your HelixOS tasks." },
      { slug: "webhook", term: "Webhook", meaning: "an automatic message one app sends another the moment something happens, like \"a call was just booked\"." },
      { slug: "rate-limit", term: "Rate limit", meaning: "a cap on how many requests can be made in a short time, so nothing runs away or costs a fortune." },
    ],
  },
  {
    heading: "Working with AI agents",
    entries: [
      { slug: "agent", term: "Agent", meaning: "an AI that does a job step by step, such as writing code, answering leads or drafting posts, rather than just answering one question." },
      { slug: "session", term: "Session", meaning: "one agent's ongoing conversation and workspace. Different sessions don't automatically know what the others are doing." },
      { slug: "handoff-doc", term: "Handoff doc", meaning: "a shared document agents and people use to pass briefs, plans and status between sessions." },
      { slug: "status", term: "Status", meaning: "an agent's short report of what it's doing now, what it did last and what's next." },
      { slug: "prompt", term: "Prompt", meaning: "what you type to an agent. It works best when it says what you want, what \"done\" looks like, and what not to touch." },
      { slug: "context", term: "Context", meaning: "everything the agent can see while it works: your message, files, earlier notes. Missing context is the most common reason an agent gets something wrong." },
      { slug: "model", term: "Model", meaning: "the AI system behind an agent, such as Claude or GPT. Bigger models are usually smarter, slower and cost more." },
      { slug: "tokens", term: "Tokens", meaning: "how AI usage is measured and billed, roughly pieces of words. Long documents and long chats use more." },
    ],
  },
];
