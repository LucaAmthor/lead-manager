import { aendern, holen } from "@/lib/buchung/db";
import { cfg, mailAnTeam } from "@/lib/telefon/daten";
import * as tw from "@/lib/telefon/twilio";

// Mailbox: action (nach der Aufnahme) und recordingStatusCallback (Aufnahme fertig gespeichert, art=fertig).
export const dynamic = "force-dynamic";

export async function POST(request) {
  const p = await tw.formDaten(request);
  if (!tw.signaturOk(request, p)) return new Response("Signatur ungültig", { status: 403 });
  const q = new URL(request.url).searchParams;
  const id = q.get("anruf");
  const anruf = id ? await holen("anrufe", id) : null;
  if (q.get("art") !== "fertig") return tw.twiml(tw.sag("Vielen Dank. Wir melden uns.") + "<Hangup/>");
  if (!anruf) return new Response("ok");
  const dauer = Number(p.RecordingDuration || 0);
  if (p.RecordingStatus !== "completed" || dauer < 2) {
    await aendern("anrufe", id, { status: "verpasst", mailboxLeer: true });
    return new Response("ok");
  }
  await aendern("anrufe", id, { status: "mailbox", aufnahmeSid: p.RecordingSid, aufnahmeSek: dauer, rueckruf: "offen" });
  const c = await cfg();
  if (c.mailboxMail !== false) {
    await mailAnTeam(
      c,
      `Mailbox: ${tw.national(anruf.von)}${anruf.code ? ` · ${anruf.code}` : ""}${anruf.kategorie ? ` · ${anruf.kategorie}` : ""}`,
      `Neue Nachricht (${dauer} s) von ${tw.national(anruf.von)}${anruf.stadtAnrufer ? ` (${anruf.stadtAnrufer})` : ""}.\nAnzeige: ${anruf.code || "unbekannt"}${anruf.blatt ? ` · ${anruf.blatt}` : ""}\n\nAnhören und zurückrufen: ${tw.appUrl()}/telefon`
    );
  }
  return new Response("ok");
}
