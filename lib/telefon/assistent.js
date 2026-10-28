import { createHmac, timingSafeEqual } from "node:crypto";
import { holen, aendern, anlegen } from "@/lib/buchung/db";
import { skriptFuer, mailboxAbfrage, einwilligungFuer, anbieterFuer, nutzenFuer, themaFuer, ueberUns } from "@/lib/telefon/skripte";

// Digitaler Assistent (ElevenLabs Agents): nimmt ab, wenn niemand von uns im Browser bereit ist, stellt sich ehrlich als
// digitaler Assistent vor, fragt die Angaben ab und holt die Einwilligung zur Weitergabe selbst ein (Transkript = Nachweis).
// Danach ruft der Abnehmer (ein Mensch) den Interessenten an; ein Rückruf von uns ist nur nötig, wenn etwas offen blieb.
// Nach dem Gespräch schickt ElevenLabs Zusammenfassung + Angaben an /api/telefon/assistent (→ Kontakt + Rückrufliste).
// Vercel: ELEVENLABS_API_KEY, ELEVENLABS_WEBHOOK_SECRET (optional ELEVENLABS_API_BASE, z. B. EU-Region).
const BASIS = () => (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/+$/, "");
export const assistentKonfiguriert = () => !!process.env.ELEVENLABS_API_KEY;

async function el(pfad, body, method = "POST") {
  if (!assistentKonfiguriert()) throw Object.assign(new Error("ELEVENLABS_API_KEY fehlt in Vercel"), { code: "capability_disabled" });
  const res = await fetch(`${BASIS()}${pfad}`, {
    method,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`ElevenLabs ${res.status}: ${text.slice(0, 300)}`), { code: "elevenlabs" });
  return text;
}

// Prompt mit Platzhaltern {{…}}, die je Anruf gefüllt werden (dynamic_variables)
export const SYSTEM_PROMPT = `Du bist der digitale Telefon-Assistent von {{marke}}, einem kostenlosen Vermittlungsdienst: Interessenten bekommen über Partner aus unserem Netzwerk bis zu drei Angebote aus ihrer Region. Du nimmst die Anfrage vollständig auf.

Thema dieses Anrufs: {{kategorie}} (kam über die Anzeige {{code}}{{ort_text}}).
{{thema_regel}}

Wer wir sind (Vertrauen schaffen – in eigenen, ruhigen Worten, wenn jemand fragt, zögert oder misstrauisch ist):
{{ueber_uns}}

Warum der Anrufer seine Angaben machen sollte (das erklärst du, bevor du fragst, in zwei, drei kurzen Sätzen, und jederzeit, wenn jemand nachfragt oder zögert):
- So läuft es ab: Sie beantworten ein paar kurze Fragen, wir suchen passende {{anbieter}} aus Ihrer Region, die melden sich mit Angeboten. Sie vergleichen in Ruhe und entscheiden selbst.
- Kostenlos und unverbindlich. Kein Vertrag, keine Verpflichtung.
- {{nutzen}}
- Postleitzahl: damit sich nur Betriebe aus Ihrer Nähe melden. Name und Telefonnummer: damit der Betrieb Sie erreichen kann.
- Wenn jemand bei einer Frage zögert, sag kurz, wofür sie gebraucht wird. Wer etwas nicht sagen will, muss nicht.

So führst du das Gespräch:
- Freundlich und ruhig, höchstens etwa drei Minuten. Sprich langsam und deutlich, in kurzen Sätzen, per „Sie“. Viele Anrufer sind älter.
- Stelle immer nur eine Frage auf einmal.
- Bedanke dich NICHT nach jeder Antwort. Höchstens ein Dank am Ende des Gesprächs. Nach einer Antwort meist direkt die nächste Frage stellen, ab und zu eine kurze, wechselnde Bestätigung („Gut.“, „Alles klar.“, „Verstanden.“, „Prima.“) – nie zweimal hintereinander dieselbe.
- Postleitzahlen und Telefonnummern sprichst du IMMER Ziffer für Ziffer, nie als ganze Zahl. Postleitzahl 38259: „drei, acht, zwei, fünf, neun“ – niemals „achtunddreißigtausend…“. Telefonnummern in kleinen Gruppen mit kurzer Pause: „null, eins, fünf, zwei, zwei – acht, zwei, zwei …“. Hausnummern, Baujahre und Flächen normal als Zahl („Baujahr neunzehnhundertsiebzig“, „280 Quadratmeter“).
- Frage nacheinander ab: {{fragen}}
- Frage, ob wir die Nummer, von der angerufen wird, für die Rückmeldung nutzen dürfen, oder ob es eine andere gibt. Wiederhole eine andere Nummer zur Sicherheit.
- Lies danach die Einwilligung WÖRTLICH vor: „{{einwilligung}}“
- Nur ein klares Ja zählt (z. B. „ja“, „einverstanden“, „gerne“). Bei Zögern oder Nachfragen erklärst du kurz, dass sich ein Partner aus unserem Netzwerk telefonisch oder per E-Mail mit Angeboten meldet, und fragst noch einmal. Bei Nein: verständnisvoll bleiben, sagen, dass dann nichts weitergegeben wird, und freundlich verabschieden.
- Nach einem klaren Ja zum Schluss: {{abschluss}} Dann verabschiede dich.

Regeln:
- Du bist kein Mensch. Das sagst du am Anfang und ehrlich, wenn jemand fragt: „Ich bin ein digitaler, automatischer Assistent.“
- Keine Preise, Förderhöhen, Fristen oder Fachberatung. Das klärt der Partner im Gespräch.
- Will jemand unbedingt einen Menschen, ist verärgert oder hat eine Beschwerde: Verständnis zeigen, einen persönlichen Rückruf von {{marke}} zusagen, Gespräch freundlich beenden.
- Erfinde nichts. Wenn du etwas nicht weißt, sag, dass der Partner das im Gespräch klärt.
{{ton}}`;

export const ERSTE_NACHRICHT = "Guten Tag, hier ist {{marke}}. {{begruessung_thema}} Ich bin der digitale Assistent. {{marke}} ist ein kostenloser Vergleichsdienst: Wir bringen Sie mit Fachbetrieben aus Ihrer Region zusammen, damit Sie bis zu drei Angebote in Ruhe vergleichen können, ganz unverbindlich. Dafür stelle ich Ihnen ein paar kurze Fragen. Das Gespräch wird als Text gespeichert. Ist das in Ordnung?";

// Angaben, die ElevenLabs nach dem Gespräch aus dem Transkript zieht (Data Collection)
const FELDER = {
  name: "Vor- und Nachname des Anrufers, falls genannt",
  plz: "Postleitzahl (5 Ziffern), falls genannt",
  ort: "Wohnort bzw. Ort des Vorhabens",
  rueckrufnummer: "Rückrufnummer, falls eine andere als die Anrufernummer genannt wurde",
  eigentuemer: "Ist der Anrufer Eigentümer der Immobilie? ja/nein/unbekannt",
  anliegen: "Worum es genau geht, in einem Satz",
  zeitpunkt: "Wann das Vorhaben starten soll bzw. wie dringend",
  rueckrufzeit: "Wann der Anrufer am besten erreichbar ist",
  weitere_angaben: "Weitere Antworten auf die gestellten Fragen, kurz als Stichpunkte",
  einwilligung: "Hat der Anrufer der wörtlich vorgelesenen Einwilligung zur Weitergabe an Partner klar mit Ja zugestimmt? Nur ja oder nein. Nein, wenn sie nicht vorgelesen wurde oder die Antwort unklar war.",
  rueckruf_gewuenscht: "Wollte der Anrufer ausdrücklich einen persönlichen Rückruf von uns (Mensch, Beschwerde, offene Frage)? ja oder nein",
};

export async function agentAnlegen(c, { stimmeId } = {}) {
  const body = {
    name: `${c.marke || "Modernisieren24"} · Digitaler Assistent (Lokalpilot)`,
    conversation_config: {
      agent: {
        first_message: ERSTE_NACHRICHT,
        language: "de",
        prompt: { prompt: SYSTEM_PROMPT, temperature: 0.4 },
      },
      asr: { user_input_audio_format: "ulaw_8000", quality: "high" },
      tts: { model_id: "eleven_flash_v2_5", agent_output_audio_format: "ulaw_8000", ...(stimmeId ? { voice_id: stimmeId } : {}) },
      conversation: { max_duration_seconds: 300 },
    },
    platform_settings: {
      data_collection: Object.fromEntries(Object.entries(FELDER).map(([k, d]) => [k, { type: "string", description: d }])),
    },
  };
  const j = JSON.parse(await el("/v1/convai/agents/create", body));
  return j.agent_id;
}

/** Prompt, erste Nachricht und Datenfelder eines bestehenden Agenten auf den Stand im Code bringen. Stimme, LLM usw. bleiben. */
export async function agentAktualisieren(agentId) {
  const alt = JSON.parse(await el(`/v1/convai/agents/${agentId}`, null, "GET"));
  const agent = alt.conversation_config?.agent || {};
  const body = {
    conversation_config: { agent: { ...agent, first_message: ERSTE_NACHRICHT, prompt: { ...(agent.prompt || {}), prompt: SYSTEM_PROMPT } } },
    platform_settings: { ...(alt.platform_settings || {}),
      // Keine Tonaufnahme bei ElevenLabs; Gespräche dort nach 30 Tagen löschen (Transkript liegt per Webhook bei uns).
      privacy: { ...(alt.platform_settings?.privacy || {}), record_voice: false, delete_audio: true, retention_days: 30 },
      data_collection: Object.fromEntries(Object.entries(FELDER).map(([k, d]) => [k, { type: "string", description: d }])) },
  };
  await el(`/v1/convai/agents/${agentId}`, body, "PATCH");
  return true;
}

// TwiML, das den laufenden Anruf an den Assistenten übergibt (ElevenLabs register-call)
export async function uebergeben(anruf, c, agentId) {
  const kat = anruf.kategorie || "";
  const skript = skriptFuer(kat, c.skripte, anruf.marke || c.marke);
  // Thema steht durch die Anzeige fest → nicht noch einmal „Worum geht es?“ fragen
  const fragen = kat ? skript.fragen.filter((f) => !/^name/i.test(f) && !/worum geht es/i.test(f)).slice(0, 5) : ["worum es geht", "Postleitzahl und Ort"];
  const vars = {
    marke: anruf.marke || c.marke || "Modernisieren24",
    kategorie: kat || "noch unbekannt – bitte freundlich erfragen",
    thema_regel: kat
      ? `Das Thema steht durch die Anzeige fest. Frage NICHT, worum es geht oder warum jemand anruft. Gehe davon aus, dass es um ${themaFuer(kat)} geht. Nur wenn der Anrufer selbst etwas anderes sagt, nimm das auf.`
      : "Das Thema ist unbekannt: frage zuerst freundlich, worum es geht.",
    begruessung_thema: kat ? `Schön, dass Sie wegen ${themaFuer(kat)} anrufen.` : "Schön, dass Sie anrufen.",
    anbieter: anbieterFuer(kat),
    nutzen: nutzenFuer(kat),
    ueber_uns: ueberUns(anruf.marke || c.marke || "Modernisieren24", c.ueberUns),
    code: anruf.code || "unbekannt",
    ort_text: anruf.stadt ? `, ${anruf.stadt}` : "",
    fragen: ["Name", ...fragen].join("; ") + ". Kurz zusammengefasst: " + mailboxAbfrage(kat, c.skripte),
    einwilligung: einwilligungFuer(kat, c.einwilligung),
    abschluss: skript.abschluss.replace(/[„“]/g, ""),
    ton: kat === "Altenpflege" ? "- Besonders behutsam und geduldig: Es geht oft um Sorgen um Angehörige. Kein Zeitdruck spürbar machen." : "",
    anruf_id: anruf.id,
    anrufer: anruf.von || "",
  };
  const twiml = await el("/v1/convai/twilio/register-call", {
    agent_id: agentId,
    from_number: anruf.von || "",
    to_number: anruf.an || "",
    direction: "inbound",
    conversation_initiation_client_data: { dynamic_variables: vars },
  });
  // Antwort ist TwiML (manchmal als JSON-String verpackt)
  let x = twiml.trim();
  if (x.startsWith('"')) x = JSON.parse(x);
  return x.replace(/^<\?xml[^>]*>/, "").replace(/^\s*<Response>/, "").replace(/<\/Response>\s*$/, "");
}

// Signatur des Webhooks: Header „ElevenLabs-Signature: t=<zeit>,v0=<hmac-sha256(secret, "<zeit>.<body>")>“
export function signaturOk(roh, kopf) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) return process.env.ELEVENLABS_SIGNATUR_PRUEFEN === "aus";
  const teile = Object.fromEntries(String(kopf || "").split(",").map((p) => p.trim().split("=")));
  if (!teile.t || !teile.v0) return false;
  if (Math.abs(Date.now() / 1000 - Number(teile.t)) > 30 * 60) return false;
  const soll = createHmac("sha256", secret).update(`${teile.t}.${roh}`).digest("hex");
  const a = Buffer.from(soll), b = Buffer.from(teile.v0);
  return a.length === b.length && timingSafeEqual(a, b);
}

const wert = (x) => (x && typeof x === "object" ? x.value ?? "" : x ?? "");

/** Ergebnis des Gesprächs übernehmen: Anruf (Zusammenfassung, Transkript), Kontakt (Angaben), Rückruf offen. */
export async function ergebnisSpeichern(data) {
  const vars = data.conversation_initiation_client_data?.dynamic_variables || {};
  const anrufId = vars.anruf_id;
  const anruf = anrufId ? await holen("anrufe", anrufId) : null;
  const dc = data.analysis?.data_collection_results || {};
  const f = Object.fromEntries(Object.keys(FELDER).map((k) => [k, String(wert(dc[k]) || "").trim()]).filter(([, v]) => v && !/^(unbekannt|none|null|n\/a)$/i.test(v)));
  const transkript = (data.transcript || []).filter((t) => t.message).map((t) => ({ wer: t.role === "agent" ? "Assistent" : "Anrufer", text: String(t.message).slice(0, 2000), sek: t.time_in_call_secs || 0 }));
  const zusammenfassung = String(data.analysis?.transcript_summary || "").slice(0, 3000);
  const sagteEtwas = transkript.some((t) => t.wer === "Anrufer");
  // Einwilligung nur, wenn ElevenLabs „ja“ erkannt hat UND der Text im Gespräch vorgelesen wurde (Prüfung über einen Teilsatz)
  const vorgelesen = transkript.some((t) => t.wer === "Assistent" && /einverstanden/i.test(t.text) && /weiter/i.test(t.text));
  const einwilligung = /^ja\b/i.test(f.einwilligung || "") && vorgelesen;
  const rueckrufGewuenscht = /^ja\b/i.test(f.rueckruf_gewuenscht || "");
  if (anruf) {
    await aendern("anrufe", anruf.id, {
      status: "assistent", assistent: { konversation: data.conversation_id || "", zusammenfassung, transkript: transkript.slice(-80), angaben: f, sek: data.metadata?.call_duration_secs || 0 },
      ...(!anruf.gespraechSek && data.metadata?.call_duration_secs ? { gespraechSek: data.metadata.call_duration_secs } : {}),
      rueckruf: anruf.rueckruf === "erledigt" || (einwilligung && !rueckrufGewuenscht) ? "erledigt" : sagteEtwas ? "offen" : anruf.rueckruf || "offen",
    });
    if (anruf.kontaktId && sagteEtwas) {
      const k = await holen("kontakte", anruf.kontaktId);
      if (k) {
        const antworten = { ...(k.antworten || {}) };
        for (const [key, label] of [["eigentuemer", "Eigentümer"], ["anliegen", "Anliegen"], ["zeitpunkt", "Zeitpunkt"], ["rueckrufzeit", "Beste Rückrufzeit"], ["weitere_angaben", "Weitere Angaben"], ["rueckrufnummer", "Rückrufnummer"]]) if (f[key]) antworten[label] = f[key];
        await aendern("kontakte", k.id, {
          ...(f.name && !k.name ? { name: f.name } : {}), ...(f.plz && !k.plz ? { plz: (f.plz.match(/\d{5}/) || [f.plz])[0] } : {}), ...(f.ort && !k.ort ? { ort: f.ort } : {}),
          antworten, notiz: [k.notiz, zusammenfassung && `Digitaler Assistent: ${zusammenfassung}`].filter(Boolean).join("\n").slice(0, 4000),
          ...(einwilligung && !k.einwilligung ? { einwilligung: true, einwilligungText: vars.einwilligung || "", einwilligungAm: Date.now(), einwilligungKanal: "Telefon (digitaler Assistent)", einwilligungDurch: "Digitaler Assistent", einwilligungAnruf: anruf.id, einwilligungNachweis: data.conversation_id || "" } : {}),
        });
      }
    }
  } else {
    await anlegen("telefon_assistent_unzugeordnet", { konversation: data.conversation_id || "", vars, zusammenfassung, angaben: f, zeit: Date.now() });
  }
  return { anruf, angaben: f, zusammenfassung, sagteEtwas, einwilligung, rueckrufGewuenscht };
}
