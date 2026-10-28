// Conversion der Telefon-Anrufe: wie viele Anrufe werden zu einem Lead mit Einwilligung, und wo brechen Anrufer ab.
// Ohne Server-Abhängigkeiten – nutzt die Seite /telefon und die Wochen-Auswertung.
export const ABBRUCH = {
  keiner: "vollständig", begruessung: "Begrüßung", fragen_vorhaben: "Fragen zum Vorhaben", postleitzahl: "Postleitzahl", name: "Name",
  telefonnummer: "Telefonnummer", einwilligung_nein: "Einwilligung: Nein", einwilligung_unklar: "Einwilligung unklar", aufgelegt: "aufgelegt",
  widerruf: "Widerruf", mensch_gewuenscht: "wollte Menschen", falsches_thema: "falsches Thema",
};
const ziffern = (x) => { const d = String(x || "").replace(/\D/g, "").replace(/^0049|^49/, "0"); return d ? d.replace(/^(?!0)/, "0") : ""; };

/** Eigene Nummern (Handy-Ziele, Testnummern) – deren Anrufe sind Tests und zählen nicht. */
export function testNummern(cfg = {}) {
  return new Set([...(cfg.ziele || []).map((z) => z.nummer), ...(cfg.testnummern || [])].map(ziffern).filter(Boolean));
}

export function kennzahlen({ anrufe = [], kontakte = new Map(), von = 0, bis = Date.now(), cfg = {} }) {
  const test = testNummern(cfg);
  const liste = anrufe.filter((a) => a.richtung !== "aus" && a.start >= von && a.start < bis && !test.has(ziffern(a.von)));
  const k = (a) => (kontakte.get ? kontakte.get(a.kontaktId) : kontakte[a.kontaktId]);
  const istLead = (a) => { const x = k(a); return !!(x && x.einwilligung && !x.widerrufen); };
  const assistent = liste.filter((a) => a.assistent);
  const mensch = liste.filter((a) => a.angenommen && !a.assistent);
  const abbruch = {};
  for (const a of assistent) { const s = a.assistent.abbruch || "unbekannt"; abbruch[s] = (abbruch[s] || 0) + 1; }
  const kriterien = {};
  for (const a of assistent) for (const [id, r] of Object.entries(a.assistent.kriterien || {})) {
    kriterien[id] ||= { ok: 0, n: 0 };
    if (r === "success" || r === "failure") { kriterien[id].n++; if (r === "success") kriterien[id].ok++; }
  }
  const sek = assistent.map((a) => a.assistent.sek || a.gespraechSek || 0).filter(Boolean);
  const leads = liste.filter(istLead).length;
  return {
    anrufe: liste.length,
    leads,
    quote: liste.length ? leads / liste.length : null,
    assistent: { anrufe: assistent.length, leads: assistent.filter(istLead).length, dauer: sek.length ? sek.reduce((p, q) => p + q, 0) / sek.length : 0 },
    mensch: { anrufe: mensch.length, leads: mensch.filter(istLead).length },
    verpasst: liste.filter((a) => ["verpasst", "mailbox"].includes(a.status)).length,
    abbruch,
    kriterien,
    zoegern: assistent.map((a) => a.assistent.zoegern).filter(Boolean),
    ids: liste.map((a) => a.id),
  };
}
