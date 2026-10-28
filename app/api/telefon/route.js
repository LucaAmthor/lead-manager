import { NextResponse } from "next/server";
import { istMitglied } from "@/lib/telefon/auth";
import { liste, holen, aendern, anlegen } from "@/lib/buchung/db";
import { cfg, zuweisen, registrierung, herzschlag } from "@/lib/telefon/daten";
import { agentAnlegen, agentAktualisieren, assistentKonfiguriert } from "@/lib/telefon/assistent";
import * as tw from "@/lib/telefon/twilio";

// Seite /telefon und Browser-Telefon: Einrichtung prüfen, Nummern verwalten, Erreichbarkeit melden.
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const fehler = (code, status, extra = {}) => NextResponse.json({ code, ...extra }, { status });

export async function GET(request) {
  const user = await istMitglied();
  if (!user) return fehler("not_granted", 401);
  const detail = new URL(request.url).searchParams.get("detail") === "1";
  const env = {
    twilio: tw.konfiguriert(),
    appUrl: tw.appUrl(),
    service: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    mail: !!(process.env.RESEND_API_KEY && process.env.BUCHUNG_MAIL_FROM),
    cron: !!process.env.CRON_SECRET,
    assistent: assistentKonfiguriert(),
    assistentWebhook: !!process.env.ELEVENLABS_WEBHOOK_SECRET,
  };
  const out = { env, identitaet: tw.identitaetAus(user.email) };
  if (env.twilio && detail) {
    try {
      const c = await cfg();
      const [bundles, adressen, eigene, zugang] = await Promise.all([tw.bundles(), tw.adressen(), tw.eigeneNummern(), tw.browserZugang()]);
      const imPool = new Set((await liste("nummern")).map((n) => n.pnSid));
      out.twilio = {
        bundles, adressen, browser: !!zugang,
        auswahl: await registrierung(c).catch(() => ({})),
        fremdeNummern: eigene.filter((n) => !imPool.has(n.sid) && n.phone_number.startsWith("+49")).map((n) => ({ sid: n.sid, e164: n.phone_number, name: n.friendly_name, voiceUrl: n.voice_url })),
        falscheWebhooks: eigene.filter((n) => imPool.has(n.sid) && n.voice_url !== `${tw.appUrl()}/api/telefon/eingang`).length,
      };
    } catch (e) {
      out.twilioFehler = e.message;
    }
  }
  return NextResponse.json(out);
}

export async function POST(request) {
  const user = await istMitglied();
  if (!user) return fehler("not_granted", 401);
  const body = await request.json().catch(() => ({}));
  const id = tw.identitaetAus(user.email);
  try {
    switch (body.aktion) {
      case "herzschlag":
        await herzschlag(id, user.email, ["bereit", "pause", "gespraech", "offline"].includes(body.status) ? body.status : "offline");
        return NextResponse.json({ ok: true });
      case "angenommen":
        if (body.anrufId) await aendern("anrufe", body.anrufId, { status: "laeuft", angenommen: true, angenommenVon: id, angenommenEmail: user.email, angenommenAm: Date.now() });
        await herzschlag(id, user.email, "gespraech");
        return NextResponse.json({ ok: true });
      case "rueckruf":
        if (body.anrufId) await aendern("anrufe", body.anrufId, { rueckruf: body.wert || "erledigt", rueckrufVon: user.email, rueckrufAm: Date.now() });
        return NextResponse.json({ ok: true });
      case "einrichten": {
        const z = await tw.browserZugang({ anlegen: true });
        // Webhooks aller Pool-Nummern auf diese App setzen (z. B. nach Domainwechsel)
        let n = 0;
        for (const nr of await liste("nummern")) if (nr.pnSid) { await tw.nummerVerbinden(nr.pnSid); n++; }
        return NextResponse.json({ ok: true, browser: !!z, nummern: n });
      }
      case "assistent_einrichten": {
        // Assistenten bei ElevenLabs anlegen und als (pausierte) Stufe vor der Mailbox eintragen
        const c = await cfg();
        const agentId = body.agentId || (await agentAnlegen(c, { stimmeId: body.stimmeId }));
        const t = (await holen("einstellungen", "telefon")) || {};
        const ziele = Array.isArray(t.ziele) && t.ziele.length ? t.ziele : c.ziele;
        const neu = ziele.some((z) => z.typ === "assistent") ? ziele : [...ziele, { typ: "assistent", name: "Digitaler Assistent", aktiv: false, auchAusserhalb: true, ohneKategorien: "", sekunden: 0 }];
        const patch = { assistentAgentId: agentId, ziele: neu };
        if (t.id || Object.keys(t).length) await aendern("einstellungen", "telefon", patch); else await anlegen("einstellungen", patch, "telefon");
        return NextResponse.json({ ok: true, agentId });
      }
      case "assistent_aktualisieren": {
        const c = await cfg();
        if (!c.assistentAgentId) return fehler("setup", 409, { detail: "Noch kein Assistent angelegt." });
        const { assistentAbgleichen } = await import("@/lib/telefon/abgleich");
        await assistentAbgleichen({ erzwingen: true });
        return NextResponse.json({ ok: true });
      }
      case "zuweisen":
        return NextResponse.json({ ok: true, ...(await zuweisen({ ids: Array.isArray(body.anzeigeIds) && body.anzeigeIds.length ? body.anzeigeIds : null, manuell: true, kanal: body.kanal === "social" ? "social" : "print" })) });
      case "kaufen": {
        const c = await cfg();
        const z = await registrierung(c);
        if (!z.bundleSid || !z.addressSid) return fehler("setup", 409, { detail: "Noch keine freigegebenen Unterlagen (Regulatory Bundle) oder Adresse bei Twilio." });
        const frei = await tw.freieNummernSuchen(body.ortsnetz || c.ortsnetz);
        if (!frei.length) return fehler("keine_nummern", 409, { detail: "Keine freien Nummern in diesem Ortsnetz." });
        const pn = await tw.nummerKaufen(frei[0].phone_number, { ...z, name: "Lokalpilot Pool" });
        await anlegen("nummern", { e164: pn.phone_number, anzeige: tw.national(pn.phone_number, c.ortsnetz), pnSid: pn.sid, typ: "lokal", status: "frei", kanal: body.kanal || "print", gekauftAm: Date.now(), verlauf: [] }, pn.sid);
        return NextResponse.json({ ok: true, nummer: tw.national(pn.phone_number, c.ortsnetz) });
      }
      case "uebernehmen": {
        // Vorhandene Twilio-Nummer (z. B. eine 0800) in den Pool holen und an Lokalpilot hängen
        const pn = (await tw.eigeneNummern()).find((n) => n.sid === body.pnSid);
        if (!pn) return fehler("not_found", 404);
        await tw.nummerVerbinden(pn.sid);
        const c = await cfg();
        const typ = pn.phone_number.startsWith("+49800") ? "0800" : pn.phone_number.match(/^\+491[5-7]/) ? "mobil" : "lokal";
        if (!(await holen("nummern", pn.sid))) await anlegen("nummern", { e164: pn.phone_number, anzeige: tw.national(pn.phone_number, c.ortsnetz), pnSid: pn.sid, typ, status: body.status || "frei", kanal: body.kanal || "print", gekauftAm: Date.now(), verlauf: [] }, pn.sid);
        return NextResponse.json({ ok: true });
      }
      case "nummer": {
        // Status/Kanal einer Pool-Nummer ändern (frei, gesperrt; Kanal print/social)
        const nr = await holen("nummern", body.id);
        if (!nr) return fehler("not_found", 404);
        const patch = {};
        if (["frei", "gesperrt"].includes(body.status)) Object.assign(patch, { status: body.status, ...(body.status === "frei" ? { anzeigeId: null, code: null, ruhtBis: null } : {}) });
        if (["print", "social"].includes(body.kanal)) patch.kanal = body.kanal;
        await aendern("nummern", nr.id, patch);
        return NextResponse.json({ ok: true });
      }
      default:
        return fehler("invalid_argument", 400);
    }
  } catch (e) {
    console.error("Telefon:", body.aktion, e);
    return fehler(e.code || "fehler", e.code === "setup" ? 409 : 500, { detail: e.message });
  }
}
