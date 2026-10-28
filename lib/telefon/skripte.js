// Gesprächsleitfäden je Kategorie (in Lokalpilot unter /telefon änderbar). Ohne Server-Abhängigkeiten, damit auch das
// Browser-Telefon sie nutzen kann. {marke} und {anbieter} werden ersetzt.
export const STANDARD_SKRIPT = {
  intro: "„{marke}, guten Tag, mein Name ist … Schön, dass Sie anrufen! Worum geht es bei Ihnen?“",
  fragen: ["Name", "Postleitzahl und Ort", "Sind Sie Eigentümer der Immobilie?", "Worum geht es genau?", "Ab wann soll es losgehen?", "Beste Zeit für Rückrufe der Anbieter"],
  abschluss: "„Vielen Dank! Ein Partner aus unserem Netzwerk meldet sich in den nächsten Tagen bei Ihnen, damit Sie bis zu drei Angebote bekommen. Das ist für Sie kostenlos und unverbindlich.“",
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
    abschluss: "„Danke, dass Sie mir das erzählt haben. Ein Partner aus unserem Netzwerk meldet sich zeitnah bei Ihnen, damit Sie passende Angebote bekommen. Das ist kostenlos und unverbindlich – Sie entscheiden in Ruhe.“",
  },
};


// Was die Mailbox je Kategorie abfragt ({abfrage} in der Mailbox-Ansage). Kurz halten: wenige Angaben, die einen Lead qualifizieren.
export const MAILBOX_STANDARD = "Ihren Namen, Ihre Telefonnummer und kurz, worum es geht.";
export const MAILBOX_ABFRAGE = {
  "Wärmepumpe": "Ihren Namen, Ihre Telefonnummer und Ihre Postleitzahl. Und sagen Sie uns gern, ob Sie Eigentümer sind und womit Sie heute heizen.",
  PV: "Ihren Namen, Ihre Telefonnummer und Ihre Postleitzahl. Und sagen Sie uns gern, ob Sie Eigentümer sind und welche Dachform Ihr Haus hat.",
  Altenpflege: "Ihren Namen und Ihre Telefonnummer, für wen Sie Unterstützung suchen und in welchem Ort.",
  Heizung: "Ihren Namen, Ihre Telefonnummer und Ihre Postleitzahl. Und sagen Sie uns gern, ob Sie Eigentümer sind und wie alt Ihre Heizung ist.",
  Badsanierung: "Ihren Namen, Ihre Telefonnummer und Ihre Postleitzahl. Und sagen Sie uns gern, ob Sie Eigentümer sind und ob das ganze Bad erneuert werden soll.",
  Treppenlift: "Ihren Namen, Ihre Telefonnummer und Ihre Postleitzahl, für wen der Lift ist und ob die Treppe gerade oder kurvig ist.",
  "Küche": "Ihren Namen, Ihre Telefonnummer und Ihre Postleitzahl und ungefähr, wann die neue Küche kommen soll.",
  "Fenster & Türen": "Ihren Namen, Ihre Telefonnummer und Ihre Postleitzahl. Und sagen Sie uns gern, ob Sie Eigentümer sind und wie viele Fenster oder Türen es ungefähr sind.",
  "Dach & Dämmung": "Ihren Namen, Ihre Telefonnummer und Ihre Postleitzahl. Und sagen Sie uns gern, ob Sie Eigentümer sind und ob es um das Dach oder die Dämmung geht.",
  "Immobilie verkaufen": "Ihren Namen, Ihre Telefonnummer und den Ort der Immobilie und ob es ein Haus oder eine Wohnung ist.",
};
export const mailboxAbfrage = (kategorie, eigene = {}) => String(eigene?.[kategorie]?.mailbox || MAILBOX_ABFRAGE[kategorie] || MAILBOX_STANDARD);

// Einwilligung zur Weitergabe. Bewusst allgemein (mehrere Abnehmer, die noch nicht feststehen), aber mit Art der Empfänger,
// Kontaktwegen und Widerruf. {anbieter} wird je Kategorie ersetzt. In Lokalpilot unter /telefon → Einstellungen änderbar.
export const EINWILLIGUNG_STANDARD =
  "Damit Sie Angebote bekommen, geben wir Ihren Namen, Ihre Telefonnummer, Ihre Postleitzahl und Ihre Angaben zum Vorhaben an Partner aus unserem Netzwerk weiter: an {anbieter} oder an Vermittlungsdienste, die Ihnen solche Betriebe vermitteln. Diese Partner dürfen Sie dazu anrufen und Ihnen per E-Mail schreiben. Sie können das jederzeit widerrufen: einfach wieder bei uns anrufen oder eine E-Mail an info@modernisieren24.de. Sind Sie damit einverstanden?";

// Wird in jeder Mailbox-Ansage vor dem Signalton gesagt (Informationspflicht, weil die Nachricht aufgezeichnet wird).
export const DATENSCHUTZ_HINWEIS_STANDARD = "Ihre Nachricht wird aufgezeichnet, damit wir Sie zurückrufen können. Informationen zum Datenschutz finden Sie auf modernisieren24 Punkt de.";

const ANBIETER = { "Wärmepumpe": "Fachbetriebe für Wärmepumpen", PV: "Solar-Fachbetriebe", Altenpflege: "Pflegedienste", Heizung: "Heizungsbauer", Badsanierung: "Badsanierer", Treppenlift: "Treppenlift-Anbieter", "Küche": "Küchenstudios", "Fenster & Türen": "Fenster- und Türenbauer", "Dach & Dämmung": "Dachdecker und Dämmprofis", "Immobilie verkaufen": "Immobilienmakler" };

/** Leitfaden für eine Kategorie: eigene Fassung aus den Einstellungen, sonst Standard je Kategorie, sonst allgemein. */
/** Einwilligungstext für eine Kategorie: eigene Fassung aus den Telefon-Einstellungen, sonst Standard. */
export function einwilligungFuer(kategorie, eigene = "") {
  const anbieter = ANBIETER[kategorie] || "Fachbetriebe";
  return String(eigene || EINWILLIGUNG_STANDARD).replace(/\{anbieter\}/g, anbieter);
}

export function skriptFuer(kategorie, eigene = {}, marke = "Modernisieren24") {
  const s = { ...STANDARD_SKRIPT, ...(STANDARD_SKRIPTE[kategorie] || {}), ...(eigene?.[kategorie] || {}) };
  const werte = { marke, anbieter: ANBIETER[kategorie] || "Fachbetriebe" };
  const f = (t) => String(t || "").replace(/\{(\w+)\}/g, (_, k) => werte[k] ?? "");
  return { intro: f(s.intro), fragen: (s.fragen || []).map(f).filter(Boolean), abschluss: f(s.abschluss) };
}

export const anbieterFuer = (kategorie) => ANBIETER[kategorie] || "Fachbetriebe";

// Wie das Thema im Satz klingt („Schön, dass Sie wegen … anrufen“)
const THEMA = { "Wärmepumpe": "einer Wärmepumpe", PV: "einer Solaranlage", Altenpflege: "Unterstützung im Alltag oder in der Pflege", Heizung: "einer neuen Heizung", Badsanierung: "einer Badsanierung", Treppenlift: "eines Treppenlifts", "Küche": "einer neuen Küche", "Fenster & Türen": "neuer Fenster oder Türen", "Dach & Dämmung": "Dach oder Dämmung", "Immobilie verkaufen": "des Verkaufs Ihrer Immobilie" };
export const themaFuer = (kategorie) => THEMA[kategorie] || "Ihres Vorhabens";

// Warum die Fragen gestellt werden (für den digitalen Assistenten)
const NUTZEN = {
  "Wärmepumpe": "Mit Haustyp, Wohnfläche und der heutigen Heizung kann der Fachbetrieb vorher einschätzen, ob und welche Wärmepumpe passt und was sie ungefähr kostet. Dann bekommen Sie gleich ein passendes Angebot statt nur eines Rückrufs. Eigentümer: weil nur Eigentümer die Heizung tauschen und Förderung beantragen können.",
  PV: "Mit Dachform, Ausrichtung und Stromverbrauch kann der Fachbetrieb vorher einschätzen, wie groß die Anlage sein sollte und was sie ungefähr bringt. Dann bekommen Sie gleich ein passendes Angebot. Eigentümer: weil die Anlage aufs eigene Dach kommt.",
  Altenpflege: "Mit Pflegegrad, Ort und der Art der Hilfe finden wir einen Pflegedienst, der in Ihrer Gegend genau diese Unterstützung anbietet und freie Kapazität hat.",
  Heizung: "Mit Haustyp, Wohnfläche und Alter der heutigen Heizung kann der Fachbetrieb vorher einschätzen, welche Heizung passt und was sie ungefähr kostet.",
};
export const nutzenFuer = (kategorie) => NUTZEN[kategorie] || "Mit ein paar Angaben zum Vorhaben kann der Fachbetrieb vorher einschätzen, was passt, und Ihnen gleich ein passendes Angebot machen.";

// Wer wir sind – für den digitalen Assistenten (Vertrauen). Eigene Fassung später über Einstellungen (c.ueberUns) möglich.
// Nur Aussagen, die stimmen: keine Kundenzahlen, Siegel oder „geprüft“, solange das nicht belegt ist.
export const UEBER_UNS_STANDARD = [
  "- {marke} ist ein kostenloser Vergleichs- und Vermittlungsdienst rund ums Modernisieren von Haus und Wohnung: Heizung und Wärmepumpe, Solar, Bad, Fenster, Dach, aber auch Unterstützung im Alter.",
  "- Wir verkaufen selbst nichts und bauen nichts ein. Wir bringen Interessenten mit passenden Fachbetrieben aus ihrer Region zusammen, damit sie Angebote vergleichen können, statt selbst herumzutelefonieren.",
  "- Für Interessenten ist das komplett kostenlos. Die Betriebe zahlen uns für die Vermittlung. Deshalb gibt es auch keinen Vertrag und keine Verpflichtung.",
  "- Die Angaben werden nur weitergegeben, wenn der Anrufer am Ende ausdrücklich zustimmt. Er kann das jederzeit widerrufen.",
  "- Mehr Informationen, auch zum Datenschutz, auf {marke} Punkt de.",
].join("\n");
export const ueberUns = (marke = "Modernisieren24", eigene = "") =>
  String(eigene || UEBER_UNS_STANDARD).replace(/\{marke\}/g, marke).replace(/Modernisieren24 Punkt de/gi, "modernisieren24 Punkt de");
