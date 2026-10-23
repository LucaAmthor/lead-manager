// Reine Regeln des Buchungs-Agenten (ohne Datenbank/Netz) – einzeln testbar.

export const FORMATE = {
  "1x60": { label: "1 Sp. × 60 mm", w: 45, h: 60 },
  "2x95": { label: "2 Sp. × 95 mm", w: 93, h: 95 },
  "3x140": { label: "3 Sp. × 140 mm", w: 141, h: 140 },
  "q-hoch": { label: "1/4 Seite hoch", w: 141, h: 200 },
  "h-quer": { label: "1/2 Seite quer", w: 282, h: 200 },
  ganz: { label: "1/1 Seite", w: 282, h: 400 },
};
export const formatVon = (a) => FORMATE[a?.format] || { label: a?.format || "nach Absprache", w: null, h: null };

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
 *  - geplante Kosten der Anzeigen + Toleranz
 *  - ohne geplante Kosten: was vom Kampagnen-Limit noch frei ist
 *  - gedeckelt durch das Monatslimit (bereits gebuchte Anzeigen im Monat abgezogen)
 */
export function hoechstpreis({ anzeigen, alleAnzeigen, cfg, monat = heuteISO().slice(0, 7) }) {
  const geplant = anzeigen.reduce((s, a) => s + num(a.kosten), 0);
  const unbekannt = anzeigen.some((a) => !num(a.kosten));
  let max = geplant * (1 + num(cfg.preisToleranzProzent) / 100);
  const gebucht = (a) => ["gebucht", "erschienen", "beendet"].includes(a.status);
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
  return { max: runden(Math.max(0, max)), geplant: runden(geplant), grund };
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
