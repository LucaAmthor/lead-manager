import { NextResponse } from "next/server";
import { tick } from "@/lib/buchung/agent";
import { rechercheWeiter } from "@/lib/buchung/recherche";

// Stündlicher Lauf (vercel.json → crons): neue Buchungen anlegen (wenn Automatik an), Shop-Buchungen ausführen,
// Druckdaten senden, nachfassen. Vercel schickt „Authorization: Bearer $CRON_SECRET“ mit.
export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "not_granted" }, { status: 401 });
  try {
    const bericht = await tick({ zeitBudgetMs: 6 * 60 * 1000 });
    // Recherche-Agent: offene Verlags-Vorschläge im Detail recherchieren
    const recherche = await rechercheWeiter({ zeitBudgetMs: 5 * 60 * 1000, max: 6 }).catch((e) => ({ fehler: [e.message] }));
    return NextResponse.json({ ok: true, ...bericht, recherche });
  } catch (e) {
    console.error("Buchung: Cron fehlgeschlagen", e);
    return NextResponse.json({ code: e.code || "fehler", detail: e.message }, { status: 500 });
  }
}
