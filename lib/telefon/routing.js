import { holen, aendern, liste } from "@/lib/buchung/db";
import { bereiteCaller, fuell } from "@/lib/telefon/daten";
import * as tw from "@/lib/telefon/twilio";
import { mailboxAbfrage } from "@/lib/telefon/skripte";

// Anruf-Weg: Stufen aus einstellungen/telefon.ziele, z. B. erst alle bereiten Browser (20 s), dann Flos Handy (25 s),
// dann Mailbox. Für die Übergabe an einen externen Telefondienst trägt man dessen Nummer als erste Stufe ein.
const url = (pfad, q) => `${tw.appUrl()}${pfad}?${new URLSearchParams(q)}`;

export function mailbox(anruf, c, text) {
  const marke = anruf.marke || c.marke;
  // {abfrage}: was die Mailbox je Kategorie abfragt. Steht es nicht im Text, wird es nach dem ersten Satz mit „Bitte nennen Sie …“ ergänzt.
  let t = text || c.mailboxText;
  if (!t.includes("{abfrage}") && /Ihren Namen/.test(t) === false) t += " Bitte nennen Sie nach dem Signalton {abfrage}";
  return (
    tw.sag(fuell(t, { marke, abfrage: mailboxAbfrage(anruf.kategorie, c.skripte) })) +
    `<Record maxLength="180" timeout="6" playBeep="true" finishOnKey="#" action="${tw.xml(url("/api/telefon/mailbox", { anruf: anruf.id }))}" method="POST" recordingStatusCallback="${tw.xml(url("/api/telefon/mailbox", { anruf: anruf.id, art: "fertig" }))}" recordingStatusCallbackMethod="POST"/>` +
    tw.sag("Vielen Dank. Wir melden uns.") +
    "<Hangup/>"
  );
}

/** TwiML für Stufe i oder die nächste nutzbare danach. Gibt [twiml, genutzteStufe] zurück. */
export async function stufe(anruf, c, i) {
  const ziele = c.ziele || [];
  for (let s = i; s < ziele.length; s++) {
    const z = ziele[s];
    if (z.aktiv === false) continue; // pausierte Stufe (z. B. Handy, das gerade nicht klingeln soll)
    const sek = Math.max(5, Math.min(60, Number(z.sekunden) || 20));
    const weiter = tw.xml(url("/api/telefon/weiter", { anruf: anruf.id, stufe: String(s) }));
    if (z.typ === "browser") {
      const besetzt = new Set((await liste("anrufe", (a) => a.status === "laeuft" && a.angenommenVon)).map((a) => a.angenommenVon));
      const caller = (await bereiteCaller()).filter((p) => !besetzt.has(p.id));
      if (!caller.length) continue;
      const clients = caller
        .map((p) => `<Client><Identity>${tw.xml(p.id)}</Identity><Parameter name="anrufId" value="${tw.xml(anruf.id)}"/><Parameter name="code" value="${tw.xml(anruf.code || "")}"/></Client>`)
        .join("");
      await aendern("anrufe", anruf.id, { stufe: s, klingeltBei: caller.map((p) => p.id) });
      return `<Dial timeout="${sek}" answerOnBridge="true" callerId="${tw.xml(anruf.von || "")}" action="${weiter}" method="POST">${clients}</Dial>`;
    }
    if (z.typ === "nummer") {
      const ziel = tw.e164(z.nummer);
      if (!ziel) continue;
      await aendern("anrufe", anruf.id, { stufe: s, klingeltBei: [z.name || ziel] });
      const fl = tw.xml(url("/api/telefon/fluestern", { anruf: anruf.id, stufe: String(s) }));
      // Anzeigen-Nummer als Absender: Flo sieht sofort, dass es ein Lead-Anruf ist. Die Nummer des Anrufers steht in Lokalpilot.
      return `<Dial timeout="${sek}" answerOnBridge="true" callerId="${tw.xml(anruf.an)}" action="${weiter}" method="POST"><Number url="${fl}" method="POST">${tw.xml(ziel)}</Number></Dial>`;
    }
  }
  await aendern("anrufe", anruf.id, { status: "mailbox", stufe: ziele.length });
  return mailbox(anruf, c);
}

export const anrufHolen = (id) => holen("anrufe", id);
