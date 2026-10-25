import { NextResponse, after } from "next/server";
import { aendern, holen } from "@/lib/buchung/db";
import { signaturOk, eingang, kiAntworten } from "@/lib/whatsapp";

// Webhook der Meta Cloud API: GET = Bestätigung beim Einrichten, POST = Nachrichten und Zustellstatus.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && q.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) return new Response(q.get("hub.challenge") || "", { status: 200 });
  return new Response("Nein", { status: 403 });
}

export async function POST(request) {
  const roh = await request.text();
  if (!signaturOk(roh, request.headers.get("x-hub-signature-256"))) return new Response("Signatur ungültig", { status: 403 });
  let body;
  try { body = JSON.parse(roh); } catch { return new Response("ok"); }
  const chats = new Set();
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const namen = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || ""]));
      for (const m of v.messages || []) {
        try { const chat = await eingang(m, namen[m.from]); if (chat) chats.add(chat.id); } catch (e) { console.error("WhatsApp: Eingang", e); }
      }
      for (const s of v.statuses || []) {
        try { if (s.id && (await holen("wa_nachrichten", s.id))) await aendern("wa_nachrichten", s.id, { status: s.status, ...(s.errors ? { fehler: s.errors[0]?.title || "Fehler" } : {}) }); } catch {}
      }
    }
  }
  // Antworten erst nach der Quittung an Meta (sonst wiederholt Meta den Webhook). Kurz warten, falls mehrere Nachrichten nacheinander kommen.
  if (chats.size) after(async () => {
    await new Promise((r) => setTimeout(r, 4000));
    for (const id of chats) {
      try { await kiAntworten(id); } catch (e) { console.error("WhatsApp: KI", e); await aendern("wa_chats", id, { status: "braucht_mensch", uebergabeGrund: "KI-Fehler: " + e.message }).catch(() => {}); }
    }
  });
  return NextResponse.json({ ok: true });
}
