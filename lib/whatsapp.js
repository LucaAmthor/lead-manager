import { createHmac, timingSafeEqual } from "node:crypto";
import { holen, anlegen, aendern, liste } from "@/lib/buchung/db";
import { anthropic, parseJson, MODELL, tokens } from "@/lib/buchung/ki";
import { anzeigeZuCode } from "@/lib/tracking";
import { skriptFuer, einwilligungFuer } from "@/lib/telefon/skripte";

// WhatsApp über die Meta Cloud API. Chats in „wa_chats“ (id = WhatsApp-Nummer), Nachrichten in „wa_nachrichten“.
// Die KI antwortet natürlich und passend zur Kategorie, sammelt die Angaben und holt die Einwilligung ein.
// Übergabe an einen Menschen: auf Wunsch, bei Unklarheit/Beschwerde oder wenn alles erfasst ist.
// Vercel: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET (optional WHATSAPP_API_VERSION).
const VERSION = () => process.env.WHATSAPP_API_VERSION || "v23.0";
export const waKonfiguriert = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
const CODE_RE = /\b([A-Z]{3}-[A-Z]{2}-\d{3})\b/i;
const FENSTER = 24 * 36e5;

export function signaturOk(roh, kopf) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return process.env.WHATSAPP_SIGNATUR_PRUEFEN === "aus";
  const soll = "sha256=" + createHmac("sha256", secret).update(roh).digest("hex");
  const a = Buffer.from(soll), b = Buffer.from(String(kopf || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function graph(pfad, body) {
  const res = await fetch(`https://graph.facebook.com/${VERSION()}/${pfad}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`WhatsApp ${res.status}: ${j.error?.message || "Fehler"}`), { code: j.error?.code === 131047 ? "fenster_zu" : "whatsapp", meta: j.error });
  return j;
}
const nrId = () => process.env.WHATSAPP_PHONE_NUMBER_ID;

export async function textSenden(chatId, text, von = "ki") {
  const chat = await holen("wa_chats", chatId);
  if (chat?.letzteEingehend && Date.now() - chat.letzteEingehend > FENSTER) throw Object.assign(new Error("Das 24-Stunden-Fenster ist zu. Antworten geht erst wieder, wenn der Kunde schreibt (oder über eine freigegebene Vorlage)."), { code: "fenster_zu" });
  const j = await graph(`${nrId()}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to: chatId, type: "text", text: { body: String(text).slice(0, 4000), preview_url: false } });
  const waId = j.messages?.[0]?.id || "";
  await anlegen("wa_nachrichten", { chatId, richtung: "aus", text: String(text), von, zeit: Date.now(), waId, status: "gesendet" }, waId || undefined);
  await aendern("wa_chats", chatId, { letzte: Date.now(), letzteText: String(text).slice(0, 140), letzteVon: von });
  return waId;
}
async function gelesen(messageId) {
  try { await graph(`${nrId()}/messages`, { messaging_product: "whatsapp", status: "read", message_id: messageId }); } catch {}
}

function textAus(m) {
  if (m.type === "text") return m.text?.body || "";
  if (m.type === "button") return m.button?.text || "";
  if (m.type === "interactive") return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "";
  if (m.type === "location") return `[Standort: ${m.location?.name || ""} ${m.location?.address || ""}]`.trim();
  return `[${m.type === "audio" ? "Sprachnachricht" : m.type === "image" ? "Bild" : m.type === "document" ? "Dokument" : m.type}]`;
}

/** Eingehende Nachricht speichern, Chat/Kontakt anlegen, Anzeige zuordnen. Gibt den Chat zurück. */
export async function eingang(m, profilName) {
  const chatId = m.from;
  const text = textAus(m);
  if (await holen("wa_nachrichten", m.id)) return null; // Meta schickt manchmal doppelt
  await anlegen("wa_nachrichten", { chatId, richtung: "ein", text, typ: m.type, zeit: Number(m.timestamp) * 1000 || Date.now(), waId: m.id }, m.id);
  let chat = await holen("wa_chats", chatId);
  const code = (text.match(CODE_RE) || [])[1];
  const referral = m.referral; // Click-to-WhatsApp-Anzeige bei Meta
  if (!chat) {
    const anzeige = code ? await anzeigeZuCode(code) : null;
    const kontakt = await anlegen("kontakte", {
      anzeigeId: anzeige?.id || "", code: anzeige?.code || (code || "").toUpperCase(), kategorie: anzeige?.kategorie || "", kampagneId: anzeige?.kampagneId || "",
      kanal: "WhatsApp", quelle: "whatsapp", herkunft: referral ? "meta" : /social/i.test(text) ? "social" : anzeige ? "print" : "online",
      datum: new Date().toISOString().slice(0, 10), name: profilName || "", telefon: "+" + chatId, qualifiziert: false, einwilligung: false, erloes: 0, notiz: "", createdAt: Date.now(),
    });
    chat = await anlegen("wa_chats", {
      telefon: "+" + chatId, name: profilName || "", anzeigeId: anzeige?.id || "", code: kontakt.code, kategorie: kontakt.kategorie, kontaktId: kontakt.id,
      modus: "ki", status: "offen", start: Date.now(), letzte: Date.now(), letzteEingehend: Date.now(), letzteText: text.slice(0, 140), letzteVon: "kunde", ungelesen: 1,
      referral: referral ? { quelle: referral.source_type || "", headline: referral.headline || "", url: referral.source_url || "" } : null,
    }, chatId);
  } else {
    const patch = { letzte: Date.now(), letzteEingehend: Date.now(), letzteText: text.slice(0, 140), letzteVon: "kunde", ungelesen: (chat.ungelesen || 0) + 1 };
    if (!chat.anzeigeId && code) {
      const anzeige = await anzeigeZuCode(code);
      if (anzeige) {
        Object.assign(patch, { anzeigeId: anzeige.id, code: anzeige.code, kategorie: anzeige.kategorie });
        if (chat.kontaktId) await aendern("kontakte", chat.kontaktId, { anzeigeId: anzeige.id, code: anzeige.code, kategorie: anzeige.kategorie, kampagneId: anzeige.kampagneId || "" });
      }
    }
    if (chat.status === "erledigt") patch.status = "offen";
    chat = await aendern("wa_chats", chatId, patch);
  }
  gelesen(m.id);
  return chat;
}

const TON = {
  Altenpflege: "Sehr behutsam, warm und geduldig. Die Person sorgt sich oft um Angehörige. Kein Humor, keine Verkaufssprache, Verständnis zeigen.",
  _standard: "Freundlich, locker und klar, wie ein hilfsbereiter Mensch aus der Region. Kurze Nachrichten, höchstens ein Emoji, wenn es passt.",
};

/** KI-Antwort auf den Chat erzeugen und senden (nur im Modus „ki“). */
export async function kiAntworten(chatId) {
  const chat = await holen("wa_chats", chatId);
  if (!chat || chat.modus !== "ki") return null;
  const allg = (await holen("einstellungen", "allgemein")) || {};
  const tel = (await holen("einstellungen", "telefon")) || {};
  const wa = (await holen("einstellungen", "whatsapp")) || {};
  const marke = allg.marke || "Modernisieren24";
  const verlauf = (await liste("wa_nachrichten", (n) => n.chatId === chatId)).sort((a, b) => a.zeit - b.zeit).slice(-30);
  const kontakt = chat.kontaktId ? await holen("kontakte", chat.kontaktId) : null;
  const skript = skriptFuer(chat.kategorie, tel.skripte, marke);
  const einw = einwilligungFuer(chat.kategorie, tel.einwilligungWhatsApp || tel.einwilligung);
  const system = `Du schreibst im WhatsApp-Chat von ${marke}, einem kostenlosen Vermittlungsdienst: Interessenten bekommen bis zu 3 Angebote geprüfter Anbieter aus ihrer Region. Du bist ein KI-Assistent; wenn jemand fragt, sagst du das ehrlich.
Ton: ${TON[chat.kategorie] || TON._standard} Schreibe Deutsch, per „Sie“, außer der Kunde duzt. Nachrichten kurz (1–3 Sätze), immer nur EINE Frage auf einmal.
Ziel: freundlich klären, worum es geht (Kategorie ${chat.kategorie || "noch unbekannt – herausfinden"}), dann diese Angaben sammeln: ${skript.fragen.join("; ")}.
Danach die Einwilligung einholen, sinngemäß: „${einw}“ – nur ein klares Ja zählt. Zum Schluss: „${skript.abschluss}“
Regeln: keine Preise, Förderhöhen oder Fristen versprechen; keine Fachberatung im Detail (das machen die Anbieter); nichts erfinden. Bei Wunsch nach einem Menschen, Beschwerde, rechtlichen/medizinischen Fragen, Unklarheit oder Ärger: kurz freundlich sagen, dass sich gleich jemand aus dem Team meldet, und uebergabe=true setzen. Sprachnachrichten/Bilder kannst du nicht ansehen – bitte freundlich um Text.
${wa.zusatz ? "Zusätzliche Hinweise vom Team: " + wa.zusatz : ""}
Antworte ausschließlich mit JSON: {"antwort":"Text an den Kunden","felder":{"name":"","plz":"","ort":""},"antworten":{"<Frage>":"<Antwort>"},"einwilligung":false,"qualifiziert":false,"uebergabe":false,"grund":"","fertig":false}
„antworten“ nur mit Angaben, die der Kunde wirklich gemacht hat. „qualifiziert“ = Eigentümer bzw. echter Bedarf, Ort bekannt, erreichbar. „fertig“ = alle wichtigen Angaben + Einwilligung da.`;
  const bisher = kontakt ? `Bisher erfasst: ${JSON.stringify({ name: kontakt.name, plz: kontakt.plz, antworten: kontakt.antworten || {}, einwilligung: kontakt.einwilligung })}` : "";
  const nachrichten = verlauf.map((n) => ({ role: n.richtung === "ein" ? "user" : "assistant", content: n.richtung === "ein" ? n.text : JSON.stringify({ antwort: n.text }) }));
  // Anthropic verlangt abwechselnde Rollen und eine user-Nachricht am Ende
  const zusammen = [];
  for (const n of nachrichten) { const l = zusammen[zusammen.length - 1]; if (l && l.role === n.role) l.content += "\n" + n.content; else zusammen.push({ ...n }); }
  if (!zusammen.length || zusammen[zusammen.length - 1].role !== "user") return null;
  if (bisher) zusammen[zusammen.length - 1].content += `\n\n(${bisher})`;
  const data = await anthropic({ model: process.env.WHATSAPP_MODEL || MODELL(), max_tokens: 900, system, messages: zusammen });
  const r = parseJson((data.content || []).filter((c) => c.type === "text").map((c) => c.text).join(""));
  if (!r?.antwort) return null;
  if (kontakt) {
    const patch = {};
    if (r.felder?.name) patch.name = String(r.felder.name).slice(0, 120);
    if (r.felder?.plz) patch.plz = String(r.felder.plz).slice(0, 10);
    if (r.felder?.ort) patch.ort = String(r.felder.ort).slice(0, 80);
    if (r.antworten && typeof r.antworten === "object") patch.antworten = { ...(kontakt.antworten || {}), ...r.antworten };
    if (r.einwilligung === true && !kontakt.einwilligung) Object.assign(patch, { einwilligung: true, einwilligungText: einw, einwilligungAm: Date.now(), einwilligungKanal: "WhatsApp" });
    if (r.qualifiziert === true) patch.qualifiziert = true;
    if (Object.keys(patch).length) await aendern("kontakte", kontakt.id, patch);
  }
  await textSenden(chatId, r.antwort, "ki");
  const usage = tokens(data.usage);
  const chatPatch = { kiTokens: { tin: (chat.kiTokens?.tin || 0) + usage.tin, tout: (chat.kiTokens?.tout || 0) + usage.tout } };
  if (r.uebergabe) Object.assign(chatPatch, { modus: "mensch", status: "braucht_mensch", uebergabeGrund: String(r.grund || "").slice(0, 300) });
  else if (r.fertig) Object.assign(chatPatch, { status: "fertig" });
  await aendern("wa_chats", chatId, chatPatch);
  return r;
}

// wa.me-Link mit vorausgefülltem Code (für Anzeigen/QR)
export function waLink(nummer, code, kategorie) {
  const n = String(nummer || "").replace(/\D/g, "").replace(/^0/, "49");
  if (!n) return "";
  const text = `Hallo! Ich interessiere mich für ${kategorie ? kategorie + " – " : ""}bitte um Angebote. (Code ${code})`;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
