import { NextResponse } from "next/server";
import { tick } from "@/lib/buchung/agent";

// Stündlicher Lauf (vercel.json → crons): neue Buchungen anlegen (wenn Automatik an), Shop-Buchungen ausführen,
// Druckdaten senden, nachfassen. Vercel schickt „Authorization: Bearer $CRON_SECRET“ mit.
export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "not_granted" }, { status: 401 });
  try {
    const bericht = await tick({ zeitBudgetMs: 12 * 60 * 1000 });
    return NextResponse.json({ ok: true, ...bericht });
  } catch (e) {
    console.error("Buchung: Cron fehlgeschlagen", e);
    return NextResponse.json({ code: e.code || "fehler", detail: e.message }, { status: 500 });
  }
}
