/**
 * The HelixOS transactional email: the template shipped with the brief, embedded verbatim (src/data/email/template.html is the
 * same bytes, kept for diffing). 600px tables, inline styles, no <style> block, no classes. The slots are filled here and
 * nowhere else; every value is HTML-escaped; when there is no state line the whole row goes, never an empty box. The plain
 * text part is built beside it and always sent with it.
 */

export const EMAIL_TEMPLATE = "<!-- HelixOS transactional email template.\n     Slots: {{PREHEADER}} {{GREETING}} {{STATE_LINE}} {{ASK_1..3}} {{BUTTON_LABEL}}\n            {{POINTS_LINE}} {{ACTION_URL}} {{SETTINGS_URL}}\n     When there is no state line, remove the whole <tr> containing {{STATE_LINE}}.\n     Do not add CSS classes or a <style> block - inline only. -->\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"background-color:#f6f5f1;margin:0;padding:0;\">\n  <tr>\n    <td align=\"center\" style=\"padding:32px 16px;\">\n\n      <div style=\"display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f6f5f1;opacity:0;\">{{PREHEADER}}</div>\n\n      <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"600\" style=\"width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e8e5dd;border-radius:12px;overflow:hidden;\">\n\n        <tr><td style=\"background-color:#F0C030;height:4px;line-height:4px;font-size:0;\">&nbsp;</td></tr>\n\n        <tr>\n          <td style=\"padding:26px 40px 20px 40px;\" bgcolor=\"#ffffff\">\n            <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">\n              <tr>\n                <td bgcolor=\"#ffffff\" style=\"background-color:#ffffff;width:60px;\" width=\"60\">\n                  <img src=\"{{LOGO_URL}}\" width=\"60\" height=\"60\" alt=\"Evolve Omega\" style=\"display:block;width:60px;height:60px;border:0;outline:none;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#1a1a1a;\">\n                </td>\n                <td style=\"padding-left:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\">\n                  <div style=\"font-size:17px;font-weight:700;color:#1a1a1a;letter-spacing:.2px;\">HelixOS</div>\n                  <div style=\"font-size:12px;color:#8a8a8a;padding-top:3px;\">Evolve Omega</div>\n                </td>\n              </tr>\n            </table>\n          </td>\n        </tr>\n\n        <tr>\n          <td style=\"padding:0 40px 18px 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:21px;font-weight:700;color:#1a1a1a;\">\n            {{GREETING}}\n          </td>\n        </tr>\n\n              <tr>\n                <td style=\"padding:0 40px 24px 40px;\">\n                  <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\">\n                    <tr>\n                      <td style=\"background-color:#fdf6e3;border-left:3px solid #E49C24;padding:14px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#5a4a20;\">\n                        {{STATE_LINE}}\n                      </td>\n                    </tr>\n                  </table>\n                </td>\n              </tr>\n        <tr>\n          <td style=\"padding:0 40px 28px 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;line-height:1.55;color:#2f2f2f;\">\n            <div style=\"margin:0 0 6px 0;\">{{ASK_1}}</div><div style=\"margin:0 0 6px 0;\">{{ASK_2}}</div><div style=\"margin:0 0 6px 0;\">{{ASK_3}}</div>\n          </td>\n        </tr>\n\n        <tr>\n          <td style=\"padding:0 40px 14px 40px;\">\n            <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">\n              <tr>\n                <td style=\"background-color:#F0C030;border-radius:8px;\">\n                  <a href=\"{{ACTION_URL}}\" style=\"display:inline-block;padding:15px 34px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#1a1a1a;text-decoration:none;border-radius:8px;\">{{BUTTON_LABEL}}</a>\n                </td>\n              </tr>\n            </table>\n          </td>\n        </tr>\n\n        <tr>\n          <td style=\"padding:0 40px 30px 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#8a8a8a;\">\n            {{POINTS_LINE}}\n          </td>\n        </tr>\n\n        <tr><td style=\"padding:0 40px;\"><div style=\"height:1px;line-height:1px;font-size:0;background-color:#e8e5dd;\">&nbsp;</div></td></tr>\n\n        <tr>\n          <td style=\"padding:18px 40px 26px 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#8a8a8a;\">\n            Reminders come at 8am and 5pm. <a href=\"{{SETTINGS_URL}}\" style=\"color:#C86432;text-decoration:underline;\">Change them in Settings</a>.\n          </td>\n        </tr>\n\n      </table>\n    </td>\n  </tr>\n</table>";

export type EmailSlots = {
  preheader: string;
  greeting: string;
  /** One line or nothing. Never two, never a summary. */
  stateLine: string | null;
  asks: string[];
  buttonLabel: string;
  pointsLine: string;
  actionUrl: string;
  settingsUrl: string;
  logoUrl: string;
  /** The footer as HTML, already escaped where needed; defaults to the template's own reminders line with the Settings link. */
  footerHtml?: string;
  /** The client's reminder hours as words ("6am", "5pm"), stated in the template's footer in place of its example times. */
  hourLabels?: { morning: string; evening: string };
  /** A scoreboard (rev 639): headed blocks of label and value rows, after the asks and before the button. Absent, nothing is added. */
  sections?: EmailSection[];
};

export type EmailSection = { heading: string; rows: { label: string; value: string }[]; note?: string | null };

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** The sections as one template row: a small heading, then a two-column table per block, every value escaped. */
function sectionsHtml(sections: EmailSection[]): string {
  const blocks = sections
    .filter((sec) => sec.rows.length || sec.note)
    .map((sec) => {
      const rows = sec.rows.map((r) => `<tr><td style="padding:6px 0;border-bottom:1px solid #f0ede6;font-family:${FONT};font-size:15px;color:#2f2f2f;">${escapeHtml(r.label)}</td><td align="right" style="padding:6px 0 6px 12px;border-bottom:1px solid #f0ede6;font-family:${FONT};font-size:15px;font-weight:700;color:#1a1a1a;">${escapeHtml(r.value)}</td></tr>`).join("");
      const note = sec.note ? `<div style="padding-top:6px;font-family:${FONT};font-size:12px;line-height:1.5;color:#8a8a8a;">${escapeHtml(sec.note)}</div>` : "";
      return `<div style="padding-top:8px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#8a8a8a;">${escapeHtml(sec.heading)}</div>${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>` : ""}${note}`;
    })
    .join(`<div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>`);
  return blocks ? `<tr><td style="padding:0 40px 26px 40px;">${blocks}</td></tr>` : "";
}

/** The sections as plain text: the heading, then "label: value" lines, then the note. */
export function sectionsText(sections: EmailSection[]): string {
  return sections
    .filter((sec) => sec.rows.length || sec.note)
    .map((sec) => [sec.heading.toUpperCase(), ...sec.rows.map((r) => `${r.label}: ${r.value}`), sec.note ?? ""].filter(Boolean).join("\n"))
    .join("\n\n");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STATE_ROW = /<tr>\s*<td style="padding:0 40px 24px 40px;">[\s\S]*?\{\{STATE_LINE\}\}[\s\S]*?<\/table>\s*<\/td>\s*<\/tr>/;
const ASKS_BLOCK = /<div style="margin:0 0 6px 0;">\{\{ASK_1\}\}<\/div><div style="margin:0 0 6px 0;">\{\{ASK_2\}\}<\/div><div style="margin:0 0 6px 0;">\{\{ASK_3\}\}<\/div>/;
const BUTTON_ROW = /<tr>\s*<td style="padding:0 40px 14px 40px;">/;
const FOOTER = /Reminders come at 8am and 5pm\. <a href="\{\{SETTINGS_URL\}\}" style="color:#C86432;text-decoration:underline;">Change them in Settings<\/a>\./;

/** The HTML part. The action URL appears once, as the button's href, never as text. The template's author comment is not sent. */
export function renderEmailHtml(s: EmailSlots): string {
  let html = EMAIL_TEMPLATE.replace(/<!--[\s\S]*?-->\s*/g, "");
  html = s.stateLine ? html.replace("{{STATE_LINE}}", escapeHtml(s.stateLine)) : html.replace(STATE_ROW, "");
  const asks = s.asks.filter((a) => a.trim()).map((a) => `<div style="margin:0 0 6px 0;">${escapeHtml(a)}</div>`).join("");
  html = html.replace(ASKS_BLOCK, asks);
  // The scoreboard goes in as its own row straight after the asks' row (the button's row follows it).
  // A function, not a "$1" string: a value like "$4,200" must never be read as a replacement pattern.
  if (s.sections?.length) html = html.replace(BUTTON_ROW, (row) => `${sectionsHtml(s.sections!)}${row}`);
  if (s.footerHtml !== undefined) html = html.replace(FOOTER, s.footerHtml);
  else if (s.hourLabels) html = html.replace("Reminders come at 8am and 5pm.", `Reminders come at ${escapeHtml(s.hourLabels.morning)} and ${escapeHtml(s.hourLabels.evening)}.`);
  return html
    .replace("{{PREHEADER}}", escapeHtml(s.preheader))
    .replace("{{GREETING}}", escapeHtml(s.greeting))
    .replace("{{BUTTON_LABEL}}", escapeHtml(s.buttonLabel))
    .replace("{{POINTS_LINE}}", escapeHtml(s.pointsLine))
    .replace("{{ACTION_URL}}", escapeHtml(s.actionUrl))
    .replace("{{SETTINGS_URL}}", escapeHtml(s.settingsUrl))
    .replace("{{LOGO_URL}}", escapeHtml(s.logoUrl));
}

/** The plain-text part: the same words, the URL on its own line. Always sent with the HTML. */
export function renderEmailText(s: Pick<EmailSlots, "greeting" | "stateLine" | "asks" | "actionUrl" | "pointsLine" | "sections"> & { footerText: string }): string {
  return [s.greeting, s.stateLine, s.asks.filter((a) => a.trim()).join("\n"), s.sections?.length ? sectionsText(s.sections) : "", s.actionUrl, s.pointsLine, s.footerText].filter((x) => x && x.trim()).join("\n\n");
}
