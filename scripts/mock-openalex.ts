/**
 * A stand-in for the OpenAlex API for smoke tests. `npx tsx scripts/mock-openalex.ts 4040`, then run the app with
 * OPENALEX_BASE_URL=http://localhost:4040 and OPENALEX_API_KEY=test-key. Every request must carry api_key=test-key (anything
 * else is 403, since the real API takes the key as a query parameter). It counts calls (`GET /__calls`) so a walk can prove the
 * cache, and a search for "quota" answers 429 so a walk can see the visible failure.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4040);
let calls = 0;
/** The last search's query string, minus the key, so a walk can read exactly what was asked. */
let last: Record<string, string> = {};

const work = (id: string, doi: string, title: string, year: number, cited: number, authors: string[], relevance: number) => ({
  id: `https://openalex.org/${id}`,
  doi: `https://doi.org/${doi}`,
  title,
  display_name: title,
  publication_year: year,
  cited_by_count: cited,
  relevance_score: relevance,
  authorships: authors.map((a) => ({ author: { display_name: a } })),
});

// The right paper, a confident wrong one (real DOI, real citations, wrong work and year), and a thin one.
const WORKS = [
  work("W2162380352", "10.1037/h0023552", "Compliance without pressure: The foot-in-the-door technique.", 1966, 1624, ["Jonathan L. Freedman", "Scott C. Fraser"], 91.2),
  work("W2014000001", "10.1146/annurev-psych-010213-115137", "The Psychology of Change: Self-Affirmation and Social Psychological Intervention", 2014, 1187, ["Geoffrey L. Cohen", "David K. Sherman"], 12.5),
  work("W2099000003", "10.5555/thin.1", "A small study of commitment in online groups", 2019, 3, ["A. Nobody"], 40.1),
];
// What a citation sort of a loose match looks like: famous papers about something else entirely, none sharing a word with the terms.
const LEADERBOARD = [
  work("W3001", "10.1056/nejmoa2001017", "A Novel Coronavirus from Patients with Pneumonia in China, 2019", 2020, 30469, ["Na Zhu"], 0.4),
  work("W3002", "10.1038/nature11247", "An integrated encyclopedia of DNA elements in the human genome", 2012, 19665, ["ENCODE Project Consortium"], 0.3),
  work("W3003", "10.5962/bhl.title.4820", "The expression of the emotions in man and animals", 1872, 11582, ["Charles Darwin"], 0.2),
];

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  // The real API reports the day's credits on every response; a list request costs 10.
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "x-ratelimit-limit": "100000", "x-ratelimit-remaining": String(100000 - calls * 10), "x-ratelimit-reset": "3600" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__calls") return json(200, { calls });
  if (url.pathname === "/__last") return json(200, last);
  if (url.searchParams.get("api_key") !== "test-key") return json(403, { error: "api_key missing or wrong" });
  calls++;
  if (url.pathname === "/works") {
    const q = url.searchParams.get("search") ?? "";
    last = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== "api_key"));
    if (/quota/i.test(q)) return json(429, { error: "daily quota exceeded" });
    if (/nothing-here/i.test(q)) return json(200, { results: [] });
    if (/leaderboard/i.test(q)) return json(200, { results: LEADERBOARD });
    // Relevance order unless a citation sort was asked for, as the real API behaves
    const sorted = url.searchParams.get("sort") === "cited_by_count:desc" ? [...WORKS].sort((a, b) => b.cited_by_count - a.cited_by_count) : [...WORKS].sort((a, b) => b.relevance_score - a.relevance_score);
    return json(200, { results: sorted });
  }
  const m = url.pathname.match(/^\/works\/(.+)$/);
  if (m) {
    const doi = decodeURIComponent(m[1]).replace(/^https?:\/\/doi\.org\//, "");
    const w = WORKS.find((x) => x.doi.endsWith(doi));
    return w ? json(200, w) : json(404, { error: "not found" });
  }
  return json(404, { error: "no route" });
}).listen(port, () => console.log(`mock-openalex on :${port}`));
