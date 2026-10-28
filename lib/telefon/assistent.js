import { createHmac, timingSafeEqual } from "node:crypto";
import { holen, aendern, anlegen } from "@/lib/buchung/db";
import { widerrufSpeichern } from "@/lib/telefon/widerruf";
import { orteZurPlz } from "@/lib/telefon/plz";
import { appUrl } from "@/lib/telefon/twilio";
import { skriptFuer, assistentFragen, einwilligungFuer, anbieterFuer, nutzenFuer, themaFuer, ueberUns } from "@/lib/telefon/skripte";

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
export const SYSTEM_PROMPT = `Du bist der digitale Telefon-Assistent von {{marke}}, einem kostenlosen Vermittlungsdienst: Interessenten bekommen über Partner aus unserem Netzwerk bis zu drei Angebote aus ihrer Region. Du nimmst die Anfrage auf – kurz, freundlich, vertrauenswürdig.

Thema dieses Anrufs: {{kategorie}} (kam über die Anzeige {{code}}{{ort_text}}).
{{thema_regel}}

Die Begrüßung hast du schon gesagt, sie endete mit der ersten Frage: „{{erste_frage}}“. Mach mit der Antwort darauf weiter.

Ablauf (genau in dieser Reihenfolge, immer nur EINE Frage auf einmal):
1. Fragen zum Vorhaben: {{fragen}}
   Nicht mehr als diese Fragen. Alles Weitere klärt der Fachbetrieb.
2. Postleitzahl. Nach dem Ort fragst du NICHT: nutze das Werkzeug „ort_zur_postleitzahl“ und bestätige den Ort kurz („Das ist in Salzgitter, richtig?“). Mehrere Orte → frag, welcher. Werkzeug findet nichts → frag, ob die Postleitzahl stimmt, sonst nach dem Wohnort.
3. Name: „Und wie ist Ihr Name, damit der Fachbetrieb Sie ansprechen kann?“ Wiederhole den Nachnamen einmal. Korrigiert der Anrufer dich oder klingt der Name ungewöhnlich, bitte ihn, den Nachnamen zu buchstabieren.
4. Rückrufnummer: Frag, ob die Betriebe die Nummer nutzen dürfen, von der gerade angerufen wird, oder ob es eine andere gibt. Eine andere Nummer wiederholst du zur Kontrolle.
5. Einwilligung: Leite kurz über („Zum Schluss lese ich Ihnen kurz vor, wozu Sie zustimmen, dann sind wir schon fertig.“) und lies dann WÖRTLICH vor: „{{einwilligung}}“
   Nur ein klares Ja zählt (z. B. „ja“, „einverstanden“, „gerne“). Bei Zögern oder Nachfragen kurz erklären, dass sich ein Partner aus unserem Netzwerk telefonisch oder per E-Mail mit Angeboten meldet, und noch einmal fragen. Bei Nein: verständnisvoll bleiben, sagen, dass dann nichts weitergegeben wird, freundlich verabschieden.
6. Nach einem klaren Ja: {{abschluss}} Verabschiede dich kurz und beende dann das Gespräch mit dem Werkzeug „end_call“. Nach der Verabschiedung sagst du nichts mehr.

Wer wir sind (in eigenen, ruhigen Worten, wenn jemand fragt, zögert oder misstrauisch ist):
{{ueber_uns}}

Warum die Angaben gebraucht werden (kurz erklären, wenn jemand zögert oder nachfragt; wer etwas nicht sagen will, muss nicht):
- {{nutzen}}
- Postleitzahl: damit sich nur Betriebe aus der Nähe melden. Name und Telefonnummer: damit der Betrieb den Anrufer erreichen kann.
- Kostenlos und unverbindlich, kein Vertrag. Der Anrufer vergleicht in Ruhe und entscheidet selbst.

Was mit dem Gespräch passiert (feste Fakten – sag sie ruhig und sicher, nimm sie NIE zurück und relativiere sie nicht):
- Das Gespräch wird als Text gespeichert, damit wir die Anfrage bearbeiten können. Es gibt keine Tonaufnahme.
- Bei uns werden die Anfrage und der Gesprächstext nach zwölf Monaten gelöscht bzw. anonymisiert. Der Nachweis der Einwilligung wird drei Jahre aufbewahrt. Beim technischen Sprachdienst wird das Gespräch nach dreißig Tagen gelöscht.
- Die Angaben gehen nur an Partner, wenn der Anrufer am Ende ausdrücklich zustimmt.
- Mehr zum Datenschutz: auf modernisieren24 Punkt de.

Wenn jemand seine Daten nicht einem Assistenten geben möchte:
- Biete an: „Möchten Sie lieber, dass ein Mitarbeiter Sie kurz zurückruft? Dann brauche ich nur Ihren Namen.“ Bei Ja: Name aufnehmen, Rückruf zusagen, freundlich verabschieden, end_call.

So sprichst du:
- Freundlich, ruhig und zügig, in kurzen Sätzen, per „Sie“. Viele Anrufer sind älter. Ziel: unter fünf Minuten.
- Wiederhole Antworten NICHT. Zur Kontrolle wiederholst du nur Postleitzahl, Nachname und eine abweichende Telefonnummer.
- Bedanke dich nicht nach jeder Antwort, höchstens einmal am Ende. Meist direkt die nächste Frage, ab und zu eine kurze, wechselnde Bestätigung („Gut.“, „Alles klar.“, „Prima.“). Den Namen des Anrufers sagst du höchstens zweimal.
- Postleitzahlen und Telefonnummern IMMER Ziffer für Ziffer: „drei, acht, zwei, fünf, neun“ – niemals „achtunddreißigtausend…“. Telefonnummern in kleinen Gruppen mit kurzer Pause. Baujahre und Flächen normal als Zahl („neunzehnhundertsiebzig“, „zweihundert Quadratmeter“).
- E-Mail-Adressen so: „info at modernisieren24 Punkt de“.
- Alles, was du schreibst, wird vorgelesen: keine Regieanweisungen, keine Klammern wie [slow], keine Sternchen, keine Aufzählungszeichen.

Widerruf / Daten löschen:
- Will jemand eine frühere Einwilligung widerrufen, keine Anrufe mehr bekommen oder seine Daten löschen lassen: keine Fragen zum Vorhaben. Frage nur nach dem Namen und der Telefonnummer, unter der er bei uns angefragt hat (meist die, von der er gerade anruft). Bestätige: „In Ordnung. Wir geben Ihre Daten nicht mehr weiter und informieren die Partner, die sie schon bekommen haben. Sie bekommen keine weiteren Anrufe dazu.“ Dann verabschieden und end_call.
- Fragt jemand, wie er später widerrufen kann: einfach wieder bei uns anrufen, gern unter dieser Nummer, oder eine E-Mail an info at modernisieren24 Punkt de.

Regeln:
- Du bist kein Mensch. Das ist in der Begrüßung gesagt; ehrlich bestätigen, wenn jemand fragt: „Ich bin ein digitaler, automatischer Assistent.“
- Keine Preise, Förderhöhen, Fristen oder Fachberatung. Das klärt der Partner.
- Will jemand unbedingt einen Menschen, ist verärgert oder hat eine Beschwerde: Verständnis zeigen, persönlichen Rückruf von {{marke}} zusagen, freundlich beenden.
- Erfinde nichts. Wenn du etwas nicht weißt, sag, dass der Partner das im Gespräch klärt.
{{ton}}`;

// Höchstdauer eines Gesprächs (vorher 300 s → Assistent legte bei 5:00 mitten im Satz auf)
const MAX_SEK = 480;

// Kurz, Hinweis auf KI + Speicherung als Information (keine Ja/Nein-Hürde), endet direkt mit einer leichten ersten Frage
export const ERSTE_NACHRICHT = "Guten Tag, hier ist {{marke}}, Sie sprechen mit dem digitalen Assistenten. {{begruessung_thema}} Wir vergleichen kostenlos für Sie und vermitteln bis zu drei unverbindliche Angebote von Fachbetrieben aus Ihrer Region. Dafür stelle ich Ihnen ein paar kurze Fragen, das Gespräch wird dabei als Text gespeichert. {{erste_frage}}";

// Gesprächs-Einstellungen bei ElevenLabs (Wartezeiten, Tempo, Füllsatz, Erkennung) – werden bei jedem Abgleich gesetzt
const STIL = {
  turn: {
    turn_timeout: 12, // länger warten, bevor „Sind Sie noch da?“ (ältere Anrufer überlegen länger)
    turn_eagerness: "patient",
    silence_end_call_timeout: 45, // nach 45 s Stille auflegen statt bis zur Höchstdauer zu warten
    soft_timeout_config: { timeout_seconds: 2.5, message: "Einen kleinen Moment …", additional_soft_timeout_messages: ["Moment, ich notiere das kurz.", "Einen Augenblick bitte."], randomize_fillers: true, max_soft_timeouts_per_generation: 1, disable_until_first_user_message: true },
  },
  tts: { speed: 0.92 },
  keywords: ["Modernisieren24", "Wärmepumpe", "Photovoltaik", "Solaranlage", "Ölheizung", "Gasheizung", "Nachtspeicher", "Fußbodenheizung", "Heizkörper", "Einfamilienhaus", "Doppelhaushälfte", "Reihenhaus", "Pflegegrad", "Pflegedienst", "Satteldach", "Flachdach"],
};

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
  widerruf: "Wollte der Anrufer eine Einwilligung widerrufen, keine Anrufe mehr oder seine Daten löschen lassen? ja oder nein",
  abbruch_bei: "Wo ist das Gespräch steckengeblieben? Genau einer von: keiner (vollständig mit Einwilligung), begruessung, fragen_vorhaben, postleitzahl, name, telefonnummer, einwilligung_nein, einwilligung_unklar, aufgelegt, widerruf, mensch_gewuenscht, falsches_thema",
  zoegern: "Hat der Anrufer an einer Stelle gezögert, nachgefragt oder Misstrauen gezeigt? Wenn ja: wo und warum, ein kurzer Satz. Sonst: nein",
  rueckruf_gewuenscht: "Wollte der Anrufer ausdrücklich einen persönlichen Rückruf von uns (Mensch, Beschwerde, offene Frage)? ja oder nein",
};

// Erfolgskriterien, die ElevenLabs nach jedem Gespräch bewertet (Basis für die Wochen-Auswertung)
const KRITERIEN = [
  { id: "lead_mit_einwilligung", name: "Lead mit Einwilligung", type: "prompt", conversation_goal_prompt: "Erfolg, wenn der Anrufer Postleitzahl, Namen und eine Rückrufnummer genannt und der wörtlich vorgelesenen Einwilligung klar mit Ja zugestimmt hat." },
  { id: "vertrauen", name: "Vertrauen gehalten", type: "prompt", conversation_goal_prompt: "Erfolg, wenn der Assistent keine Aussage zurückgenommen oder relativiert hat, keine Fakten erfunden hat und Misstrauen oder Zögern des Anrufers ruhig und sachlich aufgelöst hat. Misserfolg bei Widersprüchen oder unsicheren Aussagen zum Datenschutz." },
  { id: "kurz_und_klar", name: "Kurz und klar", type: "prompt", conversation_goal_prompt: "Erfolg, wenn der Assistent immer nur eine Frage auf einmal gestellt, Antworten nicht unnötig wiederholt, sich nicht ständig bedankt und das Gespräch nach der Verabschiedung beendet hat." },
];

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
      conversation: { max_duration_seconds: MAX_SEK },
    },
    platform_settings: {
      data_collection: Object.fromEntries(Object.entries(FELDER).map(([k, d]) => [k, { type: "string", description: d }])),
    },
  };
  const j = JSON.parse(await el("/v1/convai/agents/create", body));
  return j.agent_id;
}

// Werkzeug „Postleitzahl → Ort“ (Webhook auf /api/telefon/plz). Wird bei „Assistent aktualisieren“ angelegt bzw. aktualisiert.
const PLZ_WERKZEUG = () => ({
  type: "webhook",
  name: "ort_zur_postleitzahl",
  description: "Findet zu einer deutschen Postleitzahl den Ort. Immer aufrufen, sobald der Anrufer seine Postleitzahl genannt hat, statt nach dem Ort zu fragen.",
  api_schema: {
    url: `${appUrl()}/api/telefon/plz`,
    method: "GET",
    query_params_schema: { properties: { plz: { type: "string", description: "Die fünfstellige Postleitzahl, nur Ziffern, z. B. 38259" } }, required: ["plz"] },
  },
  response_timeout_secs: 5,
  pre_tool_speech: "off",
});

async function plzWerkzeugId() {
  const cfg = PLZ_WERKZEUG();
  if (!cfg.api_schema.url.startsWith("https://")) return null;
  const liste = JSON.parse(await el("/v1/convai/tools", null, "GET"));
  const da = (liste.tools || []).find((t) => t.tool_config?.name === cfg.name);
  if (da) {
    await el(`/v1/convai/tools/${da.id}`, { tool_config: cfg }, "PATCH");
    return da.id;
  }
  return JSON.parse(await el("/v1/convai/tools", { tool_config: cfg })).id;
}

/** Prompt, erste Nachricht und Datenfelder eines bestehenden Agenten auf den Stand im Code bringen. Stimme, LLM usw. bleiben. */
export async function agentAktualisieren(agentId, { orte = [] } = {}) {
  const alt = JSON.parse(await el(`/v1/convai/agents/${agentId}`, null, "GET"));
  const cc = alt.conversation_config || {};
  const agent = cc.agent || {};
  const werkzeug = await plzWerkzeugId();
  const toolIds = [...new Set([...(agent.prompt?.tool_ids || []), ...(werkzeug ? [werkzeug] : [])])];
  const { tools: _alteTools, ...altPrompt } = agent.prompt || {};
  const builtIn = { ...(altPrompt.built_in_tools || {}), end_call: { type: "system", name: "end_call", description: "Beendet das Telefonat. Nach der Verabschiedung aufrufen.", params: { system_tool_type: "end_call" } } };
  const keywords = [...new Set([...STIL.keywords, ...orte])].slice(0, 50);
  const body = {
    conversation_config: {
      agent: { ...agent, first_message: ERSTE_NACHRICHT, prompt: { ...altPrompt, prompt: SYSTEM_PROMPT, tool_ids: toolIds, built_in_tools: builtIn, thinking_budget: 0 } },
      conversation: { ...(cc.conversation || {}), max_duration_seconds: MAX_SEK },
      turn: { ...(cc.turn || {}), ...STIL.turn, soft_timeout_config: { ...(cc.turn?.soft_timeout_config || {}), ...STIL.turn.soft_timeout_config } },
      tts: { ...(cc.tts || {}), ...STIL.tts },
      asr: { ...(cc.asr || {}), keywords },
    },
    platform_settings: { ...(alt.platform_settings || {}),
      // Keine Tonaufnahme bei ElevenLabs; Gespräche dort nach 30 Tagen löschen (Transkript liegt per Webhook bei uns).
      privacy: { ...(alt.platform_settings?.privacy || {}), record_voice: false, delete_audio: true, retention_days: 30 },
      data_collection: Object.fromEntries(Object.entries(FELDER).map(([k, d]) => [k, { type: "string", description: d }])),
      evaluation: { ...(alt.platform_settings?.evaluation || {}), criteria: KRITERIEN } },
  };
  await el(`/v1/convai/agents/${agentId}`, body, "PATCH");
  return true;
}

// TwiML, das den laufenden Anruf an den Assistenten übergibt (ElevenLabs register-call)
export async function uebergeben(anruf, c, agentId) {
  const kat = anruf.kategorie || "";
  const skript = skriptFuer(kat, c.skripte, anruf.marke || c.marke);
  // Thema steht durch die Anzeige fest → nicht noch einmal „Worum geht es?“ fragen
  // Nur Fragen zum Vorhaben (Postleitzahl, Name, Nummer kommen danach fest im Ablauf), höchstens vier
  const eigene = c.skripte?.[kat]?.fragen;
  const vorhaben = (eigene?.length ? eigene : assistentFragen(kat) || skript.fragen)
    .filter((f) => !/^name|postleitzahl|worum geht es|rückruf/i.test(f)).slice(0, 4);
  const fragen = kat ? vorhaben : ["Worum geht es bei Ihnen?"];
  const ersteFrage = fragen[0] || "Worum geht es bei Ihnen?";
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
    fragen: fragen.join(" – "),
    erste_frage: ersteFrage,
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
  if (f.plz && !f.ort) { const o = orteZurPlz(f.plz).orte; if (o.length === 1) f.ort = o[0]; }
  const transkript = (data.transcript || []).filter((t) => t.message).map((t) => ({ wer: t.role === "agent" ? "Assistent" : "Anrufer", text: String(t.message).slice(0, 2000), sek: t.time_in_call_secs || 0 }));
  const zusammenfassung = String(data.analysis?.transcript_summary || "").slice(0, 3000);
  const sagteEtwas = transkript.some((t) => t.wer === "Anrufer");
  // Einwilligung nur, wenn ElevenLabs „ja“ erkannt hat UND der Text im Gespräch vorgelesen wurde (Prüfung über einen Teilsatz)
  const vorgelesen = transkript.some((t) => t.wer === "Assistent" && /einverstanden/i.test(t.text) && /weiter/i.test(t.text));
  const einwilligung = /^ja\b/i.test(f.einwilligung || "") && vorgelesen;
  const rueckrufGewuenscht = /^ja\b/i.test(f.rueckruf_gewuenscht || "");
  const widerruf = /^ja\b/i.test(f.widerruf || "");
  if (anruf) {
    await aendern("anrufe", anruf.id, {
      status: "assistent", assistent: { konversation: data.conversation_id || "", zusammenfassung, transkript: transkript.slice(-80), angaben: f, sek: data.metadata?.call_duration_secs || 0, abbruch: (f.abbruch_bei || "").toLowerCase().split(/[\s,(]/)[0] || "", zoegern: /^nein\b/i.test(f.zoegern || "") ? "" : f.zoegern || "", kriterien: Object.fromEntries(Object.entries(data.analysis?.evaluation_criteria_results || {}).map(([k, v]) => [k, v?.result || ""])), ende: data.metadata?.termination_reason || "" },
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
    if (widerruf) await widerrufSpeichern({ telefone: [anruf.von, f.rueckrufnummer], kontaktIds: [anruf.kontaktId], name: f.name || "", kanal: "Telefon (digitaler Assistent)", nachweis: data.conversation_id || "", anrufId: anruf.id });
  } else {
    await anlegen("telefon_assistent_unzugeordnet", { konversation: data.conversation_id || "", vars, zusammenfassung, angaben: f, zeit: Date.now() });
  }
  return { anruf, angaben: f, zusammenfassung, sagteEtwas, einwilligung: einwilligung && !widerruf, rueckrufGewuenscht, widerruf };
}

/** Kennung des Assistenten-Stands im Code. Ändert sich bei jeder Änderung an Prompt, Begrüßung, Feldern, Werkzeug oder Dauer. */
export function assistentStand(extra = "") {
  const text = JSON.stringify([SYSTEM_PROMPT, ERSTE_NACHRICHT, FELDER, PLZ_WERKZEUG(), MAX_SEK, STIL, KRITERIEN, extra]);
  return createHmac("sha256", "lokalpilot").update(text).digest("hex").slice(0, 16);
}

