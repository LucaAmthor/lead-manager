import { liste, aendern, loeschen } from "@/lib/buchung/db";
import * as tw from "@/lib/telefon/twilio";

// Löschfristen laut Datenschutzerklärung modernisieren24.de (Stand 26.10.2026). Läuft täglich aus /api/telefon/cron.
// - Mailbox-Aufnahmen: nach 30 Tagen bei Twilio gelöscht.
// - Anfragen, Anrufdaten, Transkripte, WhatsApp-Chats: nach 12 Monaten anonymisiert. Was für die Auswertung zählt
//   (Anzeige, Kategorie, Kanal, Datum, qualifiziert, Erlös, ob eingewilligt wurde) bleibt ohne Personenbezug erhalten.
// - Einwilligungsnachweis (Name, Nummer, Wortlaut, Zeitpunkt, Weg, Zustimmung im Transkript): 3 Jahre, dann ebenfalls entfernt.
const TAG = 864e5;
export const FRISTEN = { aufnahmeTage: 30, anfrageTage: 365, nachweisTage: 3 * 365 };

// Ohne bekannten Zeitpunkt nie löschen (Alter 0)
const alterTage = (ms) => (Number(ms) > 0 ? (Date.now() - Number(ms)) / TAG : 0);
const zeitVon = (x) => Number(x.createdAt || x.start || x.zeit || (x.datum ? Date.parse(x.datum) : 0)) || 0;

// Personenbezogene Felder in Kontakten (Leads). Alles andere sind Auswertungsfelder.
const KONTAKT_PERSONEN = ["name", "telefon", "email", "ort", "antworten", "notiz", "seite", "rueckrufnummer"];
const NACHWEIS = ["einwilligungText", "einwilligungDurch", "einwilligungAnruf", "einwilligungNachweis"];

function leer(felder, obj) {
  const p = {};
  for (const f of felder) if (obj[f] !== undefined && obj[f] !== null && obj[f] !== "") p[f] = null;
  return p;
}

// Nur die Zeilen des Transkripts, in denen die Einwilligung vorgelesen und beantwortet wurde
function nurZustimmung(transkript = []) {
  const i = transkript.findIndex((t) => t.wer === "Assistent" && /einverstanden/i.test(t.text) && /weiter/i.test(t.text));
  return i < 0 ? [] : transkript.slice(i, i + 3);
}

export async function loeschfristen({ jetzt = Date.now() } = {}) {
  const r = { aufnahmen: 0, kontakte: 0, nachweise: 0, anrufe: 0, waChats: 0, waNachrichten: 0, fehler: [] };

  // 1) Mailbox-Aufnahmen nach 30 Tagen bei Twilio löschen
  for (const a of await liste("anrufe", (a) => a.aufnahmeSid && alterTage(zeitVon(a)) > FRISTEN.aufnahmeTage)) {
    try {
      await tw.rest(`/Recordings/${a.aufnahmeSid}.json`, { method: "DELETE" }).catch((e) => { if (e.status !== 404) throw e; });
      await aendern("anrufe", a.id, { aufnahmeSid: null, aufnahmeGeloeschtAm: jetzt });
      r.aufnahmen++;
    } catch (e) { r.fehler.push(`Aufnahme ${a.id}: ${e.message}`); }
  }

  // 2) Kontakte: nach 12 Monaten anonymisieren (Nachweis bleibt), nach 3 Jahren auch den Nachweis entfernen
  for (const k of await liste("kontakte", (k) => !k.demo && alterTage(zeitVon(k)) > FRISTEN.anfrageTage)) {
    const alt = alterTage(zeitVon(k));
    const nachweisBleibt = k.einwilligung && alt <= FRISTEN.nachweisTage;
    const patch = { ...leer(KONTAKT_PERSONEN.filter((f) => !(nachweisBleibt && ["name", "telefon"].includes(f))), k) };
    if (k.plz && String(k.plz).length > 2) patch.plz = String(k.plz).slice(0, 2); // Region für die Auswertung
    if (!nachweisBleibt) Object.assign(patch, leer(["name", "telefon", ...NACHWEIS], k));
    if (Object.keys(patch).length) {
      await aendern("kontakte", k.id, { ...patch, anonymisiertAm: jetzt });
      if (nachweisBleibt) r.kontakte++; else r.nachweise++;
    }
  }

  // 3) Anrufe: nach 12 Monaten Nummer, Ort, Zusammenfassung, Angaben weg; Transkript nur noch die Zustimmung.
  //    Nach 3 Jahren alles Personenbezogene weg und den Anruf auch bei Twilio löschen.
  for (const a of await liste("anrufe", (a) => alterTage(zeitVon(a)) > FRISTEN.anfrageTage && !a.endgueltigAnonymisiert)) {
    const alt = alterTage(zeitVon(a));
    const ende = alt > FRISTEN.nachweisTage;
    const patch = { von: null, stadtAnrufer: null, notiz: null, anonymisiertAm: jetzt };
    if (a.assistent) patch.assistent = { konversation: ende ? null : a.assistent.konversation || null, transkript: ende ? [] : nurZustimmung(a.assistent.transkript), zusammenfassung: null, angaben: null, sek: a.assistent.sek || 0 };
    if (ende) {
      patch.endgueltigAnonymisiert = true;
      if (/^CA[0-9a-f]{32}$/.test(a.id)) await tw.rest(`/Calls/${a.id}.json`, { method: "DELETE" }).catch(() => {});
    }
    try { await aendern("anrufe", a.id, patch); r.anrufe++; } catch (e) { r.fehler.push(`Anruf ${a.id}: ${e.message}`); }
  }

  // 4) WhatsApp: Nachrichten nach 12 Monaten löschen; Chats (id = Nummer) ohne Aktivität seit 12 Monaten löschen
  for (const n of await liste("wa_nachrichten", (n) => alterTage(n.zeit) > FRISTEN.anfrageTage)) {
    await loeschen("wa_nachrichten", n.id); r.waNachrichten++;
  }
  for (const c of await liste("wa_chats", (c) => alterTage(c.letzte || c.createdAt) > FRISTEN.anfrageTage)) {
    await loeschen("wa_chats", c.id); r.waChats++;
  }
  return r;
}
