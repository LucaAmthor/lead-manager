import { NextResponse } from "next/server";
import { anzeigeZuCode, trackingCfg, zielUrl, besuchZaehlen, istTestBesuch, geraetArt, TEST_COOKIE } from "@/lib/tracking";

// Kurz-Link einer Anzeige: zählt den Besuch (Link getippt, QR gescannt oder Social) und leitet zur passenden Landingpage.
// Erreichbar als /r/<code> und – über proxy.js – direkt als <kurz-domain>/<code>.
export const dynamic = "force-dynamic";

// Eigene Geräte als Testgerät markieren: <kurz-domain>/testgeraet (bzw. /r/testgeraet), aufheben mit /testgeraet-aus.
// Das Cookie gilt nur für die Domain, auf der die Seite geöffnet wurde.
function testgeraetSeite(an) {
  const text = an
    ? "Dieses Gerät ist jetzt als Testgerät markiert. Aufrufe von Kurz-Links und QR-Codes zählen in Lokalpilot als Test, nicht als Leser."
    : "Dieses Gerät zählt wieder als normaler Besucher.";
  const html = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Testgerät</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.3rem">${an ? "Testgerät aktiv" : "Testgerät aus"}</h1><p>${text}</p></body></html>`;
  const res = new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  res.cookies.set(TEST_COOKIE, an ? "1" : "", { path: "/", maxAge: an ? 60 * 60 * 24 * 730 : 0, sameSite: "lax", secure: true, httpOnly: true });
  return res;
}

export async function GET(request, { params }) {
  const { code } = await params;
  const c = String(code || "").toLowerCase();
  if (c === "testgeraet" || c === "testgeraet-aus") return testgeraetSeite(c === "testgeraet");
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
    if (anzeige && !/bot|crawl|spider|facebookexternalhit|whatsapp|preview|slurp/i.test(ua)) await besuchZaehlen(anzeige, art, { test: istTestBesuch(request), geraet: geraetArt(ua) });
  } catch (e) {
    console.error("Kurz-Link", e);
  }
  return NextResponse.redirect(ziel, { status: 302, headers: { "Cache-Control": "no-store" } });
}
