import { NextResponse } from "next/server";
import { zuweisen } from "@/lib/telefon/daten";

// Stündlich: abgelaufene Nummern ruhen lassen bzw. freigeben, Anzeigen mit nahem Termin bekommen eine Nummer.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "not_granted" }, { status: 401 });
  try {
    const r = await zuweisen();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("Telefon: Cron", e);
    return NextResponse.json({ code: e.code || "fehler", detail: e.message }, { status: 500 });
  }
}
