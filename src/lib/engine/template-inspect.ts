/**
 * Reading a pass template's layout without anyone's data (H-1822, plan H-1826 approved in H-1836). Pure: what the inspect
 * script prints from the pass service's answer. Structure only: labels, placeholders, colours, image sizes, barcode settings,
 * links and flags. Anything that could be a person or a secret is hidden: an email, a phone number, a customer, serial or
 * member id, a token or key, and any long run of digits. Image addresses are replaced by "[image]" so only their sizes show.
 */
const HIDDEN_KEY = /email|phone|customer|serial|member_?id|token|secret|password|authori[sz]ation|api_?key|signature|certificate|p12|pem/i;
const IMAGE_KEY = /image|logo|icon|strip|background|thumbnail|footer/i;
const IMAGE_URL = /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i;

export type Templateish = { id?: unknown; name?: unknown; style?: unknown; type?: unknown; pass_type?: unknown; passStyle?: unknown; created_at?: unknown; createdAt?: unknown; updated_at?: unknown; updatedAt?: unknown };

/** One string, made safe to print: no emails, no phone numbers, no long digit runs, no secret, at most 200 characters. */
export function safeText(v: string, secret = ""): string {
  let s = v;
  if (secret && s.includes(secret)) return "[hidden]";
  if (/[^\s@%]+@[^\s@]+\.[^\s@]+/.test(s)) return "[hidden]";
  if (/\+?\d[\d\s().-]{8,}\d/.test(s)) s = s.replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]");
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/** The answer with every personal or secret value hidden and every image address replaced, keeping the shape. */
export function redactTemplate(json: unknown, secret = "", key = ""): unknown {
  if (typeof json === "string") {
    // A bare placeholder ("${Email}", "{{MEMBER_ID}}") is layout, not data: always shown.
    if (/^(\$\{\s*[\w.]+\s*\}|\{\{\s*[\w.]+\s*\}\})$/.test(json)) return json;
    if (key && HIDDEN_KEY.test(key)) return "[hidden]";
    if (/^https?:/i.test(json) && ((key && IMAGE_KEY.test(key)) || IMAGE_URL.test(json))) return "[image]";
    if (/^data:/i.test(json)) return "[image]";
    return safeText(json, secret);
  }
  if (typeof json === "number" || typeof json === "boolean" || json === null) return key && HIDDEN_KEY.test(key) ? "[hidden]" : json;
  if (Array.isArray(json)) return json.map((x) => redactTemplate(x, secret, key));
  if (json && typeof json === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) out[k] = redactTemplate(v, secret, k);
    return out;
  }
  return null;
}

/** The template list as rows: name, short id, style and dates, whatever the service names them. Newest first by updated, then created. */
export function templateRows(json: unknown): { name: string; id: string; shortId: string; style: string; created: string; updated: string }[] {
  const raw = (json as { data?: Templateish[] } | Templateish[] | null) ?? [];
  const list = Array.isArray(raw) ? raw : (raw.data ?? []);
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
  const rows = list.map((t) => {
    const id = str(t.id);
    return {
      name: safeText(str(t.name) || "unnamed"),
      id,
      shortId: id.slice(0, 8),
      style: str(t.style ?? t.passStyle ?? t.pass_type ?? t.type) || "not given",
      created: str(t.created_at ?? t.createdAt) || "not given",
      updated: str(t.updated_at ?? t.updatedAt) || "not given",
    };
  });
  const when = (r: { created: string; updated: string }) => Date.parse(r.updated) || Date.parse(r.created) || 0;
  return rows.sort((a, b) => when(b) - when(a));
}
