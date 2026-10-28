import { NextResponse } from "next/server";
import { zuweisen } from "@/lib/telefon/daten";
import { loeschfristen } from "@/lib/datenschutz";
import { wochenAuswertung } from "@/lib/telefon/auswertung";

// Stündlich: abgelaufene Nummern ruhen lassen bzw. freigeben (…). Täglich: Löschfristen (lib/datenschutz.js).
// Bisher: abgelaufene Nummern ruhen lassen bzw. freigeben, Anzeigen mit nahem Termin bekommen eine Nummer.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "not_granted" }, { status: 401 });
  try {
    const r = await zuweisen();
    // Einmal am Tag (gegen 3 Uhr UTC) die Löschfristen anwenden
    let datenschutz = null;
    if (new Date().getUTCHours() === 3 || new URL(request.url).searchParams.get("loeschen") === "1") {
      datenschutz = await loeschfristen().catch((e) => ({ fehler: [e.message] }));
      if (datenschutz?.fehler?.length) console.error("Datenschutz: Löschfristen", datenschutz.fehler);
    }
    // Montags gegen 6 Uhr UTC (7/8 Uhr deutsche Zeit): Wochen-Auswertung der Gespräche (oder ?auswertung=1)
    let auswertung = null;
    const d = new Date();
    if ((d.getUTCDay() === 1 && d.getUTCHours() === 6) || new URL(request.url).searchParams.get("auswertung") === "1") {
      auswertung = await wochenAuswertung().catch((e) => { console.error("Telefon: Wochen-Auswertung", e); return { fehler: e.message }; });
    }
    return NextResponse.json({ ok: true, ...r, datenschutz, auswertung });
  } catch (e) {
    console.error("Telefon: Cron", e);
    return NextResponse.json({ code: e.code || "fehler", detail: e.message }, { status: 500 });
  }
}
