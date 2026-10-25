import { anlegen, holen, liste } from "@/lib/buchung/db";
import * as tw from "@/lib/telefon/twilio";

// Rückruf aus dem Browser (TwiML-App „Lokalpilot Rückruf“). Nur deutsche Ziele, keine Sonderrufnummern.
export const dynamic = "force-dynamic";
const GESPERRT = /^\+49(900|137|138|118|180|190|191|192|193|194|195|196|197|198|199|12)/;

export async function POST(request) {
  const p = await tw.formDaten(request);
  if (!tw.signaturOk(request, p)) return new Response("Signatur ungültig", { status: 403 });
  const ziel = tw.e164(p.To);
  if (!ziel || !ziel.startsWith("+49") || GESPERRT.test(ziel)) return tw.twiml(tw.sag("Diese Nummer kann von hier nicht angerufen werden.") + "<Hangup/>");
  const vorher = p.anrufId ? await holen("anrufe", p.anrufId) : null;
  // Absender: die Nummer, die der Kunde angerufen hat (er erkennt sie wieder), sonst irgendeine Pool-Nummer.
  let absender = vorher?.an || "";
  if (!absender) absender = (await liste("nummern", (n) => n.status !== "gesperrt"))[0]?.e164 || "";
  if (!absender) return tw.twiml(tw.sag("Es gibt noch keine Rufnummer für Rückrufe.") + "<Hangup/>");
  const identitaet = String(p.From || "").replace(/^client:/, "");
  await anlegen(
    "anrufe",
    {
      richtung: "aus", von: absender, an: ziel, angenommenVon: identitaet, rueckrufZu: vorher?.id || "", anzeigeId: vorher?.anzeigeId || "", code: vorher?.code || "",
      kategorie: vorher?.kategorie || "", kontaktId: vorher?.kontaktId || "", start: Date.now(), status: "laeuft",
    },
    p.CallSid
  );
  const weiter = tw.xml(`${tw.appUrl()}/api/telefon/weiter?${new URLSearchParams({ anruf: p.CallSid, stufe: "0" })}`);
  return tw.twiml(`<Dial callerId="${tw.xml(absender)}" answerOnBridge="true" timeout="40" action="${weiter}" method="POST"><Number>${tw.xml(ziel)}</Number></Dial>`);
}
