import { NextResponse } from "next/server";
import { orteZurPlz } from "@/lib/telefon/plz";

// Werkzeug für den digitalen Assistenten (ElevenLabs): Postleitzahl → Ort, damit er den Ort nicht erfragen muss.
// Öffentlich, speichert nichts.
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { plz, orte } = orteZurPlz(new URL(request.url).searchParams.get("plz"));
  if (!plz) return NextResponse.json({ gefunden: false, hinweis: "Keine gültige fünfstellige Postleitzahl verstanden. Bitte die Postleitzahl noch einmal Ziffer für Ziffer erfragen." });
  if (!orte.length) return NextResponse.json({ gefunden: false, plz, hinweis: "Zu dieser Postleitzahl ist kein Ort bekannt. Frage, ob die Postleitzahl stimmt, und sonst nach dem Wohnort." });
  return NextResponse.json({
    gefunden: true, plz, ort: orte[0], orte,
    hinweis: orte.length === 1 ? `Bestätige kurz: „Das ist in ${orte[0]}, richtig?“` : `Mehrere Orte möglich: ${orte.join(", ")}. Frage, welcher davon es ist.`,
  });
}
