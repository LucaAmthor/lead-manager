import QRCode from "qrcode";
import { holen } from "@/lib/buchung/db";
import { kurzUrl } from "@/lib/tracking";
import { istMitglied } from "@/lib/telefon/auth";
import { waLink } from "@/lib/whatsapp";
import { anzeigeZuCode } from "@/lib/tracking";

// QR-Code einer Anzeige zum Einsetzen ins Motiv: /api/qr?code=SZ-WP-001&format=svg|png (&art=social)
// Der QR führt auf den Kurz-Link mit ?q=1, so zählen Scans getrennt vom getippten Link.
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!(await istMitglied())) return new Response("Kein Zugang", { status: 401 });
  const q = new URL(request.url).searchParams;
  const code = (q.get("code") || "").toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(code)) return new Response("Code fehlt", { status: 400 });
  const allg = (await holen("einstellungen", "allgemein")) || {};
  const basis = allg.basisUrl || `${String(process.env.APP_URL || "").replace(/\/+$/, "")}/r`;
  let url = kurzUrl(basis, code, q.get("art") === "social" ? "social" : "qr");
  let name = `QR-${code}`;
  if (q.get("art") === "wa") {
    const a = await anzeigeZuCode(code);
    url = waLink(allg.waNummer, code, a?.kategorie);
    if (!url) return new Response("WhatsApp-Nummer fehlt in den Einstellungen", { status: 409 });
    name = `WhatsApp-QR-${code}`;
  }
  if (q.get("format") === "png") {
    const buf = await QRCode.toBuffer(url, { errorCorrectionLevel: "M", margin: 2, width: 1200 });
    return new Response(buf, { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${name}.png"` } });
  }
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Content-Disposition": `attachment; filename="${name}.svg"` } });
}
