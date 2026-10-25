import { aendern, holen } from "@/lib/buchung/db";
import { cfg, kapazitaetPruefen } from "@/lib/telefon/daten";
import * as tw from "@/lib/telefon/twilio";

// Statusmeldung zum ganzen Anruf (StatusCallback der Nummer): Ende, Dauer, verpasst.
export const dynamic = "force-dynamic";

export async function POST(request) {
  const p = await tw.formDaten(request);
  if (!tw.signaturOk(request, p)) return new Response("Signatur ungültig", { status: 403 });
  const anruf = p.CallSid ? await holen("anrufe", p.CallSid) : null;
  if (!anruf) return new Response("ok");
  const patch = { dauerSek: Number(p.CallDuration || 0), ende: anruf.ende || Date.now(), twilioStatus: p.CallStatus };
  if (["klingelt", "laeuft"].includes(anruf.status)) patch.status = anruf.angenommen ? "beendet" : "verpasst";
  if ((patch.status || anruf.status) === "verpasst" && !anruf.rueckruf) patch.rueckruf = "offen";
  await aendern("anrufe", anruf.id, patch);
  try {
    await kapazitaetPruefen(await cfg());
  } catch (e) {
    console.error("Telefon: Kapazität", e);
  }
  return new Response("ok");
}
