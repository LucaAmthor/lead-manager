import { istMitglied } from "@/lib/telefon/auth";
import * as tw from "@/lib/telefon/twilio";

// Mailbox-Aufnahme für angemeldete Mitglieder durchreichen
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!(await istMitglied())) return new Response("Kein Zugang", { status: 401 });
  const s = new URL(request.url).searchParams.get("sid") || "";
  if (!/^RE[0-9a-f]{32}$/i.test(s)) return new Response("Ungültig", { status: 400 });
  try {
    const r = await tw.aufnahmeLaden(s);
    return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
}
