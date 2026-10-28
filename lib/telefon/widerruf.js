import { liste, aendern, anlegen } from "@/lib/buchung/db";

const tel = (x) => { const d = String(x || "").replace(/\D/g, "").replace(/^0049|^49/, "0"); return d ? d.replace(/^(?!0)/, "0") : ""; };
const mail = (x) => String(x || "").trim().toLowerCase();

/**
 * Widerruf (Telefon, E-Mail, WhatsApp): alle Kontakte mit dieser Nummer/E-Mail sperren (Einwilligung aus, Nachweis bleibt)
 * und einen Eintrag in „widerrufe“ anlegen, damit Partner informiert werden.
 */
export async function widerrufSpeichern({ telefone = [], emails = [], kontaktIds = [], name = "", kanal, nachweis = "", anrufId = "", text = "" }) {
  const t = new Set(telefone.map(tel).filter(Boolean));
  const m = new Set(emails.map(mail).filter(Boolean));
  const ids = new Set(kontaktIds.filter(Boolean));
  const betroffen = [];
  for (const k of await liste("kontakte")) {
    if ((k.telefon && t.has(tel(k.telefon))) || (k.email && m.has(mail(k.email))) || ids.has(k.id)) {
      await aendern("kontakte", k.id, { einwilligung: false, widerrufen: true, widerrufAm: Date.now(), widerrufKanal: kanal, widerrufNachweis: nachweis });
      betroffen.push({ id: k.id, name: k.name || "", code: k.code || "" });
    }
  }
  await anlegen("widerrufe", { zeit: Date.now(), name, telefone: [...t], emails: [...m], kontakte: betroffen.map((b) => b.id), kanal, nachweis, anruf: anrufId, text: String(text).slice(0, 2000), partnerInformiert: false });
  return betroffen;
}
