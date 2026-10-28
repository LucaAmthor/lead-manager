import { anlegen } from "@/lib/buchung/db";
import { empfangeneMail, htmlZuText, ohneZitat } from "@/lib/buchung/mail";
import { kiJson } from "@/lib/buchung/ki";
import { cfg, mailAnTeam } from "@/lib/telefon/daten";
import { widerrufSpeichern } from "@/lib/telefon/widerruf";

// Postfach info@modernisieren24.de: wird an postfach@lokalpilot.app weitergeleitet, Resend liefert es per Webhook
// (/api/buchung/mail, Event email.received). Die KI sortiert ein; Widerrufe sperren die Kontakte sofort.
export const POSTFACH_ADRESSEN = () =>
  (process.env.POSTFACH_ADRESSEN || "postfach@lokalpilot.app,info@modernisieren24.de").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);

export function istPostfach(empfaenger) {
  const t = JSON.stringify(empfaenger || "").toLowerCase();
  return POSTFACH_ADRESSEN().some((a) => t.includes(a));
}

const ARTEN = { widerruf: "WIDERRUF – Partner informieren", anfrage: "Neue Anfrage per E-Mail", frage: "Frage per E-Mail", beschwerde: "Beschwerde per E-Mail", partner: "Mail von Partner/Betrieb", sonstiges: "Mail an info@" };

export async function postfachEingang(resendId) {
  const m = await empfangeneMail(resendId);
  const von = String(m.from || "");
  const vonAdresse = (von.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [""])[0].toLowerCase();
  const text = ohneZitat(m.text || htmlZuText(m.html)).slice(0, 8000);
  const { result: k } = await kiJson(
    `E-Mail an das Postfach von Modernisieren24 (kostenloser Vermittlungsdienst: Interessenten bekommen Angebote von Fachbetrieben für Wärmepumpe, Solar, Heizung, Pflege usw.).

Von: ${von}
Betreff: ${m.subject || ""}
Text:
${text}

Ordne ein und gib JSON zurück:
{"art": "widerruf" | "anfrage" | "frage" | "beschwerde" | "partner" | "spam" | "sonstiges",
 "name": "", "telefon": "", "email": "", "plz": "", "kategorie": "",
 "zusammenfassung": "ein bis zwei Sätze auf Deutsch",
 "antwort_noetig": true/false}
„widerruf“ = jemand widerruft seine Einwilligung, will keine Anrufe/Mails mehr oder seine Daten löschen lassen (auch Auskunft/Löschung nach DSGVO).
„anfrage“ = jemand möchte Angebote. „partner“ = Mail eines Fachbetriebs oder Abnehmers. Werbung/Newsletter = spam.
Telefon nur, wenn es im Text steht. E-Mail = Adresse der Person, die geschrieben hat (bei weitergeleiteten Mails die ursprüngliche Absenderadresse aus dem Text).`,
    { system: "Du sortierst eingehende E-Mails für Modernisieren24.", maxTokens: 800 }
  );
  const art = k?.art in ARTEN || k?.art === "spam" ? k.art : "sonstiges";
  const eigene = (a) => !a || POSTFACH_ADRESSEN().includes(a) || /@(modernisieren24\.de|lokalpilot\.app)$/i.test(a);
  const absender = [k?.email, vonAdresse].map((a) => String(a || "").toLowerCase().trim()).find((a) => !eigene(a)) || "";
  const eintrag = await anlegen("postfach", {
    zeit: Date.now(), resendId, von, vonAdresse, betreff: String(m.subject || "").slice(0, 300), text: text.slice(0, 4000),
    art, name: k?.name || "", telefon: k?.telefon || "", email: absender, plz: k?.plz || "", kategorie: k?.kategorie || "",
    zusammenfassung: k?.zusammenfassung || "", antwortNoetig: !!k?.antwort_noetig, erledigt: art === "spam",
  });
  let betroffen = [];
  if (art === "widerruf") {
    betroffen = await widerrufSpeichern({ telefone: [k?.telefon], emails: [absender], name: k?.name || "", kanal: "E-Mail", nachweis: `Mail ${resendId}`, text });
  }
  if (art !== "spam") {
    const c = await cfg();
    await mailAnTeam(
      c,
      `${ARTEN[art]}: ${k?.name || vonAdresse}${m.subject ? ` · ${String(m.subject).slice(0, 60)}` : ""}`,
      `${art === "widerruf" ? `Widerruf eingegangen. Lokalpilot hat ${betroffen.length} Kontakt(e) gesperrt${betroffen.length ? ` (${betroffen.map((b) => b.name || b.code || b.id).join(", ")})` : " – keinen passenden Kontakt gefunden, bitte prüfen"}. Bitte Partner informieren, die den Lead schon haben, und dem Absender kurz bestätigen.\n\n` : ""}Zusammenfassung: ${k?.zusammenfassung || "–"}\n\nVon: ${von}\nBetreff: ${m.subject || ""}\n\n${text.slice(0, 3000)}`
    );
  }
  return { id: eintrag.id, art, betroffen: betroffen.length };
}
