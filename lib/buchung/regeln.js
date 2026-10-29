// Reine Regeln des Buchungs-Agenten (ohne Datenbank/Netz) – einzeln testbar.

export const FORMATE = {
  "1x60": { label: "1 Sp. × 60 mm", w: 45, h: 60 },
  "2x95": { label: "2 Sp. × 95 mm", w: 93, h: 95 },
  "3x140": { label: "3 Sp. × 140 mm", w: 141, h: 140 },
  achtel: { label: "1/8 Seite (3 Sp. × 100 mm)", w: 141, h: 100 },
  "q-hoch": { label: "1/4 Seite hoch", w: 141, h: 200 },
  "h-quer": { label: "1/2 Seite quer", w: 282, h: 200 },
  ganz: { label: "1/1 Seite", w: 282, h: 400 },
};
export const formatVon = (a) => FORMATE[a?.format] || { label: a?.format || "nach Absprache", w: null, h: null };
// Echtes Druckmaß einer Anzeige im Blatt: 1/4 Seite = hinterlegtes Druckmaß des Blatts, 1/8 Seite = dessen Breite (3 Sp.) × 100 mm,
// sonst unser Standardmaß. null, wenn nichts bekannt.
export function druckmass(a, blatt) {
  const mm = blatt?.buchung?.formatMm;
  const fid = a?.format || "q-hoch";
  if (fid === "q-hoch" && num(mm?.b) > 0 && num(mm?.h) > 0) return { b: num(mm.b), h: num(mm.h), blatt: true };
  if (fid === "achtel" && num(mm?.b) > 0) return { b: num(mm.b), h: 100, blatt: true };
  const f = formatVon(a);
  return f.w && f.h ? { b: f.w, h: f.h, blatt: false } : null;
}

// Spalten × Höhe der Spaltenformate – für die Rechnung über den mm-Preis der Preisliste.
const SPALTEN_MM = { "1x60": { sp: 1, h: 60 }, "2x95": { sp: 2, h: 95 }, "3x140": { sp: 3, h: 140 }, achtel: { sp: 3, h: 100 } };

/**
 * Standardpreis (netto) eines Formats in einem Blatt – aus blatt.buchung.preise[format],
 * sonst über den mm-Preis (Spalten × Höhe). quelle: "Preisliste" | "mm-Preis" | null.
 */
export function standardpreis(blatt, formatId) {
  const p = blatt?.buchung || {};
  const fest = num(p.preise?.[formatId]);
  if (fest > 0) return { preis: runden(fest), quelle: "Preisliste" };
  const mm = num(p.mmPreis);
  const s = SPALTEN_MM[formatId];
  if (mm > 0 && s) return { preis: runden(mm * s.sp * s.h), quelle: "mm-Preis" };
  // 1/8 Seite ohne mm-Preis: halbe 1/4 Seite der Preisliste
  const viertel = num(p.preise?.["q-hoch"]);
  if (formatId === "achtel" && viertel > 0) return { preis: runden(viertel / 2), quelle: "Preisliste (1/4 ÷ 2)" };
  return { preis: 0, quelle: null };
}

/**
 * Zielpreis fürs Nachverhandeln (netto): Ziel-Rabatt auf den kleineren Wert aus Listen-/Planpreis und Angebot,
 * auf 10 € abgerundet. null, wenn nicht nachverhandelt werden soll.
 */
export function zielpreis({ angebot, anzeigen, blatt, cfg }) {
  const r = num(cfg?.zielRabattProzent);
  if (!(r > 0) || !(num(angebot) > 0)) return null;
  const plan = anzeigen.reduce((s, a) => s + kostenPlan(a, blatt), 0);
  if (plan > 0 && num(angebot) <= plan * (1 - r / 100)) return null; // Ziel-Rabatt schon erreicht: direkt zusagen
  const basis = plan > 0 ? Math.min(plan, num(angebot)) : num(angebot);
  const ziel = Math.floor((basis * (1 - r / 100)) / 10) * 10;
  return ziel > 0 && ziel < num(angebot) ? ziel : null;
}

/** Geplante Kosten einer Anzeige: eingetragene Kosten, sonst Standardpreis des Blatts. */
export const kostenPlan = (a, blatt) => num(a?.kosten) || standardpreis(blatt, a?.format).preis;

/**
 * Kennzahlen einer Buchung: TKP (Preis je 1.000 Auflage), Listenpreis, Rabatt, Abweichung vom Plan, Preis je Spalten-mm.
 * Alles netto. Werte, die sich nicht berechnen lassen, sind null.
 */
export function kennzahlen({ preis, blatt, anzeigen }) {
  const p = num(preis);
  const n = anzeigen.length || 1;
  const auflage = num(blatt?.auflage) || null;
  const liste = anzeigen.reduce((s, a) => s + standardpreis(blatt, a.format).preis, 0);
  const plan = anzeigen.reduce((s, a) => s + num(a.kosten), 0);
  const spMm = anzeigen.reduce((s, a) => s + (SPALTEN_MM[a.format] ? SPALTEN_MM[a.format].sp * SPALTEN_MM[a.format].h : 0), 0);
  const alleMitMm = anzeigen.every((a) => SPALTEN_MM[a.format]);
  return {
    vergleichspreis: vergleichspreis(p, anzeigen.map((a) => a.format), blatt),
    auflage,
    tkp: auflage && p ? runden(p / n / (auflage / 1000)) : null,
    listenpreis: liste ? runden(liste) : null,
    rabattProzent: liste && p ? runden((1 - p / liste) * 100) : null,
    planAbweichungProzent: plan && p ? runden((p / plan - 1) * 100) : null,
    preisJeMm: alleMitMm && spMm && p ? runden(p / spMm) : null,
  };
}

export const OFFEN = ["neu", "shop_laeuft", "anfrage_gesendet", "zusage_gesendet", "wartet_freigabe", "wartet_verifizierung", "braucht_hilfe", "gebucht"];
export const ENDE = ["abgeschlossen", "test_fertig", "abgelehnt", "abgebrochen"];

export const STATUS_TEXT = {
  neu: "Startet gleich",
  shop_laeuft: "Bucht gerade im Shop",
  anfrage_gesendet: "Anfrage verschickt",
  zusage_gesendet: "Zusage verschickt",
  wartet_freigabe: "Wartet auf eure Freigabe",
  wartet_verifizierung: "Wartet auf Bestätigungs-Mail",
  braucht_hilfe: "Braucht Hilfe",
  gebucht: "Gebucht (Druckdaten offen)",
  abgeschlossen: "Gebucht",
  test_fertig: "Test fertig",
  abgelehnt: "Abgelehnt",
  abgebrochen: "Abgebrochen",
};

const runden = (x) => Math.round(x * 100) / 100;
const num = (x) => {
  const n = typeof x === "number" ? x : parseFloat(String(x ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

// Heutiges Datum in Deutschland als YYYY-MM-DD
export function heuteISO(jetzt = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(jetzt);
}
export function tageBis(datumISO, heute = heuteISO()) {
  return Math.round((Date.parse(datumISO + "T12:00:00Z") - Date.parse(heute + "T12:00:00Z")) / 86400000);
}
export function datumLang(iso) {
  if (!iso) return "Termin offen";
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}
export const eur = (x) => (x == null ? "–" : num(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");

// Wie wird dieses Blatt gebucht? Direkt im Online-Shop (Verlag oder Marktplatz) oder per Anfrage an die Anzeigenabteilung.
export function buchungsweg(blatt) {
  const b = blatt?.buchung || {};
  const kontakt = String(blatt?.kontakt || "");
  const shopUrl = b.shopUrl || (/^https?:\/\//.test(kontakt) ? kontakt : "");
  const email = b.email || (kontakt.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || "";
  let weg = b.weg && b.weg !== "auto" ? b.weg : shopUrl ? "shop" : email ? "anfrage" : null;
  if (weg === "shop" && !shopUrl) weg = email ? "anfrage" : null;
  if (weg === "anfrage" && !email) weg = shopUrl ? "shop" : null;
  return { weg, shopUrl, email, ersatz: weg === "shop" && email ? "anfrage" : null };
}

// Welche Anzeigen sind jetzt zu buchen? Freigegeben, Termin im Vorlauf-Fenster, noch in keiner offenen Buchung.
export function faellige({ anzeigen, buchungen, cfg, heute = heuteISO(), nurIds = null }) {
  const belegt = new Set(buchungen.filter((b) => !["abgebrochen", "abgelehnt"].includes(b.status)).flatMap((b) => b.anzeigeIds || []));
  return anzeigen.filter((a) => {
    if (a.demo || belegt.has(a.id)) return false;
    if (nurIds) return nurIds.includes(a.id) && ["freigegeben", "geplant"].includes(a.status) && a.datum;
    if (a.status !== "freigegeben" || !a.datum) return false;
    const t = tageBis(a.datum, heute);
    return t >= cfg.mindestVorlaufTage && t <= cfg.vorlaufTage;
  });
}

export function nachBlatt(anzeigen) {
  const m = new Map();
  for (const a of anzeigen) m.set(a.blattId, [...(m.get(a.blattId) || []), a]);
  return m;
}

/**
 * Höchstpreis (netto), den der Agent ohne Rückfrage zusagen darf:
 *  - geplante Kosten der Anzeigen (ohne eingetragene Kosten: Standardpreis des Blatts) + Toleranz
 *  - ohne geplante Kosten: was vom Kampagnen-Limit noch frei ist
 *  - gedeckelt durch das Monatslimit (bereits gebuchte Anzeigen im Monat abgezogen)
 */
// ---------------------------------------------------------------- Vergleichspreis
// EIN Wert für alle Blätter und Formate: Was kostet es, 1.000 Exemplare mit einer 1/8 Seite (141 × 100 mm) zu erreichen?
// Vergleichspreis = Preis ÷ (Auflage/1.000 × Fläche/Fläche einer 1/8 Seite). Kleiner = günstiger.
// (Bis 29.10.2026 war die Bezugsgröße die 1/4 Seite – alte Werte sind doppelt so hoch.)
const BEZUG = 141 * 100;
export function flaecheMm2(formatId, blatt) {
  const mm = blatt?.buchung?.formatMm;
  if (formatId === "q-hoch" && num(mm?.b) > 0 && num(mm?.h) > 0) return num(mm.b) * num(mm.h); // echtes Druckmaß des Blatts
  if (formatId === "achtel" && num(mm?.b) > 0) return num(mm.b) * 100; // 3 Spalten des Blatts × 100 mm
  const f = FORMATE[formatId];
  return f?.w && f?.h ? f.w * f.h : BEZUG;
}
// Reichweite in „1.000 Achtelseiten“ – null, wenn die Auflage fehlt
export function reichweite(formatIds, blatt) {
  const auflage = num(blatt?.auflage);
  if (!(auflage > 0) || !formatIds.length) return null;
  return formatIds.reduce((s, fid) => s + (auflage / 1000) * (flaecheMm2(fid, blatt) / BEZUG), 0);
}
export function vergleichspreis(preis, formatIds, blatt) {
  const r = reichweite(formatIds, blatt);
  return r && num(preis) > 0 ? runden(num(preis) / r) : null;
}

/** Allgemeiner Höchstpreis: höchstens cfg.maxTkpViertelseite (= höchster Vergleichspreis) für alle Blätter und Formate. */
export function tkpGrenze(anzeigen, blatt, cfg) {
  const t = num(cfg?.maxTkpViertelseite);
  const r = reichweite(anzeigen.map((a) => a.format), blatt);
  return t > 0 && r ? runden(t * r) : null;
}

export function hoechstpreis({ anzeigen, alleAnzeigen, cfg, blatt = null, monat = heuteISO().slice(0, 7) }) {
  const geplant = anzeigen.reduce((s, a) => s + kostenPlan(a, blatt), 0);
  const gebucht = (a) => ["gebucht", "erschienen", "beendet"].includes(a.status);
  // Allgemeine Grenze (höchster Vergleichspreis) gilt IMMER als Deckel – auch wenn an der Anzeige feste Kosten stehen.
  // Feste Kosten + Toleranz können die Grenze nur unterschreiten, nie überschreiten. Mehr nur per Freigabe von Hand.
  const explizit = anzeigen.length && anzeigen.every((a) => num(a.kosten) > 0);
  const grenze = tkpGrenze(anzeigen, blatt, cfg);
  const unbekannt = grenze == null && anzeigen.some((a) => !kostenPlan(a, blatt));
  const planMax = geplant * (1 + num(cfg.preisToleranzProzent) / 100);
  let max = grenze == null ? planMax : explizit ? Math.min(planMax, grenze) : grenze;
  if (unbekannt) {
    if (cfg.limit == null) return { max: unbekannt && !geplant ? 0 : runden(max), geplant, grund: "Kosten fehlen und kein Kampagnen-Limit gesetzt" };
    const kampagnen = [...new Set(anzeigen.map((a) => a.kampagneId))];
    const schon = alleAnzeigen.filter((a) => kampagnen.includes(a.kampagneId) && gebucht(a)).reduce((s, a) => s + num(a.kosten), 0);
    max = Math.max(max, cfg.limit - schon);
  }
  let grund = null;
  if (cfg.monatsLimit != null) {
    const imMonat = alleAnzeigen.filter((a) => gebucht(a) && String(a.datum || "").slice(0, 7) === monat).reduce((s, a) => s + num(a.kosten), 0);
    const frei = cfg.monatsLimit - imMonat;
    if (frei < max) {
      max = frei;
      grund = "Monatslimit";
    }
  }
  return { max: runden(Math.max(0, max)), geplant: runden(geplant), grund: grund || (grenze != null ? "TKP-Grenze" : null), tkpGrenze: grenze };
}

export function preisErlaubt(preisNetto, max) {
  const p = num(preisNetto);
  if (!p) return { ok: false, grund: "Preis unbekannt" };
  if (p <= max + 0.005) return { ok: true };
  return { ok: false, grund: `${eur(p)} liegt über dem freigegebenen Höchstpreis ${eur(max)}` };
}

// Preis auf die Anzeigen verteilen (anteilig nach geplanten Kosten, sonst gleichmäßig)
export function preisVerteilen(anzeigen, gesamt) {
  const summe = anzeigen.reduce((s, a) => s + num(a.kosten), 0);
  let rest = runden(num(gesamt));
  return anzeigen.map((a, i) => {
    const anteil = i === anzeigen.length - 1 ? rest : runden(summe ? (num(gesamt) * num(a.kosten)) / summe : num(gesamt) / anzeigen.length);
    rest = runden(rest - anteil);
    return { id: a.id, kosten: anteil };
  });
}

export function werktageSeit(ts, jetzt = Date.now()) {
  let n = 0;
  for (let t = ts + 86400000; t <= jetzt; t += 86400000) {
    const tag = new Date(t).getUTCDay();
    if (tag !== 0 && tag !== 6) n++;
  }
  return n;
}
