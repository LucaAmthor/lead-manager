import { holen, anlegen, liste } from "@/lib/buchung/db";
import { cfg, nummerZu, kontaktZumAnruf, bereiteCaller, erreichbar, mailAnTeam } from "@/lib/telefon/daten";
import { stufe, mailbox, ausserhalbTwiml } from "@/lib/telefon/routing";
import * as tw from "@/lib/telefon/twilio";

// Twilio ruft das bei jedem eingehenden Anruf auf einer Pool-Nummer auf (VoiceUrl der Nummer).
export const dynamic = "force-dynamic";

export async function POST(request) {
  const p = await tw.formDaten(request);
  if (!tw.signaturOk(request, p)) return new Response("Signatur ungültig", { status: 403 });
  try {
    const c = await cfg();
    const nr = await nummerZu(p.To);
    const anzeigeId = nr?.anzeigeId || nr?.letzteAnzeigeId || null;
    const anzeige = anzeigeId ? await holen("anzeigen", anzeigeId) : null;
    const kampagne = anzeige?.kampagneId ? await holen("kampagnen", anzeige.kampagneId) : null;
    const blatt = anzeige?.blattId ? await holen("blaetter", anzeige.blattId) : null;
    const kontaktId = await kontaktZumAnruf({ anrufId: p.CallSid, von: p.From, nummer: nr, anzeige });
    const bereit = await bereiteCaller();
    const laufend = await liste("anrufe", (a) => ["klingelt", "laeuft"].includes(a.status) && (a.start || 0) > Date.now() - 30 * 60e3 && a.richtung !== "aus");
    const offen = erreichbar(c);
    const anruf = await anlegen(
      "anrufe",
      {
        richtung: "ein", von: p.From || "", an: p.To || "", stadtAnrufer: p.FromCity || "", nummerId: nr?.id || "", anzeigeId: anzeige?.id || "",
        code: anzeige?.code || nr?.letzterCode || "", kategorie: anzeige?.kategorie || "", kampagneId: anzeige?.kampagneId || "", kampagne: kampagne?.name || "",
        blatt: blatt?.name || "", stadt: anzeige?.stadt || blatt?.stadt || "", kanal: nr?.kanal || "print", marke: anzeige?.marke || c.marke, kontaktId, start: Date.now(),
        status: "klingelt", ausserhalb: !offen, ueberlauf: offen && laufend.length >= Math.max(1, bereit.length), nachlauf: nr?.status === "ruhend",
      },
      p.CallSid
    );
    // Anruf auf einer Nummer ohne Anzeige: der Assistent kennt weder Thema noch Ort → Team informieren (blockiert den Anruf nicht)
    if (!anzeige) {
      const nrText = nr?.anzeige || tw.national(p.To, c.ortsnetz) || p.To;
      mailAnTeam(c, `Lokalpilot: Anruf auf Nummer ohne Anzeige (${nrText})`,
        `Gerade kam ein Anruf auf ${nrText} an. Diese Nummer gehört zu keiner Anzeige${nr ? ` (Status: ${nr.status || "unbekannt"})` : " und ist nicht im Pool"}. Der Assistent kennt deshalb weder Thema noch Ort und fragt offen nach.\n\nBitte prüfen: Steht die Nummer noch auf einem alten Motiv, einem Entwurf oder in einer Werbung außerhalb von Lokalpilot?\n\nAnrufe: ${tw.appUrl()}/telefon`
      ).catch((e) => console.error("Telefon: Mail Nummer ohne Anzeige", e));
    }
    if (!offen) {
      const a = await ausserhalbTwiml(anruf, c);
      if (a) return tw.twiml(a);
      return tw.twiml(mailbox(anruf, c, c.ausserhalbText));
    }
    return tw.twiml(await stufe(anruf, c, 0));
  } catch (e) {
    console.error("Telefon: Eingang", e);
    // Im Fehlerfall den Anruf nicht verlieren: direkt auf das erste Handy-Ziel oder Ansage.
    const c = await cfg().catch(() => ({ ziele: [] }));
    const handy = (c.ziele || []).map((z) => tw.e164(z.nummer)).find(Boolean);
    if (handy) return tw.twiml(`<Dial timeout="30" callerId="${tw.xml(p.To)}"><Number>${tw.xml(handy)}</Number></Dial>`);
    return tw.twiml(tw.sag("Entschuldigung, gerade gibt es eine Störung. Bitte rufen Sie in ein paar Minuten noch einmal an."));
  }
}
