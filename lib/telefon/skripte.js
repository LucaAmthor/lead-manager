// Gesprächsleitfäden je Kategorie (in Lokalpilot unter /telefon änderbar). Ohne Server-Abhängigkeiten, damit auch das
// Browser-Telefon sie nutzen kann. {marke} und {anbieter} werden ersetzt.
export const STANDARD_SKRIPT = {
  intro: "„{marke}, guten Tag, mein Name ist … Schön, dass Sie anrufen! Worum geht es bei Ihnen?“",
  fragen: ["Name", "Postleitzahl und Ort", "Sind Sie Eigentümer der Immobilie?", "Worum geht es genau?", "Ab wann soll es losgehen?", "Beste Zeit für Rückrufe der Anbieter"],
  abschluss: "„Vielen Dank! Bis zu drei geprüfte {anbieter} aus Ihrer Region melden sich in den nächsten 48 Stunden mit einem Angebot. Das ist für Sie kostenlos und unverbindlich.“",
};
export const STANDARD_SKRIPTE = {
  "Wärmepumpe": {
    fragen: ["Name", "Postleitzahl und Ort", "Eigentümer? (ja/nein)", "Haustyp und Baujahr (z. B. EFH 1985)", "Wohnfläche ca. m²", "Heizung heute (Gas, Öl, Strom …) und Alter", "Fußbodenheizung oder Heizkörper?", "Wann soll die neue Heizung kommen?", "Förderung gleich mitprüfen? (ja/nein)"],
  },
  "PV": {
    fragen: ["Name", "Postleitzahl und Ort", "Eigentümer? (ja/nein)", "Dachform und Ausrichtung (z. B. Satteldach, Süd)", "Dachfläche grob / Alter des Dachs", "Stromverbrauch pro Jahr (kWh) oder Abschlag", "Speicher gewünscht? Wallbox?", "Wann soll die Anlage kommen?"],
  },
  "Altenpflege": {
    intro: "„{marke}, guten Tag, mein Name ist … Sie rufen wegen Unterstützung im Alltag an – ich nehme mir gern Zeit. Für wen suchen Sie Hilfe?“",
    fragen: ["Name des Anrufers", "Für wen? (Mutter, Vater, selbst …)", "Postleitzahl und Ort der zu betreuenden Person", "Pflegegrad vorhanden? Welcher?", "Welche Hilfe? (Haushalt, Grundpflege, 24-Stunden, Tagespflege …)", "Ab wann wird Hilfe gebraucht?", "Wie dringend? (sofort / in den nächsten Wochen)"],
    abschluss: "„Danke, dass Sie mir das erzählt haben. Bis zu drei Pflegedienste aus Ihrer Nähe melden sich zeitnah bei Ihnen. Das ist kostenlos und unverbindlich – Sie entscheiden in Ruhe.“",
  },
};


export const EINWILLIGUNG_STANDARD =
  "Damit Sie bis zu drei Angebote bekommen, geben wir Ihre Angaben an bis zu drei passende Anbieter aus Ihrer Region weiter. Diese dürfen Sie dazu anrufen oder Ihnen schreiben. Sind Sie damit einverstanden?";

const ANBIETER = { "Wärmepumpe": "Fachbetriebe für Wärmepumpen", PV: "Solar-Fachbetriebe", Altenpflege: "Pflegedienste", Heizung: "Heizungsbauer", Badsanierung: "Badsanierer", Treppenlift: "Treppenlift-Anbieter", "Küche": "Küchenstudios", "Fenster & Türen": "Fenster- und Türenbauer", "Dach & Dämmung": "Dachdecker und Dämmprofis", "Immobilie verkaufen": "Immobilienmakler" };

/** Leitfaden für eine Kategorie: eigene Fassung aus den Einstellungen, sonst Standard je Kategorie, sonst allgemein. */
export function skriptFuer(kategorie, eigene = {}, marke = "Modernisieren24") {
  const s = { ...STANDARD_SKRIPT, ...(STANDARD_SKRIPTE[kategorie] || {}), ...(eigene?.[kategorie] || {}) };
  const werte = { marke, anbieter: ANBIETER[kategorie] || "Fachbetriebe" };
  const f = (t) => String(t || "").replace(/\{(\w+)\}/g, (_, k) => werte[k] ?? "");
  return { intro: f(s.intro), fragen: (s.fragen || []).map(f).filter(Boolean), abschluss: f(s.abschluss) };
}
