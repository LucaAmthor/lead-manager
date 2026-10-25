import { adminDb, holen, anlegen, aendern, num } from "@/lib/buchung/db";

// Web-Tracking: Kurz-Links je Anzeige (z. B. go.modernisieren24.de/sz-wp-001), QR-Codes (…?q=1), Social-Links (…?s=1),
// Besuche je Anzeige und Tag (Sammlung „besuche“), Leads von der Website (/api/lead).
// Ziel-Seiten je Kategorie: einstellungen/tracking.ziele = { "Wärmepumpe": "https://modernisieren24.de/waermepumpe", … }
export const STANDARD_ZIELE = {
  _standard: "https://modernisieren24.de/",
  "Wärmepumpe": "https://modernisieren24.de/waermepumpe",
  PV: "https://modernisieren24.de/",
};

export async function anzeigeZuCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(c)) return null;
  const { data } = await adminDb().from("lp_docs").select("id, data").eq("collection", "anzeigen").eq("data->>code", c).limit(1);
  return data?.[0] ? { id: data[0].id, ...data[0].data } : null;
}

export async function trackingCfg() {
  const t = (await holen("einstellungen", "tracking")) || {};
  return { ...t, ziele: { ...STANDARD_ZIELE, ...(t.ziele || {}) } };
}

export function zielUrl(cfg, anzeige, { medium, quelle }) {
  const basis = cfg.ziele[anzeige?.kategorie] || cfg.ziele._standard;
  const u = new URL(basis);
  if (anzeige?.code) u.searchParams.set("lp", anzeige.code);
  u.searchParams.set("utm_source", quelle === "social" ? "social" : "print");
  u.searchParams.set("utm_medium", medium);
  if (anzeige?.kampagneId) u.searchParams.set("utm_campaign", anzeige.kampagneId);
  if (anzeige?.code) u.searchParams.set("utm_content", anzeige.code);
  return u.toString();
}

// Zähler je Anzeige und Tag (lesen, erhöhen, schreiben – reicht für unsere Last)
export async function besuchZaehlen(anzeige, art) {
  const datum = new Date().toISOString().slice(0, 10);
  const id = `${anzeige?.id || "ohne"}_${datum}`;
  const alt = await holen("besuche", id);
  const feld = { qr: "qr", social: "social", link: "link" }[art] || "link";
  if (alt) return aendern("besuche", id, { aufrufe: num(alt.aufrufe) + 1, [feld]: num(alt[feld]) + 1, zuletzt: Date.now() });
  return anlegen("besuche", { anzeigeId: anzeige?.id || "", code: anzeige?.code || "", kategorie: anzeige?.kategorie || "", datum, aufrufe: 1, [feld]: 1, zuletzt: Date.now() }, id);
}

// Kurz-Link einer Anzeige aus der Basis-URL in den Einstellungen (einstellungen/allgemein.basisUrl)
export function kurzUrl(basis, code, art = "") {
  const b = String(basis || "").replace(/\/+$/, "");
  if (!b || !code) return "";
  const mitProto = /^https?:\/\//.test(b) ? b : `https://${b}`;
  return `${mitProto}/${String(code).toLowerCase()}${art === "qr" ? "?q=1" : art === "social" ? "?s=1" : ""}`;
}
