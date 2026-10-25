import { aendern, holen } from "@/lib/buchung/db";
import { cfg } from "@/lib/telefon/daten";
import { stufe } from "@/lib/telefon/routing";
import * as tw from "@/lib/telefon/twilio";

// Ende einer Klingel-Stufe (<Dial action>): angenommen → fertig, sonst nächste Stufe bzw. Mailbox.
export const dynamic = "force-dynamic";

export async function POST(request) {
  const p = await tw.formDaten(request);
  if (!tw.signaturOk(request, p)) return new Response("Signatur ungültig", { status: 403 });
  const q = new URL(request.url).searchParams;
  const id = q.get("anruf");
  const s = Number(q.get("stufe") || 0);
  const anruf = id ? await holen("anrufe", id) : null;
  if (!anruf) return tw.twiml("<Hangup/>");
  const st = p.DialCallStatus;
  if (st === "completed" || st === "answered") {
    await aendern("anrufe", id, { status: "beendet", angenommen: true, gespraechSek: Number(p.DialCallDuration || 0), ende: Date.now() });
    return tw.twiml("<Hangup/>");
  }
  if (anruf.richtung === "aus") {
    await aendern("anrufe", id, { status: "nicht_erreicht", ende: Date.now() });
    return tw.twiml("<Hangup/>");
  }
  if (p.CallStatus === "completed" || st === "canceled") {
    // Anrufer hat während des Klingelns aufgelegt
    await aendern("anrufe", id, { status: "verpasst", aufgelegtBeiStufe: s, ende: Date.now() });
    return tw.twiml("<Hangup/>");
  }
  const c = await cfg();
  return tw.twiml(await stufe(anruf, c, s + 1));
}
