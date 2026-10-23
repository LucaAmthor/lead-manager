import { PDFDocument, rgb } from "pdf-lib";

// Druck-PDF aus dem Anzeigenmotiv: exakte Maße in mm, Motiv vollständig eingepasst (nichts abgeschnitten),
// Rest weiß. Optional Beschnitt rundum. Reicht für Anzeigenblätter; für 300 dpi muss das Motiv groß genug sein.
const MM = 72 / 25.4;

export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export function bildUrlAbsolut(url) {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  return appUrl() + (url.startsWith("/") ? url : "/" + url);
}

export async function druckPdf(anzeige, { breiteMm, hoeheMm, beschnittMm = 0 }) {
  const url = bildUrlAbsolut(anzeige?.motiv?.druckPdfUrl ? null : anzeige?.motiv?.bildUrl);
  if (anzeige?.motiv?.druckPdfUrl) {
    const r = await fetch(bildUrlAbsolut(anzeige.motiv.druckPdfUrl));
    if (r.ok) return { bytes: new Uint8Array(await r.arrayBuffer()), name: `${anzeige.code || "anzeige"}.pdf`, hinweis: "fertiges Druck-PDF" };
  }
  if (!url) throw Object.assign(new Error(`Anzeige ${anzeige?.code} hat noch kein Bild`), { code: "kein_motiv" });
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error(`Bild nicht ladbar (${r.status})`), { code: "kein_motiv" });
  const typ = r.headers.get("content-type") || "";
  const daten = new Uint8Array(await r.arrayBuffer());
  const b = Math.max(10, Number(breiteMm) || 90) + 2 * beschnittMm;
  const h = Math.max(10, Number(hoeheMm) || 120) + 2 * beschnittMm;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${anzeige.code || "Anzeige"} ${breiteMm}x${hoeheMm} mm`);
  pdf.setProducer("Lokalpilot");
  const seite = pdf.addPage([b * MM, h * MM]);
  seite.drawRectangle({ x: 0, y: 0, width: b * MM, height: h * MM, color: rgb(1, 1, 1) });
  const istPng = /png/.test(typ) || (daten[0] === 0x89 && daten[1] === 0x50);
  const bild = istPng ? await pdf.embedPng(daten) : await pdf.embedJpg(daten);
  const skala = Math.min((b * MM) / bild.width, (h * MM) / bild.height);
  const w = bild.width * skala;
  const hh = bild.height * skala;
  seite.drawImage(bild, { x: (b * MM - w) / 2, y: (h * MM - hh) / 2, width: w, height: hh });
  const dpi = Math.round(bild.width / (w / 72));
  return {
    bytes: await pdf.save(),
    name: `${anzeige.code || "anzeige"}_${breiteMm}x${hoeheMm}mm.pdf`,
    hinweis: `${breiteMm}×${hoeheMm} mm, Motiv eingepasst, ca. ${dpi} dpi${dpi < 200 ? " (niedrig – Motiv größer erzeugen)" : ""}`,
    dpi,
  };
}
