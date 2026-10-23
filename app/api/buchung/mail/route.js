import { NextResponse, after } from "next/server";
import { signaturOk } from "@/lib/buchung/mail";
import { mailEingang } from "@/lib/buchung/agent";

// Resend-Webhook „email.received“: Antworten der Verlage kommen hier an.
// In Resend: Webhooks → Endpoint https://<app>/api/buchung/mail, Event email.received, Secret als RESEND_WEBHOOK_SECRET.
export const maxDuration = 300;

export async function POST(request) {
  const roh = await request.text();
  if (!signaturOk(roh, request.headers)) return NextResponse.json({ code: "signatur" }, { status: 401 });
  let ev;
  try {
    ev = JSON.parse(roh);
  } catch {
    return NextResponse.json({ code: "invalid_argument" }, { status: 400 });
  }
  if (ev.type !== "email.received" || !ev.data?.email_id) return NextResponse.json({ ok: true, ignoriert: ev.type });
  const id = ev.data.email_id;
  // sofort 200 zurück (Resend wiederholt sonst), Auswertung danach
  after(async () => {
    try {
      await mailEingang(id);
    } catch (e) {
      console.error("Buchung: Mail-Eingang fehlgeschlagen", id, e);
    }
  });
  return NextResponse.json({ ok: true });
}
