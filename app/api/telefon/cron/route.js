import { NextResponse } from "next/server";
import { zuweisen } from "@/lib/telefon/daten";
import { loeschfristen } from "@/lib/datenschutz";

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
    return NextResponse.json({ ok: true, ...r, datenschutz });
  } catch (e) {
    console.error("Telefon: Cron", e);
    return NextResponse.json({ code: e.code || "fehler", detail: e.message }, { status: 500 });
  }
}
