import { NextResponse } from "next/server";
import { postausgang } from "@/lib/buchung/agent";

// Alle 10 Minuten (vercel.json → crons): geplante Mails an Verlage senden, deren Versandzeit gekommen ist.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "not_granted" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await postausgang()) });
  } catch (e) {
    console.error("Buchung: Postausgang fehlgeschlagen", e);
    return NextResponse.json({ code: e.code || "fehler", detail: e.message }, { status: 500 });
  }
}
