import { NextResponse } from "next/server";
import { istMitglied } from "@/lib/telefon/auth";
import { aendern, holen } from "@/lib/buchung/db";
import { textSenden, kiAntworten, waKonfiguriert } from "@/lib/whatsapp";

// Aktionen der Seite /whatsapp: Antwort senden, Modus KI/Mensch, erledigt, gelesen.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await istMitglied())) return NextResponse.json({ code: "not_granted" }, { status: 401 });
  return NextResponse.json({ env: { whatsapp: waKonfiguriert(), verify: !!process.env.WHATSAPP_VERIFY_TOKEN, secret: !!process.env.WHATSAPP_APP_SECRET, ki: !!process.env.ANTHROPIC_API_KEY, appUrl: process.env.APP_URL || "" } });
}

export async function POST(request) {
  const user = await istMitglied();
  if (!user) return NextResponse.json({ code: "not_granted" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const chat = b.chatId ? await holen("wa_chats", b.chatId) : null;
  if (!chat) return NextResponse.json({ code: "not_found" }, { status: 404 });
  try {
    switch (b.aktion) {
      case "senden":
        if (!String(b.text || "").trim()) return NextResponse.json({ code: "invalid_argument" }, { status: 400 });
        await textSenden(chat.id, String(b.text), user.email);
        // Wer selbst schreibt, übernimmt den Chat (KI pausiert)
        await aendern("wa_chats", chat.id, { modus: "mensch", status: chat.status === "braucht_mensch" ? "offen" : chat.status, ungelesen: 0, bearbeiter: user.email });
        return NextResponse.json({ ok: true });
      case "modus":
        await aendern("wa_chats", chat.id, { modus: b.modus === "ki" ? "ki" : "mensch", ...(b.modus === "ki" && chat.status === "braucht_mensch" ? { status: "offen" } : {}) });
        if (b.modus === "ki" && chat.letzteVon === "kunde") await kiAntworten(chat.id);
        return NextResponse.json({ ok: true });
      case "erledigt":
        await aendern("wa_chats", chat.id, { status: b.wert === false ? "offen" : "erledigt", ungelesen: 0 });
        return NextResponse.json({ ok: true });
      case "gelesen":
        await aendern("wa_chats", chat.id, { ungelesen: 0 });
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ code: "invalid_argument" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ code: e.code || "fehler", detail: e.message }, { status: e.code === "fenster_zu" ? 409 : 500 });
  }
}
