import { NextResponse } from "next/server";
import { istMitglied } from "@/lib/telefon/auth";
import { adminDb, holen, aendern } from "@/lib/buchung/db";

// Fertiges Motiv an eine Anzeige hängen: Druck-PDF (exaktes Druckmaß) + Vorschaubild, beide als Base64.
// Legt sie im Bildspeicher (lp-bilder) ab und setzt motiv.druckPdfUrl / motiv.bildUrl. Optional weitere Felder der Anzeige.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fehler = (code, status, extra = {}) => NextResponse.json({ code, ...extra }, { status });
const ERLAUBT = ["viral", "ton", "layout", "botschaft", "datum", "nummerBehalten"];

export async function POST(request) {
  const user = await istMitglied();
  if (!user) return fehler("not_granted", 401);
  const b = await request.json().catch(() => ({}));
  const a = b.anzeigeId ? await holen("anzeigen", b.anzeigeId) : null;
  if (!a) return fehler("not_found", 404);
  const sb = adminDb();
  const motiv = { ...(a.motiv || {}), ...(b.motiv && typeof b.motiv === "object" ? b.motiv : {}) };
  for (const [feld, typ, endung] of [["pdfBase64", "application/pdf", "pdf"], ["bildBase64", b.bildTyp || "image/png", (b.bildTyp || "").includes("jpeg") ? "jpg" : "png"]]) {
    if (!b[feld]) continue;
    const pfad = `motive/${a.code || a.id}-${Date.now()}.${endung}`;
    const { error } = await sb.storage.from("lp-bilder").upload(pfad, Buffer.from(String(b[feld]), "base64"), { contentType: typ, upsert: false });
    if (error) return fehler("speicher", 500, { detail: error.message });
    const url = sb.storage.from("lp-bilder").getPublicUrl(pfad).data.publicUrl;
    if (endung === "pdf") motiv.druckPdfUrl = url;
    else Object.assign(motiv, { typ: "bild", bildUrl: url, bildAssetId: pfad });
  }
  motiv.motivVon = user.email;
  motiv.motivAm = new Date().toISOString();
  const extra = Object.fromEntries(Object.entries(b.anzeige || {}).filter(([k]) => ERLAUBT.includes(k)));
  await aendern("anzeigen", a.id, { motiv, ...extra });
  return NextResponse.json({ ok: true, motiv });
}
