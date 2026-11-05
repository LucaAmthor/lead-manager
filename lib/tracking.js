import { adminDb, holen, anlegen, aendern, num } from "@/lib/buchung/db";

// Web-Tracking: Kurz-Links je Anzeige (z. B. go.modernisieren24.de/sz-wp-001), QR-Codes (…?q=1), Social-Links (…?s=1),
// Besuche je Anzeige und Tag (Sammlung „besuche“), Leads von der Website (/api/lead).
// Ziel-Seiten je Kategorie: einstellungen/tracking.ziele = { "Wärmepumpe": "https://modernisieren24.de/waermepumpe", … }
export const STANDARD_ZIELE = {
  _standard: "https://modernisieren24.de/",
  // Wärmepumpen-Anzeigen werben mit dem Oberbegriff „Heizung“ → Themenseite /heizung (Gas, Öl, Pellets, Wärmepumpe)
  "Wärmepumpe": "https://modernisieren24.de/heizung",
  Heizung: "https://modernisieren24.de/heizung",
  PV: "https://modernisieren24.de/solar",
};

// Ziel für einzelne Anzeigen, unabhängig von der Kategorie (gilt auch für schon gedruckte QR-Codes, Ziel wird beim Scan bestimmt).
// ROS-WP-001: Anzeige wirbt mit dem Förder-Bonus, den es nur für Wärmepumpen/erneuerbare Heizungen gibt → direkt zum Förder-Rechner.
export const ANZEIGEN_ZIELE = {
  "ROS-WP-001": "https://modernisieren24.de/waermepumpe",
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
  // Eigenes Ziel je Anzeige (Feld „zielUrl“, z. B. ROS-WP-001 → /waermepumpe wegen Förder-Bonus) vor dem Ziel der Kategorie
  const eigenes = /^https:\/\/[^\s]+$/.test(String(anzeige?.zielUrl || "")) ? anzeige.zielUrl : ANZEIGEN_ZIELE[String(anzeige?.code || "").toUpperCase()] || "";
  const basis = eigenes || cfg.ziele[anzeige?.kategorie] || cfg.ziele._standard;
  const u = new URL(basis);
  if (anzeige?.code) u.searchParams.set("lp", anzeige.code);
  u.searchParams.set("utm_source", quelle === "social" ? "social" : "print");
  u.searchParams.set("utm_medium", medium);
  if (anzeige?.kampagneId) u.searchParams.set("utm_campaign", anzeige.kampagneId);
  if (anzeige?.code) u.searchParams.set("utm_content", anzeige.code);
  return u.toString();
}

// Zähler je Anzeige und Tag (lesen, erhöhen, schreiben – reicht für unsere Last).
// Zusätzlich jeder Aufruf einzeln mit Uhrzeit (Feld „ereignisse“, höchstens MAX_EREIGNISSE je Tag), keine IP, nur grobe Geräteart.
// Test-Aufrufe (eigene Geräte, angemeldete Lokalpilot-Nutzer) zählen nicht in aufrufe/qr/link/social, sondern in „tests“.
const MAX_EREIGNISSE = 300;
export const TEST_COOKIE = "lp_testgeraet";

export async function besuchZaehlen(anzeige, art, { test = false, geraet = "" } = {}) {
  const jetzt = Date.now();
  const datum = new Date(jetzt).toISOString().slice(0, 10);
  const id = `${anzeige?.id || "ohne"}_${datum}`;
  const alt = await holen("besuche", id);
  const feld = { qr: "qr", social: "social", link: "link" }[art] || "link";
  const ereignis = { t: jetzt, art: feld, ...(test ? { test: true } : {}), ...(geraet ? { geraet } : {}) };
  if (alt) {
    const ereignisse = [...(Array.isArray(alt.ereignisse) ? alt.ereignisse : []), ereignis].slice(-MAX_EREIGNISSE);
    if (test) return aendern("besuche", id, { tests: num(alt.tests) + 1, ereignisse, zuletzt: jetzt });
    return aendern("besuche", id, { aufrufe: num(alt.aufrufe) + 1, [feld]: num(alt[feld]) + 1, ereignisse, zuletzt: jetzt });
  }
  const zaehler = test ? { aufrufe: 0, tests: 1 } : { aufrufe: 1, [feld]: 1 };
  return anlegen("besuche", { anzeigeId: anzeige?.id || "", code: anzeige?.code || "", kategorie: anzeige?.kategorie || "", datum, ...zaehler, ereignisse: [ereignis], zuletzt: jetzt }, id);
}

// Eigener Aufruf? Gerät als Testgerät markiert (…/testgeraet) oder in Lokalpilot angemeldet (Supabase-Sitzungs-Cookie, nur auf lokalpilot.vercel.app sichtbar)
export function istTestBesuch(request) {
  const namen = request.cookies.getAll().map((c) => c.name);
  return request.cookies.get(TEST_COOKIE)?.value === "1" || namen.some((n) => /^sb-.+-auth-token/.test(n));
}

export function geraetArt(ua = "") {
  if (/ipad|tablet/i.test(ua)) return "Tablet";
  if (/mobi|iphone|android/i.test(ua)) return "Handy";
  return ua ? "PC" : "";
}

// Kurz-Link einer Anzeige aus der Basis-URL in den Einstellungen (einstellungen/allgemein.basisUrl)
export function kurzUrl(basis, code, art = "") {
  const b = String(basis || "").replace(/\/+$/, "");
  if (!b || !code) return "";
  const mitProto = /^https?:\/\//.test(b) ? b : `https://${b}`;
  return `${mitProto}/${String(code).toLowerCase()}${art === "qr" ? "?q=1" : art === "social" ? "?s=1" : ""}`;
}
