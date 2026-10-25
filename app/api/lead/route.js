import { NextResponse } from "next/server";
import { anlegen, liste } from "@/lib/buchung/db";
import { anzeigeZuCode } from "@/lib/tracking";

// Leads von der Website (z. B. Funnel auf modernisieren24.de) mit Anzeigen-Code.
// Zwei Wege: aus dem Browser (Herkunft muss in LEAD_ORIGINS stehen) oder vom Server der Website mit Header x-lp-key = LEAD_SECRET.
export const dynamic = "force-dynamic";

const erlaubt = () => (process.env.LEAD_ORIGINS || "https://modernisieren24.de,https://www.modernisieren24.de").split(",").map((s) => s.trim()).filter(Boolean);
function cors(origin) {
  return erlaubt().includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" } : {};
}
export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get("origin") || "") });
}

const s = (x, n = 300) => String(x ?? "").trim().slice(0, n);

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  const vertraut = process.env.LEAD_SECRET && request.headers.get("x-lp-key") === process.env.LEAD_SECRET;
  if (!vertraut && !erlaubt().includes(origin)) return NextResponse.json({ code: "not_granted" }, { status: 403 });
  const h = cors(origin);
  const b = await request.json().catch(() => null);
  if (!b || b.website) return NextResponse.json({ ok: true }, { headers: h }); // Honigtopf-Feld „website“ = Bot
  const telefon = s(b.telefon, 40), email = s(b.email, 200).toLowerCase();
  if (!telefon && !email) return NextResponse.json({ code: "invalid_argument", detail: "Telefon oder E-Mail fehlt" }, { status: 400, headers: h });
  try {
    const anzeige = b.code ? await anzeigeZuCode(b.code) : null;
    // Doppelte Absendungen (gleiche Nummer/E-Mail in 10 Minuten) nur einmal zählen
    const grenze = Date.now() - 10 * 60e3;
    const doppelt = await liste("kontakte", (k) => (k.createdAt || 0) > grenze && k.quelle === "web" && ((telefon && k.telefon === telefon) || (email && k.email === email)));
    if (doppelt.length) return NextResponse.json({ ok: true, id: doppelt[0].id }, { headers: h });
    const medium = s(b.medium, 20);
    const k = await anlegen("kontakte", {
      anzeigeId: anzeige?.id || "", code: anzeige?.code || s(b.code, 24).toUpperCase(), kategorie: s(b.kategorie, 60) || anzeige?.kategorie || "", kampagneId: anzeige?.kampagneId || "",
      kanal: medium === "qr" ? "QR-Code" : "URL", quelle: "web", herkunft: s(b.quelle, 20) === "social" ? "social" : anzeige ? "print" : "online",
      datum: new Date().toISOString().slice(0, 10), name: s(b.name, 120), telefon, email, plz: s(b.plz, 10), ort: s(b.ort, 80),
      antworten: b.antworten && typeof b.antworten === "object" ? Object.fromEntries(Object.entries(b.antworten).slice(0, 30).map(([k2, v]) => [s(k2, 80), s(v)])) : {},
      einwilligung: !!b.einwilligung, einwilligungText: s(b.einwilligungText, 1000), seite: s(b.seite, 300), qualifiziert: false, erloes: 0, notiz: "", createdAt: Date.now(),
    });
    return NextResponse.json({ ok: true, id: k.id }, { headers: h });
  } catch (e) {
    console.error("Lead", e);
    return NextResponse.json({ code: "fehler" }, { status: 500, headers: h });
  }
}
