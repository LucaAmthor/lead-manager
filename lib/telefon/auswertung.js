import { liste, anlegen } from "@/lib/buchung/db";
import { kiJson } from "@/lib/buchung/ki";
import { cfg as telefonCfg, mailAnTeam } from "@/lib/telefon/daten";
import { kennzahlen, ABBRUCH } from "@/lib/telefon/kennzahlen";
import { SYSTEM_PROMPT, ERSTE_NACHRICHT } from "@/lib/telefon/assistent";
import { appUrl } from "@/lib/telefon/twilio";

const TAG = 864e5;
const pct = (x) => (x == null ? "–" : Math.round(x * 100) + " %");

/**
 * Wochen-Auswertung (montags früh über /api/telefon/cron, oder per Knopf): Kennzahlen der letzten 7 Tage +
 * KI liest die Gespräche des Assistenten und schlägt konkrete Änderungen vor. Wird NICHT automatisch umgesetzt –
 * Vorschläge prüfen und dann im Code bzw. in den Telefon-Einstellungen ändern.
 */
export async function wochenAuswertung({ tage = 7 } = {}) {
  const c = await telefonCfg();
  const bis = Date.now();
  const von = bis - tage * TAG;
  const [anrufe, kontakteListe] = await Promise.all([liste("anrufe"), liste("kontakte")]);
  const kontakte = new Map(kontakteListe.map((k) => [k.id, k]));
  const jetzt = kennzahlen({ anrufe, kontakte, von, bis, cfg: c });
  const vorher = kennzahlen({ anrufe, kontakte, von: von - tage * TAG, bis: von, cfg: c });
  const gespraeche = anrufe
    .filter((a) => jetzt.ids.includes(a.id) && a.assistent?.transkript?.length)
    .sort((p, q) => q.start - p.start)
    .slice(0, 40)
    .map((a, i) => {
      const k = kontakte.get(a.kontaktId);
      const kopf = `### Gespräch ${i + 1} · ${a.kategorie || "?"} · ${a.code || ""} · ${Math.round((a.assistent.sek || 0) / 60 * 10) / 10} Min · Lead: ${k?.einwilligung && !k?.widerrufen ? "ja" : "nein"} · Abbruch: ${a.assistent.abbruch || "?"}`;
      const text = a.assistent.transkript.map((t) => `${t.wer}: ${t.text}`).join("\n").slice(0, 5000);
      return `${kopf}\n${text}`;
    });

  let ki = null;
  if (gespraeche.length) {
    const { result } = await kiJson(
      `Du optimierst den digitalen Telefon-Assistenten von Modernisieren24 (kostenloser Vermittlungsdienst, Anrufer kommen über Zeitungsanzeigen, oft 50+). Ziel: mehr Anrufer geben ihre Daten an und stimmen der Weitergabe zu (Lead mit Einwilligung) – ohne Druck, ehrlich, rechtlich sauber (KI-Hinweis, Einwilligung wörtlich, keine erfundenen Fakten).

Kennzahlen letzte ${tage} Tage: ${JSON.stringify({ anrufe: jetzt.anrufe, leads: jetzt.leads, quote: pct(jetzt.quote), assistent: jetzt.assistent, mensch: jetzt.mensch, verpasst: jetzt.verpasst, abbruch: jetzt.abbruch, kriterien: jetzt.kriterien })}
Vorwoche: ${JSON.stringify({ anrufe: vorher.anrufe, leads: vorher.leads, quote: pct(vorher.quote), abbruch: vorher.abbruch })}
Abbruch-Stellen: ${JSON.stringify(ABBRUCH)}

Aktuelle Begrüßung: ${ERSTE_NACHRICHT}

Aktueller Prompt:
${SYSTEM_PROMPT.slice(0, 9000)}

Gespräche (${gespraeche.length}):
${gespraeche.join("\n\n")}

Gib JSON zurück:
{"zusammenfassung": "2–3 Sätze: wie lief die Woche",
 "probleme": [{"problem": "", "beleg": "kurzes Zitat oder Gespräch-Nr.", "haeufigkeit": "z. B. 4 von 12"}],
 "vorschlaege": [{"titel": "", "aenderung": "konkreter neuer Wortlaut oder Einstellung", "wo": "begruessung|prompt|fragen|einwilligung|einstellung|anzeige|prozess", "warum": "", "wirkung": "hoch|mittel|gering"}],
 "gut": ["was gut funktioniert und bleiben soll"],
 "test_naechste_woche": "eine Sache, die wir nächste Woche gezielt vergleichen sollten"}
Höchstens 5 Probleme und 5 Vorschläge, nach Wirkung sortiert. Nur, was die Gespräche belegen. Bei wenigen Gesprächen vorsichtig formulieren.`,
      { system: "Du wertest Telefongespräche eines digitalen Assistenten aus und machst konkrete, umsetzbare Verbesserungsvorschläge auf Deutsch.", maxTokens: 3000 }
    );
    ki = result;
  }

  const eintrag = await anlegen("telefon_auswertungen", {
    zeit: bis, von, bis, tage,
    kennzahlen: { ...jetzt, ids: undefined }, vorher: { anrufe: vorher.anrufe, leads: vorher.leads, quote: vorher.quote },
    gespraeche: gespraeche.length, ...(ki || {}),
  });

  const zeilen = [
    `Anrufe: ${jetzt.anrufe} (Vorwoche ${vorher.anrufe}) · Leads mit Einwilligung: ${jetzt.leads} (${vorher.leads}) · Quote: ${pct(jetzt.quote)} (${pct(vorher.quote)})`,
    `Digitaler Assistent: ${jetzt.assistent.anrufe} Gespräche, ${jetzt.assistent.leads} Leads · Mensch: ${jetzt.mensch.anrufe} Gespräche, ${jetzt.mensch.leads} Leads · verpasst: ${jetzt.verpasst}`,
    `Abbruch: ${Object.entries(jetzt.abbruch).sort((p, q) => q[1] - p[1]).map(([k, n]) => `${ABBRUCH[k] || k} ${n}`).join(", ") || "–"}`,
    "",
    ki?.zusammenfassung || (gespraeche.length ? "" : "Keine Gespräche mit dem Assistenten in diesem Zeitraum."),
    ...(ki?.vorschlaege?.length ? ["", "Vorschläge:", ...ki.vorschlaege.map((v, i) => `${i + 1}. ${v.titel} (${v.wirkung}, ${v.wo}): ${v.aenderung} – ${v.warum}`)] : []),
    "",
    `Ganze Auswertung: ${appUrl()}/telefon`,
  ];
  if (jetzt.anrufe || vorher.anrufe) await mailAnTeam(c, `Telefon-Wochenauswertung: ${jetzt.leads} Leads aus ${jetzt.anrufe} Anrufen (${pct(jetzt.quote)})`, zeilen.join("\n"));
  return { id: eintrag.id, anrufe: jetzt.anrufe, leads: jetzt.leads, gespraeche: gespraeche.length };
}
