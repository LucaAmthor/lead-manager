import { createHmac, timingSafeEqual } from "node:crypto";

// E-Mail über Resend: senden (Anfragen, Zusagen, Druckdaten) und empfangen (Webhook email.received).
const API = "https://api.resend.com";
const key = () => {
  if (!process.env.RESEND_API_KEY) throw Object.assign(new Error("RESEND_API_KEY fehlt in Vercel"), { code: "capability_disabled" });
  return process.env.RESEND_API_KEY;
};
export const absenderAdresse = () => process.env.BUCHUNG_MAIL_FROM || "";

// Jede Buchung hat ein Kennzeichen im Betreff, z. B. [LP-k3x9a2]. Antworten der Verlage behalten es meist.
export const kennzeichen = (buchungId) => `[LP-${buchungId}]`;
export function kennzeichenAus(text) {
  const m = String(text || "").match(/\[LP-([a-z0-9]{6,24})\]/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Mail senden. Im Testmodus geht sie an testEmpfaenger statt an den Verlag; der echte Empfänger steht im Betreff.
 * anhaenge: [{ filename, content (Buffer|Uint8Array) }]
 */
export async function senden({ an, betreff, text, anhaenge = [], antwortAuf, absenderName, testmodus, testEmpfaenger }) {
  const from = absenderAdresse();
  if (!from) throw Object.assign(new Error("BUCHUNG_MAIL_FROM fehlt in Vercel"), { code: "capability_disabled" });
  let to = an;
  let subject = betreff;
  if (testmodus) {
    if (!testEmpfaenger) throw Object.assign(new Error("Testmodus ohne Test-Empfänger"), { code: "invalid_argument" });
    to = testEmpfaenger;
    subject = `[TEST → ${an}] ${betreff}`;
  }
  const headers = {};
  if (antwortAuf) {
    headers["In-Reply-To"] = antwortAuf;
    headers["References"] = antwortAuf;
  }
  const body = {
    from: absenderName ? `${absenderName.replace(/[<>"]/g, "")} <${from}>` : from,
    to: [to],
    reply_to: from,
    subject,
    text,
    headers,
    attachments: anhaenge.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })),
  };
  const res = await fetch(`${API}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Resend ${res.status}: ${j?.message || ""}`), { code: "mail_fehler" });
  return { id: j.id, an: to, betreff: subject };
}

// Empfangene Mail vollständig holen (Webhook liefert nur Metadaten)
export async function empfangeneMail(id) {
  const res = await fetch(`${API}/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key()}` } });
  if (!res.ok) throw Object.assign(new Error(`Resend ${res.status}`), { code: "mail_fehler" });
  return res.json();
}

export async function anhaengeHolen(id) {
  const res = await fetch(`${API}/emails/receiving/${encodeURIComponent(id)}/attachments`, { headers: { Authorization: `Bearer ${key()}` } });
  if (!res.ok) return [];
  const j = await res.json();
  return j.data || [];
}

// Webhook-Signatur prüfen (Resend signiert nach dem Svix-Verfahren)
export function signaturOk(rohtext, headers, secret = process.env.RESEND_WEBHOOK_SECRET) {
  if (!secret) return false;
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sig = headers.get("svix-signature");
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 10) return false;
  const schluessel = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const erwartet = createHmac("sha256", schluessel).update(`${id}.${ts}.${rohtext}`).digest();
  return sig.split(" ").some((teil) => {
    const [, wert] = teil.split(",");
    if (!wert) return false;
    const b = Buffer.from(wert, "base64");
    return b.length === erwartet.length && timingSafeEqual(b, erwartet);
  });
}

// HTML grob in Text umwandeln (für die KI reicht das)
export function htmlZuText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Zitierte Vorgänger-Mails abschneiden, damit die KI nur die neue Antwort liest
export function ohneZitat(text) {
  const t = String(text || "");
  const marken = [/\n-{2,}\s*Original/i, /\nAm .{5,80} schrieb .{0,120}:/i, /\nOn .{5,80} wrote:/i, /\nVon: .*\n(Gesendet|Datum): /i, /\n>/];
  let ende = t.length;
  for (const m of marken) {
    const i = t.search(m);
    if (i > 40 && i < ende) ende = i;
  }
  return t.slice(0, ende).trim();
}
