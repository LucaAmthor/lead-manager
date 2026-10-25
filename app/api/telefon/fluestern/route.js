import { aendern, holen } from "@/lib/buchung/db";
import { cfg } from "@/lib/telefon/daten";
import * as tw from "@/lib/telefon/twilio";

// Ansage für die Person am Handy, bevor der Anrufer durchgestellt wird. Mit „Taste 1“ verhindern wir,
// dass die Handy-Mailbox den Anruf schluckt: ohne Tastendruck geht es zur nächsten Stufe.
export const dynamic = "force-dynamic";

export async function POST(request) {
  const p = await tw.formDaten(request);
  if (!tw.signaturOk(request, p)) return new Response("Signatur ungültig", { status: 403 });
  const q = new URL(request.url).searchParams;
  const id = q.get("anruf");
  const s = q.get("stufe") || "0";
  const anruf = id ? await holen("anrufe", id) : null;
  const c = await cfg();
  const ziel = c.ziele?.[Number(s)] || {};
  const annehmen = async () => {
    if (anruf) await aendern("anrufe", id, { status: "laeuft", angenommen: true, angenommenVon: ziel.name || "Handy", angenommenAm: Date.now() });
    return tw.twiml("");
  };
  if (q.get("ok")) return p.Digits === "1" ? annehmen() : tw.twiml("<Hangup/>");
  const was = [anruf?.marke || c.marke, anruf?.kategorie, anruf?.code ? `Anzeige ${anruf.code.split("").join(" ")}` : "", anruf?.stadt].filter(Boolean).join(", ");
  if (!c.bestaetigen) {
    await annehmen();
    return tw.twiml(tw.sag(`Lead-Anruf: ${was}.`));
  }
  const ok = tw.xml(`${tw.appUrl()}/api/telefon/fluestern?${new URLSearchParams({ anruf: id || "", stufe: s, ok: "1" })}`);
  return tw.twiml(`<Gather numDigits="1" timeout="6" action="${ok}" method="POST">${tw.sag(`Lead-Anruf: ${was}. Zum Annehmen die 1 drücken.`)}</Gather><Hangup/>`);
}
