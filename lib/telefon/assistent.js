import { createHmac, timingSafeEqual } from "node:crypto";
import { holen, aendern, anlegen } from "@/lib/buchung/db";
import { skriptFuer, mailboxAbfrage } from "@/lib/telefon/skripte";

// Digitaler Assistent (ElevenLabs Agents) als letzte Stufe vor der Mailbox: nimmt ab, wenn niemand von uns rangeht,
// stellt sich ehrlich als digitaler Assistent vor, fragt kurz die wichtigsten Angaben ab und kündigt einen Rückruf an.
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
export const SYSTEM_PROMPT = `Du bist der digitale Telefon-Assistent von {{marke}}, einem kostenlosen Vermittlungsdienst: Interessenten bekommen bis zu drei Angebote geprüfter Anbieter aus ihrer Region. Gerade ist kein Mitarbeiter frei, deshalb nimmst du das Anliegen auf.

Thema dieses Anrufs: {{kategorie}} (kam über die Anzeige {{code}}{{ort_text}}).

So führst du das Gespräch:
- Kurz und freundlich, höchstens etwa zwei Minuten. Sprich langsam und deutlich, in kurzen Sätzen, per „Sie“. Viele Anrufer sind älter.
- Stelle immer nur eine Frage auf einmal. Wenn jemand etwas nicht sagen will, ist das in Ordnung.
- Frage nacheinander ab: {{fragen}}
- Wiederhole die Telefonnummer zur Sicherheit, falls der Anrufer eine andere Rückrufnummer nennt.
- Zum Schluss: „Vielen Dank! Ein Mitarbeiter von {{marke}} ruft Sie zurück, spätestens am nächsten Werktag, und bespricht alles Weitere mit Ihnen.“ Dann verabschiede dich.

Regeln:
- Du bist kein Mensch. Wenn jemand fragt, sagst du ehrlich: „Ich bin ein digitaler, automatischer Assistent. Ein Mitarbeiter ruft Sie persönlich zurück.“
- Keine Preise, Förderhöhen, Fristen oder Fachberatung. Dafür ist der Rückruf da.
- Hole keine Einwilligung zur Weitergabe an Anbieter ein. Das macht der Mitarbeiter beim Rückruf.
- Will jemand sofort einen Menschen oder ist verärgert: Verständnis zeigen, Rückruf zusagen, Gespräch freundlich beenden.
{{ton}}`;

export const ERSTE_NACHRICHT = "Guten Tag, hier ist der digitale Assistent von {{marke}}. Gerade ist leider kein Berater frei. Ich nehme Ihr Anliegen kurz auf, damit ein Mitarbeiter Sie zurückrufen kann. Das Gespräch wird dafür als Text gespeichert. Ist das in Ordnung?";

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

// TwiML, das den laufenden Anruf an den Assistenten übergibt (ElevenLabs register-call)
export async function uebergeben(anruf, c, agentId) {
  const kat = anruf.kategorie || "";
  const skript = skriptFuer(kat, c.skripte, anruf.marke || c.marke);
  const fragen = kat ? skript.fragen.filter((f) => !/^name/i.test(f)).slice(0, 5) : ["worum es geht", "Postleitzahl und Ort"];
  const vars = {
    marke: anruf.marke || c.marke || "Modernisieren24",
    kategorie: kat || "noch unbekannt – bitte freundlich erfragen",
    code: anruf.code || "unbekannt",
    ort_text: anruf.stadt ? `, ${anruf.stadt}` : "",
    fragen: ["Name", ...fragen].join("; ") + ". Kurz zusammengefasst: " + mailboxAbfrage(kat, c.skripte),
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
  if (anruf) {
    await aendern("anrufe", anruf.id, {
      status: "assistent", assistent: { konversation: data.conversation_id || "", zusammenfassung, transkript: transkript.slice(-80), angaben: f, sek: data.metadata?.call_duration_secs || 0 },
      rueckruf: anruf.rueckruf === "erledigt" ? "erledigt" : "offen",
    });
    if (anruf.kontaktId && sagteEtwas) {
      const k = await holen("kontakte", anruf.kontaktId);
      if (k) {
        const antworten = { ...(k.antworten || {}) };
        for (const [key, label] of [["eigentuemer", "Eigentümer"], ["anliegen", "Anliegen"], ["zeitpunkt", "Zeitpunkt"], ["rueckrufzeit", "Beste Rückrufzeit"], ["weitere_angaben", "Weitere Angaben"], ["rueckrufnummer", "Rückrufnummer"]]) if (f[key]) antworten[label] = f[key];
        await aendern("kontakte", k.id, {
          ...(f.name && !k.name ? { name: f.name } : {}), ...(f.plz && !k.plz ? { plz: (f.plz.match(/\d{5}/) || [f.plz])[0] } : {}), ...(f.ort && !k.ort ? { ort: f.ort } : {}),
          antworten, notiz: [k.notiz, zusammenfassung && `Digitaler Assistent: ${zusammenfassung}`].filter(Boolean).join("\n").slice(0, 4000),
        });
      }
    }
  } else {
    await anlegen("telefon_assistent_unzugeordnet", { konversation: data.conversation_id || "", vars, zusammenfassung, angaben: f, zeit: Date.now() });
  }
  return { anruf, angaben: f, zusammenfassung, sagteEtwas };
}
