import { NextResponse } from "next/server";
import { signaturOk, ergebnisSpeichern } from "@/lib/telefon/assistent";
import { cfg, mailAnTeam } from "@/lib/telefon/daten";
import * as tw from "@/lib/telefon/twilio";

// Post-Call-Webhook von ElevenLabs: Zusammenfassung und Angaben des Gesprächs mit dem digitalen Assistenten.
export const dynamic = "force-dynamic";

export async function POST(request) {
  const roh = await request.text();
  if (!signaturOk(roh, request.headers.get("elevenlabs-signature"))) return new Response("Signatur ungültig", { status: 401 });
  let body;
  try { body = JSON.parse(roh); } catch { return new Response("ok"); }
  if (body.type !== "post_call_transcription" || !body.data) return NextResponse.json({ ok: true });
  try {
    const r = await ergebnisSpeichern(body.data);
    if (r.anruf && r.sagteEtwas) {
      const c = await cfg();
      const a = r.angaben;
      await mailAnTeam(
        c,
        `${r.widerruf ? "WIDERRUF – Partner informieren" : r.einwilligung && !r.rueckrufGewuenscht ? "Neuer Lead (Einwilligung da)" : "Rückruf nötig"}: ${a.name || tw.national(r.anruf.von)}${r.anruf.kategorie ? ` · ${r.anruf.kategorie}` : ""}${r.anruf.code ? ` · ${r.anruf.code}` : ""}`,
        `${r.widerruf ? "Der Anrufer hat seine Einwilligung widerrufen bzw. will keine Anrufe mehr. Lokalpilot hat seine Kontakte gesperrt. Bitte alle Partner, die den Lead schon bekommen haben, informieren, dass sie ihn nicht mehr kontaktieren und die Daten löschen.\n\n" : ""}Der digitale Assistent hat einen Anruf angenommen. ${r.einwilligung ? "Einwilligung zur Weitergabe: ja." : "Keine Einwilligung zur Weitergabe."}${r.rueckrufGewuenscht ? " Anrufer wünscht einen persönlichen Rückruf." : ""}\n\nAnrufer: ${tw.national(r.anruf.von)}${a.rueckrufnummer ? ` (Rückruf an: ${a.rueckrufnummer})` : ""}\n${Object.entries(a).filter(([k]) => k !== "rueckrufnummer").map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nZusammenfassung: ${r.zusammenfassung || "–"}\n\nZurückrufen: ${tw.appUrl()}/telefon`
      );
    }
  } catch (e) {
    console.error("Telefon: Assistent-Webhook", e);
  }
  return NextResponse.json({ ok: true });
}
