import { NextResponse } from "next/server";
import { anzeigeZuCode, trackingCfg, zielUrl, besuchZaehlen } from "@/lib/tracking";

// Kurz-Link einer Anzeige: zählt den Besuch (Link getippt, QR gescannt oder Social) und leitet zur passenden Landingpage.
// Erreichbar als /r/<code> und – über proxy.js – direkt als <kurz-domain>/<code>.
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { code } = await params;
  const q = new URL(request.url).searchParams;
  const art = q.has("q") ? "qr" : q.has("s") ? "social" : "link";
  let ziel = "https://modernisieren24.de/";
  try {
    const cfg = await trackingCfg();
    const anzeige = await anzeigeZuCode(code);
    const quelle = art === "social" || anzeige?.trackingKanal === "social" ? "social" : "print";
    ziel = zielUrl(cfg, anzeige, { medium: art === "qr" ? "qr" : art === "social" ? "social" : "kurzlink", quelle });
    // Bots/Vorschauen (WhatsApp, Facebook) nicht mitzählen
    const ua = request.headers.get("user-agent") || "";
    if (anzeige && !/bot|crawl|spider|facebookexternalhit|whatsapp|preview|slurp/i.test(ua)) await besuchZaehlen(anzeige, art);
  } catch (e) {
    console.error("Kurz-Link", e);
  }
  return NextResponse.redirect(ziel, { status: 302, headers: { "Cache-Control": "no-store" } });
}
