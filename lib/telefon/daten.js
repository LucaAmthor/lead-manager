import { adminDb, liste, holen, anlegen, aendern, num } from "@/lib/buchung/db";
import { senden } from "@/lib/buchung/mail";
import * as tw from "@/lib/telefon/twilio";
export { STANDARD_SKRIPT, STANDARD_SKRIPTE } from "@/lib/telefon/skripte";

// Telefonie-Daten in lp_docs: nummern (Pool), anrufe, telefon_praesenz (wer ist erreichbar), telefon_zeit (Online-Minuten je Tag),
// einstellungen/telefon. Kontakte landen wie bisher in „kontakte“ und zählen damit automatisch in Analytics.

export const STANDARD = {
  ortsnetz: "",
  maxNummern: 30,
  ruheTage: 56, // nach dem Nachlauf so lange ruhen, bevor die Nummer wieder vergeben wird (Nachzügler zählen zur alten Anzeige)
  nachlaufTage: 28, // so lange nach dem Erscheinen gehört die Nummer fest zur Anzeige
  vorlaufTage: 21, // frühestens so lange vor dem Termin vergeben (nur für freigegebene/gebuchte Anzeigen)
  autoZuweisen: true,
  autoKaufen: true,
  ziele: [
    { typ: "browser", name: "Browser (alle, die bereit sind)", sekunden: 20 },
    { typ: "nummer", name: "Flo Handy", nummer: "", sekunden: 25 },
  ],
  bestaetigen: true,
  mailboxText: "Guten Tag und danke für Ihren Anruf bei {marke}! Gerade sind alle Berater im Gespräch. Bitte nennen Sie nach dem Signalton {abfrage} Wir rufen Sie so schnell wie möglich zurück, spätestens am nächsten Werktag.",
  zeiten: { aktiv: false, tage: [1, 2, 3, 4, 5, 6], von: "08:00", bis: "20:00" },
  ausserhalbText: "Guten Tag und danke für Ihren Anruf bei {marke}! Gerade sind wir nicht im Büro. Bitte nennen Sie nach dem Signalton {abfrage} Wir rufen Sie am nächsten Werktag zurück.",
  benachrichtigen: [],
  mailboxMail: true,
  alarm: { verpasst: 2, fensterMin: 60, quoteMin: 85, pauseStunden: 3 },
  skripte: {},
};

export async function cfg() {
  const t = (await holen("einstellungen", "telefon")) || {};
  const allg = (await holen("einstellungen", "allgemein")) || {};
  return {
    ...STANDARD,
    ...t,
    zeiten: { ...STANDARD.zeiten, ...(t.zeiten || {}) },
    alarm: { ...STANDARD.alarm, ...(t.alarm || {}) },
    ziele: Array.isArray(t.ziele) && t.ziele.length ? t.ziele : STANDARD.ziele,
    marke: allg.marke || "Modernisieren24",
    texte: allg.texte || {},
  };
}

export const fuell = (text, werte) => String(text || "").replace(/\{(\w+)\}/g, (_, k) => werte[k] ?? "");
const heute = () => new Date().toISOString().slice(0, 10);
const tagMs = 864e5;

// ---------- Zeit in Berlin ----------
export function berlin(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  const wt = { So: 0, Mo: 1, Di: 2, Mi: 3, Do: 4, Fr: 5, Sa: 6 }[p.weekday.replace(".", "")] ?? 0;
  return { wochentag: wt, zeit: `${p.hour}:${p.minute}`, stunde: Number(p.hour), datum: `${p.year}-${p.month}-${p.day}` };
}
export function erreichbar(c, d = new Date()) {
  if (!c.zeiten?.aktiv) return true;
  const b = berlin(d);
  return (c.zeiten.tage || []).includes(b.wochentag) && b.zeit >= (c.zeiten.von || "00:00") && b.zeit < (c.zeiten.bis || "24:00");
}

// ---------- Pool ----------
export async function nummerZu(e164) {
  const { data } = await adminDb().from("lp_docs").select("id, data").eq("collection", "nummern").eq("data->>e164", e164).maybeSingle();
  return data ? { id: data.id, ...data.data } : null;
}

const braucheTelefon = (a) => !a.kontaktwege?.length || a.kontaktwege.includes("Telefon");
function sollNummerHaben(a, c) {
  if (a.demo || a.trackingNummer || !braucheTelefon(a)) return false;
  if (["beendet"].includes(a.status)) return false;
  // Nur Anzeigen, die wirklich erscheinen sollen, bekommen automatisch eine Nummer (geplante nicht – sonst liegen Nummern
  // wochenlang bei Anzeigen, die nie gebucht werden). Für ein Motiv gezielt über „Nummern jetzt vergeben“ (ids).
  if (["gebucht", "erschienen"].includes(a.status)) return true;
  if (a.status !== "freigegeben" || !a.datum) return false;
  const t = Date.parse(a.datum);
  return t - Date.now() <= num(c.vorlaufTage, 21) * tagMs && t + num(c.nachlaufTage, 28) * tagMs > Date.now();
}

// Nummer stand nie in einer Zeitung: Anzeige weder gebucht noch erschienen, kein fertiges Motiv mit der Nummer
const nieGedruckt = (a) => !!a && !["gebucht", "erschienen", "beendet"].includes(a.status) && !a.gebuchtAm && !a.motiv?.bildUrl && !a.motiv?.druckPdfUrl;

async function kaufen(c, grund) {
  const z = await registrierung(c);
  if (!z.bundleSid || !z.addressSid) throw Object.assign(new Error("Twilio: freigegebene Unterlagen (Regulatory Bundle) oder Adresse fehlen. Siehe /telefon → Einrichtung."), { code: "setup" });
  const frei = await tw.freieNummernSuchen(c.ortsnetz);
  if (!frei.length) throw Object.assign(new Error(`Twilio hat gerade keine freien Nummern${c.ortsnetz ? ` im Ortsnetz ${c.ortsnetz}` : ""}.`), { code: "keine_nummern" });
  const pn = await tw.nummerKaufen(frei[0].phone_number, { addressSid: z.addressSid, bundleSid: z.bundleSid, name: `Lokalpilot ${grund || ""}`.trim() });
  return anlegen("nummern", { e164: pn.phone_number, anzeige: tw.national(pn.phone_number, c.ortsnetz), pnSid: pn.sid, typ: "lokal", status: "frei", gekauftAm: Date.now(), verlauf: [] }, pn.sid);
}

// Welche Unterlagen/Adresse nutzen? Einstellung oder die erste freigegebene bei Twilio.
export async function registrierung(c) {
  let bundleSid = c.bundleSid || "", addressSid = c.addressSid || "";
  if (!bundleSid) bundleSid = (await tw.bundles()).find((b) => b.status === "twilio-approved" && (!b.typ || b.typ === "local"))?.sid || "";
  if (!addressSid) addressSid = (await tw.adressen())[0]?.sid || "";
  return { bundleSid, addressSid };
}

export async function poolFreigeben(c) {
  const jetzt = Date.now();
  const pool = await liste("nummern");
  const anz = new Map((await liste("anzeigen")).map((a) => [a.id, a]));
  let n = 0;
  for (const nr of pool) {
    if (nr.status === "ruhend" && nr.ruhtBis && nr.ruhtBis <= jetzt) { await aendern("nummern", nr.id, { status: "frei", ruhtBis: null }); n++; continue; }
    if (nr.status !== "zugewiesen") continue;
    const a = anz.get(nr.anzeigeId);
    // Nie gedruckt und nicht (mehr) zur Veröffentlichung vorgesehen → sofort zurück in den Pool, ohne Ruhezeit
    const termin = a?.datum ? Date.parse(a.datum) : 0;
    if (a && nieGedruckt(a) && (a.status !== "freigegeben" || (termin && termin < jetzt) || !sollNummerHaben({ ...a, trackingNummer: "" }, c)) && !a.nummerBehalten) {
      await aendern("nummern", nr.id, { status: "frei", anzeigeId: null, code: null, verlauf: [...(nr.verlauf || []), { anzeigeId: nr.anzeigeId, code: nr.code, von: nr.zugewiesenAm, bis: jetzt, ungenutzt: true }].slice(-50) });
      await aendern("anzeigen", a.id, { trackingNummer: "", trackingE164: "", trackingNummerId: "" });
      n++;
      continue;
    }
    const ende = termin ? termin + num(c.nachlaufTage, 28) * tagMs : 0;
    const vorbei = !a || a.status === "beendet" || (ende && ende < jetzt);
    if (!vorbei) continue;
    await aendern("nummern", nr.id, {
      status: "ruhend", ruhtBis: jetzt + num(c.ruheTage, 56) * tagMs, letzteAnzeigeId: nr.anzeigeId, letzterCode: nr.code, letzteKategorie: a?.kategorie || nr.letzteKategorie || "", letztesBlattId: a?.blattId || nr.letztesBlattId || "", anzeigeId: null, code: null,
      verlauf: [...(nr.verlauf || []), { anzeigeId: nr.anzeigeId, code: nr.code, von: nr.zugewiesenAm, bis: jetzt }].slice(-50),
    });
    n++;
  }
  return n;
}

/** Tracking-Nummern vergeben. ids = bestimmte Anzeigen (dann auch ohne Termin), sonst alle, die bald erscheinen. */
export async function zuweisen({ ids = null, kanal = "print", manuell = false } = {}) {
  const c = await cfg();
  if (!tw.konfiguriert()) return { vergeben: 0, hinweis: "Twilio ist noch nicht eingerichtet." };
  await poolFreigeben(c);
  if (!manuell && !ids && c.autoZuweisen === false) return { vergeben: 0, hinweis: "Automatische Vergabe ist aus." };
  // Print-Nummer steht in trackingNummer, die Social-Nummer (für geteilte Fotos der Anzeige) in trackingNummerSocial
  const F = kanal === "social" ? { nr: "trackingNummerSocial", e164: "trackingE164Social", id: "trackingNummerSocialId" } : { nr: "trackingNummer", e164: "trackingE164", id: "trackingNummerId" };
  const alle = await liste("anzeigen");
  const offen = ids
    ? alle.filter((a) => ids.includes(a.id) && !a.demo && !a[F.nr] && (kanal === "social" || braucheTelefon(a)))
    : kanal === "social" ? [] : alle.filter((a) => sollNummerHaben(a, c));
  if (!offen.length) return { vergeben: 0 };
  offen.sort((x, y) => String(x.datum || "9").localeCompare(String(y.datum || "9")));
  let pool = (await liste("nummern")).filter((n) => n.status === "frei" && (n.kanal || "print") === kanal).sort((a, b) => (a.ruhtBis || a.gekauftAm || 0) - (b.ruhtBis || b.gekauftAm || 0));
  let gesamt = (await liste("nummern")).filter((n) => n.status !== "gesperrt").length;
  const ergebnis = { vergeben: 0, gekauft: 0, fehler: [], zuordnung: {} };
  for (const a of offen) {
    // Wiederverwendung: am liebsten eine Nummer, die zuletzt dieselbe Kategorie hatte (ein später Anrufer zur alten Anzeige
    // landet dann wenigstens beim richtigen Thema), dann dasselbe Blatt, dann die am längsten freie
    const rang = (n) => (n.letzteKategorie && n.letzteKategorie === a.kategorie ? 0 : !n.letzteKategorie ? 1 : 2) * 2 + (n.letztesBlattId && n.letztesBlattId === a.blattId ? 0 : 1);
    pool.sort((x, y) => rang(x) - rang(y) || (x.ruhtBis || x.gekauftAm || 0) - (y.ruhtBis || y.gekauftAm || 0));
    let nr = pool.shift();
    if (!nr) {
      if (!c.autoKaufen && !ids) { ergebnis.fehler.push("Pool leer, automatischer Kauf ist aus."); break; }
      if (gesamt >= num(c.maxNummern, 30)) { ergebnis.fehler.push(`Höchstzahl von ${c.maxNummern} Nummern erreicht.`); break; }
      try { nr = await kaufen(c, a.code); gesamt++; ergebnis.gekauft++; } catch (e) { ergebnis.fehler.push(e.message); break; }
    }
    await aendern("nummern", nr.id, { status: "zugewiesen", anzeigeId: a.id, code: a.code, kanal, zugewiesenAm: Date.now() });
    const anzeigeNr = nr.anzeige || tw.national(nr.e164, c.ortsnetz);
    await aendern("anzeigen", a.id, { [F.nr]: anzeigeNr, [F.e164]: nr.e164, [F.id]: nr.id });
    ergebnis.zuordnung[a.id] = anzeigeNr;
    ergebnis.vergeben++;
  }
  return ergebnis;
}

// ---------- Erreichbarkeit der Caller ----------
export async function bereiteCaller() {
  const p = await liste("telefon_praesenz");
  const grenze = Date.now() - 150e3;
  return p.filter((x) => x.status === "bereit" && (x.lastSeen || 0) > grenze);
}
export async function herzschlag(identitaet, email, status) {
  const alt = await holen("telefon_praesenz", identitaet);
  const jetzt = Date.now();
  const daten = { email, status, lastSeen: jetzt, seit: alt?.status === status ? alt.seit || jetzt : jetzt };
  if (alt) await aendern("telefon_praesenz", identitaet, daten); else await anlegen("telefon_praesenz", daten, identitaet);
  // Online-Minuten je Tag (für Auslastung). Nur zählen, wenn seit dem letzten Schlag ≤ 2,5 Min vergangen sind.
  if ((status === "bereit" || status === "gespraech") && alt && jetzt - (alt.lastSeen || 0) < 150e3 && ["bereit", "gespraech"].includes(alt.status)) {
    const id = `${identitaet}_${berlin().datum}`;
    const z = await holen("telefon_zeit", id);
    const plus = (jetzt - alt.lastSeen) / 60e3;
    if (z) await aendern("telefon_zeit", id, { minuten: num(z.minuten) + plus });
    else await anlegen("telefon_zeit", { identitaet, email, datum: berlin().datum, minuten: plus }, id);
  }
}

// ---------- Kontakt zum Anruf ----------
export async function kontaktZumAnruf({ anrufId, von, nummer, anzeige }) {
  // Ruft dieselbe Nummer innerhalb von 7 Tagen erneut zur selben Anzeige an, hängen wir den Anruf an den bestehenden Kontakt.
  const grenze = Date.now() - 7 * tagMs;
  const bisher = von ? await liste("kontakte", (k) => k.telefon === von && (k.createdAt || 0) > grenze && (k.anzeigeId || null) === (anzeige?.id || null)) : [];
  if (bisher.length) {
    const k = bisher.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    await aendern("kontakte", k.id, { anrufIds: [...(k.anrufIds || []), anrufId].slice(-20), anrufe: num(k.anrufe, 1) + 1 });
    return k.id;
  }
  const k = await anlegen("kontakte", {
    anzeigeId: anzeige?.id || "", code: anzeige?.code || "", kategorie: anzeige?.kategorie || "", kampagneId: anzeige?.kampagneId || "",
    kanal: "Telefon", quelle: "anruf", herkunft: nummer?.kanal || "print", datum: heute(), telefon: von || "", anrufIds: [anrufId], anrufe: 1,
    qualifiziert: false, einwilligung: false, erloes: 0, notiz: "", createdAt: Date.now(),
  });
  return k.id;
}

// ---------- Benachrichtigungen ----------
async function empfaenger(c) {
  if (c.benachrichtigen?.length) return c.benachrichtigen;
  const { data } = await adminDb().from("lp_members").select("email, rolle");
  return (data || []).filter((m) => m.rolle === "admin").map((m) => m.email);
}
export async function mailAnTeam(c, betreff, text) {
  if (!process.env.RESEND_API_KEY || !process.env.BUCHUNG_MAIL_FROM) return false;
  const an = await empfaenger(c);
  for (const e of an) {
    try { await senden({ an: e, betreff, text, absenderName: "Lokalpilot Telefon", testmodus: false }); } catch (err) { console.error("Telefon-Mail", err); }
  }
  return true;
}

export async function kapazitaetPruefen(c) {
  const fenster = num(c.alarm.fensterMin, 60) * 60e3;
  const seit = Date.now() - fenster;
  const anrufe = await liste("anrufe", (a) => (a.start || 0) > seit && a.richtung !== "aus");
  const verpasst = anrufe.filter((a) => ["verpasst", "mailbox"].includes(a.status) && !a.ausserhalb);
  const ueberlauf = anrufe.filter((a) => a.ueberlauf).length;
  if (verpasst.length < num(c.alarm.verpasst, 2) && ueberlauf < 2) return null;
  const st = (await holen("einstellungen", "telefon_status")) || {};
  if (st.letzterAlarm && Date.now() - st.letzterAlarm < num(c.alarm.pauseStunden, 3) * 36e5) return null;
  const text = `In den letzten ${c.alarm.fensterMin} Minuten wurden ${verpasst.length} von ${anrufe.length} Anrufen nicht angenommen${ueberlauf ? `, ${ueberlauf}× riefen mehr Leute gleichzeitig an, als Caller bereit waren` : ""}.\n\nEmpfehlung: mehr Kapazität einplanen (weiteren Caller in Lokalpilot auf „bereit“ stellen oder externen Telefondienst als Ziel eintragen).\n\nRückrufliste: ${tw.appUrl()}/telefon`;
  await mailAnTeam(c, `Lokalpilot: ${verpasst.length} verpasste Anrufe – mehr Kapazität nötig?`, text);
  const neu = { letzterAlarm: Date.now(), letzterAlarmText: text };
  if (await holen("einstellungen", "telefon_status")) await aendern("einstellungen", "telefon_status", neu); else await anlegen("einstellungen", neu, "telefon_status");
  return text;
}
