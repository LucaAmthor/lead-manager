import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { planen, weiter, freigeben, antwortSenden, wegPruefen } from "@/lib/buchung/agent";
import { holen, aendern, verlauf, adminDb, geheimnisSetzen, einstellungen } from "@/lib/buchung/db";
import { senden } from "@/lib/buchung/mail";

// Aktionen der Seite /buchungen. Lange Läufe (Shop-Browser, Recherche) laufen nach der Antwort weiter;
// der Fortschritt erscheint live im Verlauf der Buchung.
export const maxDuration = 800;

const fehler = (code, status, extra = {}) => NextResponse.json({ code, ...extra }, { status });
const imHintergrund = (fn, was) =>
  after(async () => {
    try {
      await fn();
    } catch (e) {
      console.error("Buchung:", was, e);
    }
  });

async function istMitglied() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("lp_members").select("email").limit(1);
  return data?.length ? user : null;
}

export async function POST(request) {
  const user = await istMitglied();
  if (!user) return fehler("not_granted", 401);
  const body = await request.json().catch(() => ({}));
  const { aktion, id } = body;
  try {
    switch (aktion) {
      case "planen": {
        const neu = await planen({ nurIds: Array.isArray(body.anzeigeIds) && body.anzeigeIds.length ? body.anzeigeIds : null, von: `Von Hand (${user.email})` });
        imHintergrund(async () => {
          for (const b of neu) await weiter(b.id);
        }, "planen");
        return NextResponse.json({ ok: true, anzahl: neu.length });
      }
      case "weiter":
        imHintergrund(() => weiter(id), "weiter");
        return NextResponse.json({ ok: true });
      case "neu_starten":
      case "auf_anfrage":
      case "echt": {
        const b = await holen("buchungen", id);
        if (!b) return fehler("not_found", 404);
        const patch = { status: "neu", hilfe: "" };
        if (aktion === "auf_anfrage") patch.weg = "anfrage";
        if (aktion === "echt") {
          const cfg = await einstellungen();
          if (cfg.testmodus) return fehler("testmodus", 409, { detail: "Erst den Testmodus ausschalten." });
          patch.testmodus = false;
        }
        await verlauf(id, aktion === "echt" ? `Echte Buchung gestartet (${user.email}).` : aktion === "auf_anfrage" ? `Auf Anfrage per E-Mail umgestellt (${user.email}).` : `Neu gestartet (${user.email}).`, "start", patch);
        imHintergrund(() => weiter(id), aktion);
        return NextResponse.json({ ok: true });
      }
      case "freigeben":
        imHintergrund(() => freigeben(id, body.betrag), "freigeben");
        return NextResponse.json({ ok: true });
      case "antwort":
        if (!String(body.text || "").trim()) return fehler("invalid_argument", 400);
        await antwortSenden(id, String(body.text));
        return NextResponse.json({ ok: true });
      case "abbrechen": {
        const b = await holen("buchungen", id);
        if (!b) return fehler("not_found", 404);
        for (const aid of b.anzeigeIds || []) await aendern("anzeigen", aid, { buchungGesperrt: true, buchungHinweis: "Buchung von Hand abgebrochen" });
        await verlauf(id, `Abgebrochen (${user.email}). Bereits verschickte Zusagen bitte beim Verlag stornieren.`, "abbruch", { status: "abgebrochen" });
        return NextResponse.json({ ok: true });
      }
      case "bezahlt": {
        const b = await holen("buchungen", id);
        if (!b?.zahlung) return fehler("not_found", 404);
        await verlauf(id, `Zahlung als überwiesen markiert (${user.email}).`, "zahlung", { zahlung: { ...b.zahlung, status: "bezahlt", bezahltAm: new Date().toISOString(), bezahltVon: user.email } });
        return NextResponse.json({ ok: true });
      }
      case "entsperren":
        await aendern("anzeigen", id, { buchungGesperrt: false, buchungHinweis: "" });
        return NextResponse.json({ ok: true });
      case "weg_pruefen":
        await aendern("blaetter", body.blattId, { buchungRecherche: { laeuft: true, seit: Date.now() } });
        imHintergrund(async () => {
          try {
            await wegPruefen(body.blattId);
          } finally {
            await aendern("blaetter", body.blattId, { buchungRecherche: { laeuft: false } });
          }
        }, "weg_pruefen");
        return NextResponse.json({ ok: true });
      case "zugang": {
        const host = String(body.host || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
        if (!host || !body.login || !body.passwort) return fehler("invalid_argument", 400);
        await geheimnisSetzen(`shop:${host}`, { login: String(body.login), passwort: String(body.passwort), angelegt: new Date().toISOString(), von: user.email });
        return NextResponse.json({ ok: true, host });
      }
      case "testmail": {
        const cfg = await einstellungen();
        const r = await senden({ an: cfg.testEmpfaenger || user.email, betreff: "Lokalpilot: Test des Buchungs-Postfachs", text: "Wenn du diese Mail bekommst, funktioniert das Senden. Antworte auf diese Mail, um den Empfang zu testen (erscheint unter Buchungen → Postfach).", absenderName: cfg.absenderName });
        return NextResponse.json({ ok: true, an: r.an });
      }
      case "beleg": {
        const { data, error } = await adminDb().storage.from("lp-buchung").createSignedUrl(String(body.pfad), 600);
        if (error) return fehler("not_found", 404);
        return NextResponse.json({ ok: true, url: data.signedUrl });
      }
      default:
        return fehler("invalid_argument", 400);
    }
  } catch (e) {
    console.error("Buchung: Aktion", aktion, e);
    return fehler(e.code || "fehler", 500, { detail: e.message });
  }
}

// Welche Shop-Zugänge sind hinterlegt? (nur Domains, keine Passwörter)
export async function GET() {
  const user = await istMitglied();
  if (!user) return fehler("not_granted", 401);
  try {
    const { data } = await adminDb().from("lp_secrets").select("key, updated_at").like("key", "shop:%");
    const env = {
      resend: !!process.env.RESEND_API_KEY && !!process.env.BUCHUNG_MAIL_FROM,
      webhook: !!process.env.RESEND_WEBHOOK_SECRET,
      browser: !!process.env.BROWSERBASE_API_KEY,
      cron: !!process.env.CRON_SECRET,
      service: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      ki: !!process.env.ANTHROPIC_API_KEY,
      absender: process.env.BUCHUNG_MAIL_FROM || "",
    };
    return NextResponse.json({ zugaenge: (data || []).map((r) => ({ host: r.key.slice(5), seit: r.updated_at })), env });
  } catch (e) {
    return NextResponse.json({ zugaenge: [], env: { service: false }, detail: e.message });
  }
}
